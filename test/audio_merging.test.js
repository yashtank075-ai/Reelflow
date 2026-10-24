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
  parseMediaPermalink,
  runYtDlp,
  isFfmpegMergerFailure,
  safeYtDlpError,
  buildMissingAudioDiagnostic
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
    // Check that every single-format fallback explicitly excludes video-only while permitting unknown codec metadata
    const branches = fmt.split('/');
    for (const b of branches) {
      if (!b.includes('+')) {
        assert.ok(b.includes('acodec!=?none'), `Single-format fallback "${b}" must require acodec!=?none`);
      }
    }
  }

  // Exact check for 'best'
  assert.equal(formatForQuality('best'), 'bv*[ext=mp4]+ba[ext=m4a]/bv*+ba/b[ext=mp4][acodec!=?none]/b[acodec!=?none]');

  // Exact check for 1080
  assert.equal(formatForQuality('1080'), 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080][ext=mp4][acodec!=?none]/b[height<=1080][acodec!=?none]/b[acodec!=?none]');

  // Exact check for 720
  assert.equal(formatForQuality('720'), 'bv*[height<=720][ext=mp4]+ba[ext=m4a]/bv*[height<=720]+ba/b[height<=720][ext=mp4][acodec!=?none]/b[height<=720][acodec!=?none]/b[acodec!=?none]');
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
    assert.ok(parts[2].startsWith('b[') && parts[2].includes('acodec!=?none'), `Part 2 for ${q} should fall back to pre-muxed combined audio/video requiring audio`);
    assert.ok(parts[parts.length - 1] === 'b[acodec!=?none]', `Last fallback for ${q} must require acodec!=?none`);
  }
});

test('Format Selection: Representative yt-dlp fixtures verify progressive, video-only, and DASH streams', async () => {
  function evaluateFormatSelector(formats, selector) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-selector-fixture-'));
    try {
      const infoPath = path.join(tmpDir, 'test.info.json');
      fs.writeFileSync(infoPath, JSON.stringify({
        id: 'fixture_media',
        title: 'Fixture Media',
        extractor: 'generic',
        extractor_key: 'Generic',
        formats
      }));
      const res = spawnSync('yt-dlp', ['--load-info-json', infoPath, '-f', selector, '--print', '%(format_id)s']);
      return {
        exitCode: res.status,
        selectedId: res.stdout?.toString().trim() || null,
        stderr: res.stderr?.toString().trim() || ''
      };
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // 1. Facebook-style progressive formats: undefined acodec and vcodec
  const fbProgressiveFormats = [
    { format_id: 'sd', ext: 'mp4', url: 'https://example.com/sd.mp4' },
    { format_id: 'hd', ext: 'mp4', url: 'https://example.com/hd.mp4' }
  ];
  for (const q of ['best', '1080', '720', '480', '360']) {
    const evalRes = evaluateFormatSelector(fbProgressiveFormats, formatForQuality(q));
    assert.equal(evalRes.exitCode, 0, `FB progressive formats must be supported for quality ${q}`);
    assert.ok(evalRes.selectedId === 'hd' || evalRes.selectedId === 'sd', `FB progressive selected ${evalRes.selectedId}`);
  }

  // 2. Instagram-style progressive formats: formats '1', '2', '3' with undefined codec metadata
  const igProgressiveFormats = [
    { format_id: '1', ext: 'mp4', url: 'https://example.com/1.mp4' },
    { format_id: '2', ext: 'mp4', url: 'https://example.com/2.mp4' },
    { format_id: '3', ext: 'mp4', url: 'https://example.com/3.mp4' }
  ];
  const igRes = evaluateFormatSelector(igProgressiveFormats, formatForQuality('best'));
  assert.equal(igRes.exitCode, 0, 'Instagram progressive formats with undefined codecs must be supported');
  assert.ok(['1', '2', '3'].includes(igRes.selectedId), `Instagram progressive selected ${igRes.selectedId}`);

  // 3. Separate video-only and audio-only DASH streams (must pair together)
  const dashFormats = [
    { format_id: 'dash-audio', ext: 'm4a', acodec: 'mp4a.40.5', vcodec: 'none', url: 'https://example.com/audio.m4a' },
    { format_id: 'dash-video-720', ext: 'mp4', height: 720, acodec: 'none', vcodec: 'vp09.00.31.08', url: 'https://example.com/video720.mp4' },
    { format_id: 'dash-video-1080', ext: 'mp4', height: 1080, acodec: 'none', vcodec: 'vp09.00.40.08', url: 'https://example.com/video1080.mp4' }
  ];
  const dashBest = evaluateFormatSelector(dashFormats, formatForQuality('best'));
  assert.equal(dashBest.exitCode, 0);
  assert.equal(dashBest.selectedId, 'dash-video-1080+dash-audio', 'Separate DASH streams must be paired');

  const dash720 = evaluateFormatSelector(dashFormats, formatForQuality('720'));
  assert.equal(dash720.exitCode, 0);
  assert.equal(dash720.selectedId, 'dash-video-720+dash-audio', 'Separate DASH streams must respect height limit and pair');

  // 4. Formats explicitly marked acodec: 'none' (video-only stream with NO audio counterpart available)
  // Must be rejected rather than delivering a silent video
  const silentOnlyFormats = [
    { format_id: 'silent-dash-v', ext: 'mp4', acodec: 'none', vcodec: 'h264', url: 'https://example.com/silent.mp4' }
  ];
  for (const q of ['best', '1080', '720', '480', '360']) {
    const silentRes = evaluateFormatSelector(silentOnlyFormats, formatForQuality(q));
    assert.notEqual(silentRes.exitCode, 0, `Video-only formats explicitly marked acodec:none must be rejected for quality ${q}`);
    assert.ok(silentRes.stderr.includes('Requested format is not available'), 'yt-dlp must refuse format selection when only silent format exists');
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

test('Stream Merging & Verification: Merging separate video and audio streams produces verified media with both streams', async () => {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rf-merge-test-'));
  const ffmpegBin = resolveFfmpegBinary() || 'ffmpeg';

  const sepVideoPath = path.join(tmpDir, 'sep_video.mp4');
  const sepAudioPath = path.join(tmpDir, 'sep_audio.m4a');
  const mergedOutputPath = path.join(tmpDir, 'merged_output.mp4');

  try {
    // 1. Generate video-only stream
    spawnSync(ffmpegBin, [
      '-y',
      '-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x240:rate=10',
      '-c:v', 'libx264', '-an',
      sepVideoPath
    ], { windowsHide: true });

    // 2. Generate audio-only stream
    spawnSync(ffmpegBin, [
      '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=1',
      '-c:a', 'aac', '-vn',
      sepAudioPath
    ], { windowsHide: true });

    // 3. Merge video and audio into a single MP4 container using ffmpeg (emulating yt-dlp merger)
    const mergeProc = spawnSync(ffmpegBin, [
      '-y',
      '-i', sepVideoPath,
      '-i', sepAudioPath,
      '-c:v', 'copy',
      '-c:a', 'copy',
      mergedOutputPath
    ], { windowsHide: true });

    assert.equal(mergeProc.status, 0, 'FFmpeg merge process must exit with status 0');
    assert.ok(fs.existsSync(mergedOutputPath), 'Merged output file must exist');

    // 4. Verify output with FFprobe
    const verification = await verifyMediaAudio(mergedOutputPath);
    assert.equal(verification.verified, true, 'Merged file must be verified by ffprobe');
    assert.equal(verification.hasAudio, true, 'Merged file must contain an audio stream');
    assert.equal(verification.hasVideo, true, 'Merged file must contain a video stream');
    const streamTypes = (verification.streams || []).map(s => typeof s === 'object' ? s.type : s);
    assert.ok(streamTypes.includes('video') && streamTypes.includes('audio'));
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('Stream Merging & Verification: Missing audio stream or failed merge is rejected by verifyMediaAudio', async () => {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rf-fail-test-'));
  const ffmpegBin = resolveFfmpegBinary() || 'ffmpeg';
  const silentFilePath = path.join(tmpDir, 'silent_file.mp4');

  try {
    // Generate silent file (no audio track)
    spawnSync(ffmpegBin, [
      '-y',
      '-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x240:rate=10',
      '-c:v', 'libx264', '-an',
      silentFilePath
    ], { windowsHide: true });

    const verification = await verifyMediaAudio(silentFilePath);
    assert.equal(verification.verified, true);
    assert.equal(verification.hasVideo, true);
    assert.equal(verification.hasAudio, false, 'Silent file must have hasAudio=false');
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('Binary Precedence: Local bin/ directory or FFMPEG_PATH takes precedence over system binaries', () => {
  const customFfmpeg = path.resolve('bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  const prevEnv = process.env.FFMPEG_PATH;

  try {
    process.env.FFMPEG_PATH = customFfmpeg;
    // When FFMPEG_PATH points to a path, resolveFfmpegBinary checks existence or fallbacks safely
    const resolved = resolveFfmpegBinary();
    if (fs.existsSync(customFfmpeg)) {
      assert.equal(resolved, customFfmpeg);
    }
  } finally {
    if (prevEnv) process.env.FFMPEG_PATH = prevEnv;
    else delete process.env.FFMPEG_PATH;
  }
});
test('safeYtDlpError: Classifies FFmpeg merger and postprocessing errors clearly', () => {
  const errFfmpegNotFound = safeYtDlpError('WARNING: You have requested merging of multiple formats but ffmpeg is not installed. The formats won\'t be merged.');
  assert.equal(errFfmpegNotFound, 'Media processing tool (FFmpeg) encountered an error merging audio and video streams.');

  const errMergerFailed = safeYtDlpError('ERROR: Postprocessing: ffprobe or ffmpeg not found. Please install or provide the path using --ffmpeg-location');
  assert.equal(errMergerFailed, 'Media processing tool (FFmpeg) encountered an error merging audio and video streams.');

  const errRateLimit = safeYtDlpError('HTTP Error 429: Too Many Requests');
  assert.equal(errRateLimit, 'The platform is temporarily rate-limiting requests. Wait a while before trying again.');
});

test('isFfmpegMergerFailure: Accurately identifies merger failures and does not flag harmless warnings', () => {
  // Proven FFmpeg merger failure messages
  assert.equal(isFfmpegMergerFailure('WARNING: You have requested merging of multiple formats but ffmpeg is not installed. The formats won\'t be merged.'), true);
  assert.equal(isFfmpegMergerFailure('ERROR: Postprocessing: ffprobe or ffmpeg not found. Please install or provide the path using --ffmpeg-location'), true);
  assert.equal(isFfmpegMergerFailure('ffmpeg exited with code 1: Invalid argument'), true);
  assert.equal(isFfmpegMergerFailure('ffmpeg: error while loading shared libraries: libm.so.6'), true);
  assert.equal(isFfmpegMergerFailure('Postprocessing: ffmpeg merger failed'), true);

  // Harmless warnings from yt-dlp or extractors that must NOT fail a valid download
  assert.equal(isFfmpegMergerFailure('WARNING: [youtube] Incomplete data received in player response'), false);
  assert.equal(isFfmpegMergerFailure('WARNING: [facebook] URL contains unsupported tracking parameters'), false);
  assert.equal(isFfmpegMergerFailure('WARNING: [instagram] Trying to fall back to GraphQL API'), false);
  assert.equal(isFfmpegMergerFailure('WARNING: unable to extract thumbnail url'), false);
  assert.equal(isFfmpegMergerFailure(''), false);
  assert.equal(isFfmpegMergerFailure(null), false);
});

test('buildMissingAudioDiagnostic: Accurately classifies failure, ignores directories, and sanitizes filenames', async () => {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rf-diag-test-'));

  try {
    // 1. Simulate video_only_output condition (only reelflow.mp4 exists)
    await fs.promises.writeFile(path.join(tmpDir, 'reelflow.mp4'), 'mock_video_bytes');
    // An unrelated file that should NOT match the safe pattern and should be omitted
    await fs.promises.writeFile(path.join(tmpDir, 'secret_token_123.txt'), 'do_not_log');
    // A subdirectory that should be ignored
    await fs.promises.mkdir(path.join(tmpDir, 'reelflow.subfolder'));

    const diag1 = await buildMissingAudioDiagnostic({
      provider: 'instagram',
      tempDir: tmpDir,
      audioVerification: { verified: true, hasAudio: false, hasVideo: true, streams: [{ type: 'video', codec: 'vp09' }] },
      exitStatus: 0
    });

    assert.equal(diag1.event, 'audio_verification_failure');
    assert.equal(diag1.provider, 'instagram');
    assert.equal(diag1.failureCategory, 'video_only_output');
    assert.equal(diag1.exitStatus, 0);
    assert.equal(diag1.hasAudio, false);
    assert.equal(diag1.hasVideo, true);
    // Unrelated file and subfolder omitted
    assert.equal(diag1.files.length, 1);
    assert.equal(diag1.files[0].name, 'reelflow.mp4');
    assert.equal(diag1.files[0].sizeBytes, 16);
    // Streams contains structured [{type, codec}]
    assert.deepEqual(diag1.streams, [{ type: 'video', codec: 'vp09' }]);

    // 2. Simulate audio_intermediate_present condition
    await fs.promises.writeFile(path.join(tmpDir, 'reelflow.fdash-1234a.m4a'), 'mock_audio_bytes');
    const diag2 = await buildMissingAudioDiagnostic({
      provider: 'facebook',
      tempDir: tmpDir,
      audioVerification: { verified: true, hasAudio: false, hasVideo: true, streams: [{ type: 'video', codec: 'av01' }] }
    });
    assert.equal(diag2.failureCategory, 'audio_intermediate_present');
    assert.equal(diag2.provider, 'facebook');
    assert.equal(diag2.files.length, 2);

    // 3. Simulate audio_intermediate_missing condition (video intermediate exists, but no audio intermediate)
    await fs.promises.unlink(path.join(tmpDir, 'reelflow.fdash-1234a.m4a'));
    await fs.promises.writeFile(path.join(tmpDir, 'reelflow.fdash-5678v.mp4'), 'mock_video_inter');
    const diag3 = await buildMissingAudioDiagnostic({
      provider: 'instagram',
      tempDir: tmpDir,
      audioVerification: { verified: true, hasAudio: false, hasVideo: true, streams: [{ type: 'video', codec: 'vp09' }] }
    });
    assert.equal(diag3.failureCategory, 'audio_intermediate_missing');

    // 4. Simulate ambiguous intermediate file (non-standard extension)
    await fs.promises.writeFile(path.join(tmpDir, 'reelflow.custompart.xyz'), 'mock_bytes');
    const diag4 = await buildMissingAudioDiagnostic({
      provider: 'instagram',
      tempDir: tmpDir,
      audioVerification: { verified: true, hasAudio: false, hasVideo: true, streams: [] }
    });
    assert.equal(diag4.failureCategory, 'intermediate_files_inconclusive');

    // 5. Privacy check: JSON stringification contains no URLs, tokens, cookies, or secrets
    const jsonStr = JSON.stringify(diag4);
    assert.ok(!jsonStr.includes('secret_token'));
    assert.ok(!jsonStr.includes('http://'));
    assert.ok(!jsonStr.includes('https://'));
    assert.ok(!jsonStr.includes('cookies'));
    assert.ok(!jsonStr.includes('token='));

    // 6. Bounded diagnostic output: streams and files lists are bounded and safe
    const diagBounded = await buildMissingAudioDiagnostic({
      provider: 'unknown-provider-inject-attempt',
      tempDir: tmpDir,
      audioVerification: {
        verified: true,
        hasAudio: false,
        hasVideo: true,
        streams: Array.from({ length: 25 }, (_, i) => ({ type: `type_${i}`, codec: `codec_${i}` }))
      }
    });
    assert.equal(diagBounded.provider, 'unknown');
    assert.ok(diagBounded.streams.length <= 10, 'Streams must be bounded to maximum 10');
    assert.ok(diagBounded.files.length <= 10, 'Files must be bounded to maximum 10');

    // 7. Diagnostic collection failure does not bypass strict audio verification
    // Calling buildMissingAudioDiagnostic on a missing directory does not throw and returns clean event
    const diagFailingDir = await buildMissingAudioDiagnostic({
      provider: 'instagram',
      tempDir: path.join(tmpDir, 'non_existent_subdir'),
      audioVerification: { verified: true, hasAudio: false, hasVideo: true, streams: [] }
    });
    assert.equal(diagFailingDir.event, 'audio_verification_failure');
    assert.equal(diagFailingDir.hasAudio, false);
    assert.equal(diagFailingDir.failureCategory, 'video_only_output');

    // 8. Process failures: if runYtDlp throws before returning an exit status, exitStatus is retained as null
    const diagProcessFailure = await buildMissingAudioDiagnostic({
      provider: 'facebook',
      tempDir: tmpDir,
      audioVerification: { verified: false, hasAudio: false, reason: 'ffprobe_failed' },
      exitStatus: null
    });
    assert.equal(diagProcessFailure.exitStatus, null);
    assert.equal(diagProcessFailure.failureCategory, 'ffprobe_failed');

    // 9. Final video-only output with no intermediate files present
    const cleanDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rf-clean-test-'));
    try {
      await fs.promises.writeFile(path.join(cleanDir, 'reelflow.mp4'), 'final_mp4_bytes');
      const diagClean = await buildMissingAudioDiagnostic({
        provider: 'instagram',
        tempDir: cleanDir,
        audioVerification: { verified: true, hasAudio: false, hasVideo: true, streams: [{ type: 'video', codec: 'h264' }] },
        exitStatus: 0
      });
      assert.equal(diagClean.failureCategory, 'video_only_output');
      assert.equal(diagClean.files.length, 1);
      assert.equal(diagClean.files[0].name, 'reelflow.mp4');
    } finally {
      await fs.promises.rm(cleanDir, { recursive: true, force: true }).catch(() => {});
    }

    // 10. Format IDs parsed from representative sanitized yt-dlp stdout
    const diagFormatStdout = await buildMissingAudioDiagnostic({
      provider: 'instagram',
      tempDir: tmpDir,
      audioVerification: { verified: true, hasAudio: false, hasVideo: true, streams: [] },
      stdout: '[info] dQw4w9WgXcQ: Downloading 1 format(s): 401+140\n[Merger] Merging formats into "reelflow.mp4"\n',
      stderr: ''
    });
    assert.equal(diagFormatStdout.selectedFormatIds, '401+140');
    assert.equal(diagFormatStdout.formatMessageSource, 'stdout');
    assert.equal(diagFormatStdout.mergerObserved, true);
    assert.equal(diagFormatStdout.mergerMessageSource, 'stdout');

    // 11. Format IDs and merger message detected in stderr (or both)
    const diagFormatStderr = await buildMissingAudioDiagnostic({
      provider: 'facebook',
      tempDir: tmpDir,
      audioVerification: { verified: true, hasAudio: false, hasVideo: true, streams: [] },
      stdout: '',
      stderr: '[info] 12345: Downloading 1 format(s): dash-1080p\n[Merger] Merging formats into "reelflow.mp4"\n'
    });
    assert.equal(diagFormatStderr.selectedFormatIds, 'dash-1080p');
    assert.equal(diagFormatStderr.formatMessageSource, 'stderr');
    assert.equal(diagFormatStderr.mergerObserved, true);
    assert.equal(diagFormatStderr.mergerMessageSource, 'stderr');

    // 12. Format IDs absent or malformed, and no merger observed
    const diagNoMerger = await buildMissingAudioDiagnostic({
      provider: 'instagram',
      tempDir: tmpDir,
      audioVerification: { verified: true, hasAudio: false, hasVideo: true, streams: [] },
      stdout: '[download] Destination: reelflow.mp4\n[download] 100% of 6.00MiB\n',
      stderr: 'WARNING: Some warning\n'
    });
    assert.equal(diagNoMerger.selectedFormatIds, null);
    assert.equal(diagNoMerger.formatMessageSource, null);
    assert.equal(diagNoMerger.mergerObserved, false);
    assert.equal(diagNoMerger.mergerMessageSource, null);
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});
