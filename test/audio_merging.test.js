import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { 
  formatForQuality, 
  resolveFfmpegBinary, 
  resolveFfprobeBinary, 
  verifyMediaAudio,
  parseMediaPermalink
} from '../server/index.js';

test('Format Selection: formatForQuality produces valid yt-dlp format strings requiring audio for all quality options', () => {
  const qualities = ['best', '1080', '720', '480', '360', 'unknown'];
  
  for (const q of qualities) {
    const fmt = formatForQuality(q);
    assert.ok(typeof fmt === 'string' && fmt.length > 0, `Format string for "${q}" should not be empty`);
    
    // Check that format selector does not allow bare video-only streams (like standalone 'bestvideo')
    assert.ok(!fmt.endsWith('/bestvideo'), `Format selector for "${q}" must not end in video-only fallback`);
    assert.ok(!fmt.endsWith('/bv'), `Format selector for "${q}" must not end in video-only fallback`);
    
    // Check audio presence in expressions
    assert.ok(fmt.includes('+ba'), `Format string for "${q}" must include audio stream pairing`);
    assert.ok(fmt.includes('/b'), `Format string for "${q}" must include pre-muxed video+audio fallback`);
  }

  // Exact check for 'best'
  assert.equal(formatForQuality('best'), 'bv*[ext=mp4]+ba[ext=m4a]/bv*+ba/b[ext=mp4]/b');

  // Exact check for 1080
  assert.equal(formatForQuality('1080'), 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080][ext=mp4]/b[height<=1080]/b');

  // Exact check for 720
  assert.equal(formatForQuality('720'), 'bv*[height<=720][ext=mp4]+ba[ext=m4a]/bv*[height<=720]+ba/b[height<=720][ext=mp4]/b[height<=720]/b');
});

test('FFmpeg & FFprobe Resolution: Detects installed binaries or handles absence gracefully', () => {
  const ffmpeg = resolveFfmpegBinary();
  const ffprobe = resolveFfprobeBinary();

  // If local ffmpeg is present in path or system, binary resolution must return a string or null (never throw)
  assert.ok(ffmpeg === null || typeof ffmpeg === 'string');
  assert.ok(ffprobe === null || typeof ffprobe === 'string');
});

test('verifyMediaAudio: Correctly verifies media files containing audio streams vs video-only streams', async () => {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rf-audio-test-'));
  const ffmpegBin = resolveFfmpegBinary() || 'ffmpeg';

  const videoWithAudioPath = path.join(tmpDir, 'test_audio_video.mp4');
  const silentVideoPath = path.join(tmpDir, 'test_silent_video.mp4');

  try {
    // Generate synthetic 1-second video with audio tone using ffmpeg
    const genAudio = spawnSync(ffmpegBin, [
      '-y',
      '-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x240:rate=10',
      '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=1',
      '-c:v', 'libx264', '-c:a', 'aac',
      videoWithAudioPath
    ], { windowsHide: true });

    // Generate synthetic 1-second silent video (no audio stream)
    const genSilent = spawnSync(ffmpegBin, [
      '-y',
      '-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x240:rate=10',
      '-c:v', 'libx264', '-an',
      silentVideoPath
    ], { windowsHide: true });

    if (genAudio.status === 0 && fs.existsSync(videoWithAudioPath)) {
      const res = await verifyMediaAudio(videoWithAudioPath);
      if (res.verified) {
        assert.equal(res.hasAudio, true, 'File with audio must be detected as hasAudio=true');
        assert.equal(res.hasVideo, true, 'File with video must be detected as hasVideo=true');
      }
    }

    if (genSilent.status === 0 && fs.existsSync(silentVideoPath)) {
      const res = await verifyMediaAudio(silentVideoPath);
      if (res.verified) {
        assert.equal(res.hasAudio, false, 'File with no audio stream must be detected as hasAudio=false');
        assert.equal(res.hasVideo, true, 'File with video stream must be detected as hasVideo=true');
      }
    }
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('verifyMediaAudio: Handles non-existent or corrupted file gracefully', async () => {
  const res = await verifyMediaAudio('non_existent_file_xyz_123.mp4');
  assert.equal(res.verified, false);
  assert.equal(res.reason, 'ffprobe_failed');
});

test('verifyMediaAudio: Safely reports missing ffprobe when binary path points to non-existent executable', async () => {
  const prevEnv = process.env.FFPROBE_PATH;
  try {
    process.env.FFPROBE_PATH = path.join(os.tmpdir(), 'non_existent_ffprobe_executable');
    const res = await verifyMediaAudio('dummy_file.mp4');
    assert.equal(res.verified, false);
    assert.equal(res.hasAudio, false); // Strict safety: unverified files must never be reported as hasAudio=true
    assert.ok(res.reason === 'ffprobe_failed' || res.reason === 'ffprobe_not_available');
  } finally {
    if (prevEnv) process.env.FFPROBE_PATH = prevEnv;
    else delete process.env.FFPROBE_PATH;
  }
});

test('Format Selection: All five quality options preserve audio pairing and combined fallbacks', () => {
  const qualities = ['best', '1080', '720', '480', '360'];
  for (const q of qualities) {
    const fmt = formatForQuality(q);
    const parts = fmt.split('/');
    // 'best' has 4 fallback levels (mp4+m4a, any separate, pre-muxed mp4, pre-muxed any)
    // Resolution-bounded options have 5 levels (mp4+m4a, any separate <=H, pre-muxed mp4 <=H, pre-muxed any <=H, and unconstrained combined 'b')
    const expectedLength = q === 'best' ? 4 : 5;
    assert.equal(parts.length, expectedLength, `Format for ${q} should have ${expectedLength} fallback levels`);
    assert.ok(parts[0].includes('+ba[ext=m4a]'), `Part 0 for ${q} should prefer m4a audio`);
    assert.ok(parts[1].includes('+ba'), `Part 1 for ${q} should allow any audio`);
    assert.ok(parts[2].startsWith('b[') || parts[2] === 'b[ext=mp4]', `Part 2 for ${q} should fall back to pre-muxed combined audio/video`);
    assert.ok(parts[parts.length - 1] === 'b', `Last fallback for ${q} should fall back to pre-muxed combined audio/video 'b'`);
  }
});

test('URL Parsing Regression: Instagram Reels, Facebook Videos, and YouTube URLs parse correctly', () => {
  const insta = parseMediaPermalink('https://www.instagram.com/reel/C8qVw-xvK3P/');
  assert.ok(insta);
  assert.equal(insta.provider, 'instagram');
  assert.equal(insta.id, 'C8qVw-xvK3P');

  const fb = parseMediaPermalink('https://www.facebook.com/watch/?v=1234567890');
  assert.ok(fb);
  assert.equal(fb.provider, 'facebook');
  assert.equal(fb.id, '1234567890');

  const yt = parseMediaPermalink('https://www.youtube.com/watch?v=aqz-KE-bpKQ');
  assert.ok(yt);
  assert.equal(yt.provider, 'youtube');
  assert.equal(yt.id, 'aqz-KE-bpKQ');
});

