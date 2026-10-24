import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { 
  initAnalyticsDb, 
  recordAnalyticsEvent, 
  recordRateLimitHit, 
  pruneOldAnalytics, 
  getAggregatedAnalytics 
} from './analytics.js';
import { 
  validateAdminSecretConfig,
  verifyAdminPassword, 
  createAdminSession, 
  destroyAdminSession, 
  isValidAdminSession, 
  checkLoginRateLimit, 
  requireAdminAuth,
  extractToken
} from './auth.js';

// Validate admin credentials configuration on boot
validateAdminSecretConfig();

const app = express();
const PORT = Number(process.env.PORT || 4000);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAX_DOWNLOAD_BYTES = Number(process.env.MAX_DOWNLOAD_BYTES || 100 * 1024 * 1024);
const MAX_ACTIVE_DOWNLOADS = Number(process.env.MAX_ACTIVE_DOWNLOADS || 2);
let activeDownloads = 0;
const rateBuckets = new Map();

// Initialize analytics storage & retention timers
initAnalyticsDb().catch(() => {});
setInterval(pruneOldAnalytics, 24 * 60 * 60 * 1000).unref();

app.set('trust proxy', 1);

// Security Headers Middleware
app.use((req, res, next) => {
  // Prevent MIME-sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Prevent clickjacking via frame embedding
  res.setHeader('X-Frame-Options', 'DENY');

  // Privacy-friendly referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Restrict browser features and sensors
  res.setHeader('Permissions-Policy', 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()');

  // Content Security Policy
  // Allows Google Fonts (fonts.googleapis.com, fonts.gstatic.com) and local bundle assets
  // Intentionally allows unsafe-inline styles for dynamic React progress styles, tooltips, and font definitions
  // Allows img-src https: data: blob: for Instagram/Facebook media thumbnails and blob downloads
  // frame-ancestors 'none' reinforces clickjacking defense
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' https: data: blob:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join('; ');
  res.setHeader('Content-Security-Policy', csp);

  // Enforce HSTS in production for secure HTTPS traffic behind Render proxy
  if (process.env.NODE_ENV === 'production' || req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  // Search engine indexation guard for admin and API routes
  if (req.path.startsWith('/admin') || req.path.startsWith('/api/')) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  }

  next();
});

app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173', credentials: true }));
app.use(express.json({ limit: '20kb' }));

function pruneRateBuckets() {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) {
    if (now - bucket.start > 120_000) rateBuckets.delete(key);
  }
}
setInterval(pruneRateBuckets, 60_000).unref();

app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  const now = Date.now();
  const key = req.ip || 'unknown';
  const bucket = rateBuckets.get(key) || { start: now, count: 0 };
  if (now - bucket.start > 60_000) { bucket.start = now; bucket.count = 0; }
  bucket.count += 1; 
  rateBuckets.set(key, bucket);
  if (bucket.count > 30) {
    if (bucket.count === 31) {
      recordRateLimitHit();
    }
    return res.status(429).json({ error: 'Too many requests. Please wait a minute and try again.' });
  }
  next();
});

const INSTAGRAM_HOSTS = new Set(['instagram.com', 'www.instagram.com', 'm.instagram.com']);
const FACEBOOK_HOSTS = new Set(['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com', 'fb.watch']);
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']);
const downloadJobs = new Map();
const JOB_TTL_MS = 15 * 60 * 1000;

export function parseMediaPermalink(input) {
  let url;
  try { url = new URL(input); } catch { return null; }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;

  if (INSTAGRAM_HOSTS.has(host)) {
    const match = url.pathname.match(/^\/(reel|reels|p)\/([A-Za-z0-9_-]+)\/?$/i);
    if (!match) return null;
    return { provider: 'instagram', id: match[2], canonical: `https://www.instagram.com/${match[1].toLowerCase()}/${match[2]}/` };
  }

  if (FACEBOOK_HOSTS.has(host)) {
    // 1. fb.watch shortlinks: https://fb.watch/xyz123/
    if (host === 'fb.watch') {
      const match = url.pathname.match(/^\/([A-Za-z0-9._-]+)\/?$/);
      if (!match) return null;
      return { 
        provider: 'facebook', 
        id: match[1], 
        canonical: `https://fb.watch/${match[1]}/` 
      };
    }

    // 2. Query-based Facebook videos: e.g. /watch/?v=12345 or /video.php?v=12345
    if (url.searchParams.has('v')) {
      const vId = url.searchParams.get('v');
      const isWatchPath = /^\/(?:watch\/?|video\.php\/?)$/i.test(url.pathname);
      if (!isWatchPath || !vId || !/^[A-Za-z0-9._-]+$/.test(vId)) return null;
      return {
        provider: 'facebook',
        id: vId.slice(0, 100),
        canonical: `https://www.facebook.com/watch/?v=${encodeURIComponent(vId)}`
      };
    }

    if (url.searchParams.has('story_fbid')) {
      const isPermalink = /^\/(?:permalink\.php|story\.php)\/?$/i.test(url.pathname);
      if (!isPermalink) return null;
      const fbid = url.searchParams.get('story_fbid');
      if (!fbid || !/^[A-Za-z0-9._-]+$/.test(fbid)) return null;
      const cleanParams = new URLSearchParams();
      cleanParams.set('story_fbid', fbid);
      if (url.searchParams.has('id')) {
        const userId = url.searchParams.get('id');
        if (userId && /^[A-Za-z0-9._-]+$/.test(userId)) cleanParams.set('id', userId);
      }
      return {
        provider: 'facebook',
        id: fbid.slice(0, 100),
        canonical: `https://www.facebook.com/permalink.php?${cleanParams.toString()}`
      };
    }

    // 3. Path-based Facebook videos: /reel/{id}, /share/v/{id}, /share/r/{id}, /videos/{id}, /{user}/videos/{id}
    const pathSegments = url.pathname.split('/').filter(Boolean);
    const videoIdx = pathSegments.findIndex(seg => /^(reel|videos)$/i.test(seg));
    const shareIdx = pathSegments.findIndex(seg => /^share$/i.test(seg));

    let videoId = null;
    let normalizedPath = null;

    if (videoIdx !== -1 && pathSegments[videoIdx + 1]) {
      videoId = pathSegments[videoIdx + 1];
      normalizedPath = `/${pathSegments[videoIdx].toLowerCase()}/${videoId}/`;
    } else if (shareIdx !== -1 && pathSegments[shareIdx + 1] && pathSegments[shareIdx + 2]) {
      const shareType = pathSegments[shareIdx + 1].toLowerCase(); // v or r
      videoId = pathSegments[shareIdx + 2];
      if (/^[vr]$/.test(shareType)) {
        normalizedPath = `/share/${shareType}/${videoId}/`;
      }
    }

    if (videoId && /^[A-Za-z0-9._-]+$/.test(videoId) && normalizedPath) {
      return {
        provider: 'facebook',
        id: videoId.slice(0, 100),
        canonical: `https://www.facebook.com${normalizedPath}`
      };
    }

    return null;
  }

  if (YOUTUBE_HOSTS.has(host)) {
    // 1. youtu.be shortlink: https://youtu.be/{videoId}
    if (host === 'youtu.be') {
      const match = url.pathname.match(/^\/([A-Za-z0-9_-]{11})\/?$/);
      if (!match) return null;
      return {
        provider: 'youtube',
        id: match[1],
        canonical: `https://www.youtube.com/watch?v=${match[1]}`
      };
    }

    // 2. youtube.com/shorts/{videoId}
    const shortsMatch = url.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{11})\/?$/i);
    if (shortsMatch) {
      return {
        provider: 'youtube',
        id: shortsMatch[1],
        canonical: `https://www.youtube.com/shorts/${shortsMatch[1]}`
      };
    }

    // 3. youtube.com/watch?v={videoId}
    if (/^\/watch\/?$/i.test(url.pathname)) {
      const vId = url.searchParams.get('v');
      if (vId && /^[A-Za-z0-9_-]{11}$/.test(vId)) {
        return {
          provider: 'youtube',
          id: vId,
          canonical: `https://www.youtube.com/watch?v=${vId}`
        };
      }
    }

    return null;
  }

  return null;
}
function pruneDownloadJobs() {
  const now = Date.now();
  for (const [token, job] of downloadJobs) if (job.expiresAt <= now) downloadJobs.delete(token);
}
setInterval(pruneDownloadJobs, 5 * 60_000).unref();
function resolveYtDlpBinary() {
  if (process.env.YT_DLP_PATH && fs.existsSync(process.env.YT_DLP_PATH)) {
    return process.env.YT_DLP_PATH;
  }
  // Check local project bin directory (common on Render/Linux deployments)
  const localBin = path.resolve(__dirname, '../bin/yt-dlp');
  if (fs.existsSync(localBin)) {
    return localBin;
  }
  // Check common Windows WinGet installation directory
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Local') : '');
    if (localAppData) {
      const wingetDir = path.join(localAppData, 'Microsoft', 'WinGet', 'Packages');
      if (fs.existsSync(wingetDir)) {
        try {
          const entries = fs.readdirSync(wingetDir);
          const pkg = entries.find(name => name.toLowerCase().includes('yt-dlp.yt-dlp'));
          if (pkg) {
            const exePath = path.join(wingetDir, pkg, 'yt-dlp.exe');
            if (fs.existsSync(exePath)) return exePath;
          }
        } catch {}
      }
    }
  }
  return process.env.YT_DLP_PATH || 'yt-dlp';
}

function findBinaryOnSystem(name) {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    const res = spawnSync(cmd, [name], { encoding: 'utf8', windowsHide: true });
    if (res.status === 0 && res.stdout) {
      const first = res.stdout.trim().split(/\r?\n/)[0];
      if (first && fs.existsSync(first.trim())) return first.trim();
    }
  } catch {}
  return null;
}

export function resolveFfmpegBinary() {
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
    return process.env.FFMPEG_PATH;
  }
  const localBin = path.resolve(__dirname, '../bin/ffmpeg');
  if (fs.existsSync(localBin)) {
    return localBin;
  }
  const localBinExe = path.resolve(__dirname, '../bin/ffmpeg.exe');
  if (fs.existsSync(localBinExe)) {
    return localBinExe;
  }
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Local') : '');
    if (localAppData) {
      const wingetDir = path.join(localAppData, 'Microsoft', 'WinGet', 'Packages');
      if (fs.existsSync(wingetDir)) {
        try {
          const entries = fs.readdirSync(wingetDir);
          const pkg = entries.find(name => name.toLowerCase().includes('ffmpeg'));
          if (pkg) {
            const pkgPath = path.join(wingetDir, pkg);
            const candidateBin = path.join(pkgPath, 'bin', 'ffmpeg.exe');
            if (fs.existsSync(candidateBin)) return candidateBin;
            const directExe = path.join(pkgPath, 'ffmpeg.exe');
            if (fs.existsSync(directExe)) return directExe;
            const subdirs = fs.readdirSync(pkgPath);
            for (const sub of subdirs) {
              const nestedBin = path.join(pkgPath, sub, 'bin', 'ffmpeg.exe');
              if (fs.existsSync(nestedBin)) return nestedBin;
            }
          }
        } catch {}
      }
    }
  }
  // Check system PATH
  const systemPath = findBinaryOnSystem('ffmpeg');
  if (systemPath) return systemPath;

  return null;
}

export function resolveFfprobeBinary() {
  if (process.env.FFPROBE_PATH && fs.existsSync(process.env.FFPROBE_PATH)) {
    return process.env.FFPROBE_PATH;
  }
  const localBin = path.resolve(__dirname, '../bin/ffprobe');
  if (fs.existsSync(localBin)) {
    return localBin;
  }
  const localBinExe = path.resolve(__dirname, '../bin/ffprobe.exe');
  if (fs.existsSync(localBinExe)) {
    return localBinExe;
  }
  const ffmpegPath = resolveFfmpegBinary();
  if (ffmpegPath) {
    const dir = path.dirname(ffmpegPath);
    const probeExe = path.join(dir, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    if (fs.existsSync(probeExe)) {
      return probeExe;
    }
  }
  // Check system PATH
  const systemPath = findBinaryOnSystem('ffprobe');
  if (systemPath) return systemPath;

  return null;
}

export async function verifyMediaAudio(filePath) {
  const probeBin = resolveFfprobeBinary();
  const probeCommand = probeBin || 'ffprobe';
  return new Promise((resolve) => {
    const args = ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'json', filePath];
    const child = spawn(probeCommand, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      resolve({ verified: false, hasAudio: false, reason: 'ffprobe_timeout' });
    }, 5000);

    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.on('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ verified: false, hasAudio: false, reason: 'ffprobe_not_available' });
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        resolve({ verified: false, hasAudio: false, reason: 'ffprobe_failed' });
        return;
      }
      let parsed = null;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        resolve({ verified: false, hasAudio: false, reason: 'ffprobe_parse_failed' });
        return;
      }
      const rawStreams = Array.isArray(parsed?.streams) ? parsed.streams : [];
      const streams = rawStreams.map(s => ({
        type: String(s?.codec_type || '').toLowerCase(),
        codec: String(s?.codec_name || '').toLowerCase()
      })).filter(s => s.type);

      const hasAudio = streams.some(s => s.type === 'audio');
      const hasVideo = streams.some(s => s.type === 'video');
      resolve({ verified: true, hasAudio, hasVideo, streams });
    });
  });
}

export function runYtDlp(args, timeoutMs = 45_000, abortSignal = null) {
  return new Promise((resolve, reject) => {
    const binary = resolveYtDlpBinary();
    const finalArgs = [...args];
    const ffmpegPath = resolveFfmpegBinary();
    const spawnEnv = { ...process.env };
    if (ffmpegPath) {
      const ffmpegDir = path.dirname(ffmpegPath);
      // Prepend ffmpeg directory to PATH so yt-dlp and its spawned helpers locate ffmpeg and ffprobe
      const pathKey = Object.keys(spawnEnv).find(k => k.toLowerCase() === 'path') || 'PATH';
      spawnEnv[pathKey] = ffmpegDir + (path.delimiter || (process.platform === 'win32' ? ';' : ':')) + (spawnEnv[pathKey] || '');
      if (!finalArgs.includes('--ffmpeg-location')) {
        finalArgs.unshift('--ffmpeg-location', ffmpegPath);
      }
    }
    const child = spawn(binary, finalArgs, { shell: false, windowsHide: true, env: spawnEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let settled = false;
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error('The media request timed out. Try again later.')); }, timeoutMs);
    const finish = (err, value) => { 
      if (settled) return; 
      settled = true; 
      clearTimeout(timer); 
      if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
      err ? reject(err) : resolve(value); 
    };

    const onAbort = () => {
      child.kill('SIGKILL');
      finish(new Error('Download cancelled by client.'));
    };

    if (abortSignal) {
      if (abortSignal.aborted) {
        onAbort();
      } else {
        abortSignal.addEventListener('abort', onAbort, { once: true });
      }
    }

    child.stdout.on('data', chunk => { stdout += chunk.toString(); if (stdout.length > 2_000_000) { child.kill('SIGKILL'); finish(new Error('Media metadata response was too large.')); } });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-4000); });
    child.on('error', err => finish(new Error(err.code === 'ENOENT' ? 'The server is missing yt-dlp. Install it and ensure the yt-dlp command is on PATH.' : 'Could not start the media downloader.')));
    child.on('close', code => {
      if (code !== 0) {
        finish(new Error(safeYtDlpError(stderr)));
        return;
      }
      if (isFfmpegMergerFailure(stderr)) {
        finish(new Error('Media processing tool (FFmpeg) encountered an error merging audio and video streams.'));
        return;
      }
      finish(null, { stdout, stderr, exitCode: code });
    });
  });
}

export function isFfmpegMergerFailure(stderr) {
  const s = String(stderr || '').toLowerCase();
  const mentionsTool = s.includes('ffmpeg') || s.includes('ffprobe');
  if (!mentionsTool) return false;
  // Specific patterns indicating binary absence or merger failure:
  // e.g. "ffmpeg not found", "ffmpeg is not installed", "merging of multiple formats but ffmpeg", "postprocessing: ffprobe or ffmpeg not found", "ffmpeg exited with code"
  return (
    s.includes('not found') ||
    s.includes('not installed') ||
    s.includes('merging of multiple formats') ||
    (s.includes('postprocessing') && (s.includes('error') || s.includes('failed') || s.includes('not found'))) ||
    s.includes('merger') ||
    s.includes('exited with code') ||
    s.includes('error while loading shared libraries')
  );
}

export function safeYtDlpError(stderr) {
  const s = String(stderr || '').toLowerCase();
  if (s.includes('empty media response')) return 'Instagram blocked guest access or sent an empty media response. The platform requires account login for this Reel.';
  if (s.includes('private') || s.includes('login required') || s.includes('sign in') || s.includes('cookies')) return 'This video is private, age-restricted, or requires login. ReelFlow does not collect social-media passwords or use login cookies.';
  if (s.includes('429') || s.includes('rate-limit')) return 'The platform is temporarily rate-limiting requests. Wait a while before trying again.';
  if (s.includes('unsupported url')) return 'This video URL could not be processed. Check the link or update yt-dlp.';
  if (isFfmpegMergerFailure(stderr)) {
    return 'Media processing tool (FFmpeg) encountered an error merging audio and video streams.';
  }
  return 'The platform did not provide accessible media. The video may be unavailable, restricted, or blocked by the platform.';
}

export async function buildMissingAudioDiagnostic({
  provider,
  tempDir,
  audioVerification,
  exitStatus = null,
  stdout = '',
  stderr = ''
}) {
  const sanitizedProvider = ['instagram', 'facebook', 'youtube'].includes(provider) ? provider : 'unknown';
  const fileEntries = [];
  let foundAudioIntermediate = false;
  let foundVideoIntermediate = false;
  let hasInconclusiveFiles = false;

  const audioExtensions = new Set(['.m4a', '.aac', '.mp3', '.opus', '.ogg', '.wav', '.flac']);
  const videoExtensions = new Set(['.mp4', '.mkv', '.webm', '.flv', '.mov', '.avi']);
  const finalOutputPattern = /^reelflow\.[a-zA-Z0-9]{1,8}$/;
  // Explicitly recognized yt-dlp intermediate file patterns (e.g. reelflow.f123.mp4, reelflow.fdash-audio.m4a, reelflow.temp.webm)
  const intermediatePattern = /^reelflow\.(f[a-zA-Z0-9_-]+|fdash-[a-zA-Z0-9_-]+|temp|[a-zA-Z0-9_-]+)\.[a-zA-Z0-9]{1,8}$/;

  try {
    const dirEntries = await fs.promises.readdir(tempDir, { withFileTypes: true });
    for (const ent of dirEntries) {
      if (!ent.isFile()) continue;
      // Match safe expected filenames starting with reelflow
      if (!/^reelflow(\.[a-zA-Z0-9._-]+)?$/.test(ent.name)) continue;

      let sizeBytes = null;
      try {
        const s = await fs.promises.stat(path.join(tempDir, ent.name));
        sizeBytes = s.size;
      } catch {}

      fileEntries.push({ name: ent.name, sizeBytes });

      const ext = path.extname(ent.name).toLowerCase();
      const isFinal = finalOutputPattern.test(ent.name);
      const isIntermediate = intermediatePattern.test(ent.name);

      if (isFinal) {
        // Final output file (e.g. reelflow.mp4), treated separately from intermediates
        continue;
      }

      if (!isIntermediate) {
        // Any file starting with reelflow that is neither recognized final output nor recognized intermediate
        hasInconclusiveFiles = true;
        continue;
      }

      if (audioExtensions.has(ext)) {
        foundAudioIntermediate = true;
      } else if (videoExtensions.has(ext)) {
        foundVideoIntermediate = true;
      } else {
        hasInconclusiveFiles = true;
      }
    }
  } catch {}

  let failureCategory = 'unknown';
  if (!audioVerification?.verified) {
    failureCategory = audioVerification?.reason || 'audio_verification_unverified';
  } else if (!audioVerification?.hasAudio) {
    if (foundAudioIntermediate) {
      failureCategory = 'audio_intermediate_present';
    } else if (hasInconclusiveFiles) {
      failureCategory = 'intermediate_files_inconclusive';
    } else if (foundVideoIntermediate) {
      failureCategory = 'audio_intermediate_missing';
    } else {
      failureCategory = 'video_only_output';
    }
  }

  const sanitizedStreams = Array.isArray(audioVerification?.streams)
    ? audioVerification.streams.slice(0, 10).map(s => {
        if (typeof s === 'object' && s !== null) {
          return {
            type: String(s.type || '').slice(0, 20),
            codec: String(s.codec || '').slice(0, 20)
          };
        }
        return { type: String(s || '').slice(0, 20), codec: '' };
      })
    : [];

  // Extract selected format IDs safely without logging arbitrary output or URLs
  // Pattern matches: "[info] ... Downloading [N] format(s): <format_ids>"
  let selectedFormatIds = null;
  let formatMessageSource = null;

  const stdoutStr = typeof stdout === 'string' ? stdout : '';
  const stderrStr = typeof stderr === 'string' ? stderr : '';

  const formatMatchStdout = stdoutStr.match(/Downloading \d+ format\(s\):\s*([a-zA-Z0-9_+.-]+)/);
  const formatMatchStderr = stderrStr.match(/Downloading \d+ format\(s\):\s*([a-zA-Z0-9_+.-]+)/);

  if (formatMatchStdout && formatMatchStdout[1]) {
    selectedFormatIds = formatMatchStdout[1].slice(0, 50);
    formatMessageSource = 'stdout';
  } else if (formatMatchStderr && formatMatchStderr[1]) {
    selectedFormatIds = formatMatchStderr[1].slice(0, 50);
    formatMessageSource = 'stderr';
  }

  // Detect whether a merger step was observed in stdout or stderr
  const mergerInStdout = stdoutStr.includes('[Merger]');
  const mergerInStderr = stderrStr.includes('[Merger]');
  const mergerObserved = mergerInStdout || mergerInStderr;
  let mergerMessageSource = null;
  if (mergerInStdout && mergerInStderr) {
    mergerMessageSource = 'both';
  } else if (mergerInStdout) {
    mergerMessageSource = 'stdout';
  } else if (mergerInStderr) {
    mergerMessageSource = 'stderr';
  }

  return {
    event: 'audio_verification_failure',
    provider: sanitizedProvider,
    failureCategory,
    exitStatus: typeof exitStatus === 'number' ? exitStatus : null,
    hasAudio: Boolean(audioVerification?.hasAudio),
    hasVideo: Boolean(audioVerification?.hasVideo),
    streams: sanitizedStreams,
    files: fileEntries.slice(0, 10),
    selectedFormatIds,
    formatMessageSource,
    mergerObserved,
    mergerMessageSource
  };
}

function safeMetadata(info, parsed, token) {
  // Extract available unique heights/resolutions from formats if provided
  let availableResolutions = [];
  if (Array.isArray(info.formats)) {
    const heights = new Set();
    for (const f of info.formats) {
      if (f && f.height && typeof f.height === 'number' && f.height > 0) {
        if (f.vcodec && f.vcodec !== 'none') {
          heights.add(f.height);
        }
      }
    }
    if (heights.size > 0) {
      availableResolutions = Array.from(heights).sort((a, b) => b - a);
    }
  }

  // Check if approximate/exact file size is reliably known
  let filesizeBytes = null;
  if (typeof info.filesize === 'number' && info.filesize > 0) {
    filesizeBytes = info.filesize;
  } else if (typeof info.filesize_approx === 'number' && info.filesize_approx > 0) {
    filesizeBytes = info.filesize_approx;
  }

  return {
    id: String(info.id || parsed.id).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100),
    provider: parsed.provider,
    permalink: parsed.canonical,
    mediaType: info.ext === 'mp4' || info.vcodec ? (parsed.provider === 'facebook' ? 'Facebook video' : 'Reel video') : `${parsed.provider} media`,
    title: String(info.title || info.description || '').slice(0, 300),
    caption: String(info.description || info.title || '').slice(0, 3000),
    duration: typeof info.duration === 'number' && info.duration > 0 ? Math.round(info.duration) : null,
    resolutions: availableResolutions,
    filesizeBytes: filesizeBytes,
    timestamp: info.timestamp ? new Date(info.timestamp * 1000).toISOString() : null,
    thumbnailUrl: typeof info.thumbnail === 'string' && /^https:\/\//i.test(info.thumbnail) ? info.thumbnail : null,
    downloadable: true,
    downloadUrl: `/api/media/${token}/download`,
    message: `Public ${parsed.provider === 'facebook' ? 'Facebook video' : 'Instagram media'} metadata found. Download only if you own this content or have permission from its rights holder.`
  };
}

app.get('/api/health', (_req, res) => {
  const ffmpeg = resolveFfmpegBinary();
  const ffprobe = resolveFfprobeBinary();
  return res.json({ 
    ok: true, 
    service: 'ReelFlow API', 
    downloader: 'yt-dlp', 
    ffmpeg: Boolean(ffmpeg),
    ffprobe: Boolean(ffprobe),
    mediaToolsReady: Boolean(ffmpeg && ffprobe),
    credentialsRequired: false, 
    supportedPlatforms: ['instagram', 'facebook', 'youtube'] 
  });
});

async function fetchYouTubeOEmbed(url) {
  const oEmbedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(oEmbedUrl, { signal: controller.signal, headers: { 'User-Agent': 'ReelFlow/1.0' } });
    clearTimeout(timeout);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

app.post('/api/media/lookup', async (req, res) => {
  const startTime = Date.now();
  const parsed = parseMediaPermalink(String(req.body?.url || '').trim());
  if (!parsed) {
    recordAnalyticsEvent({
      eventType: 'lookup',
      platform: 'unknown',
      outcome: 'failed',
      errorCategory: 'Invalid or unsupported URL',
      durationMs: Date.now() - startTime,
      statusCode: 400
    });
    return res.status(400).json({ error: 'Enter a supported public Instagram Reel, Facebook video, or YouTube URL.' });
  }

  // YouTube Compliant Workflow: Official metadata lookup via documented oEmbed API
  // No scraping, no arbitrary MP4 extraction, no DRM/anti-bot bypass
  if (parsed.provider === 'youtube') {
    const oembed = await fetchYouTubeOEmbed(parsed.canonical);
    recordAnalyticsEvent({
      eventType: 'lookup',
      platform: 'youtube',
      outcome: 'success',
      durationMs: Date.now() - startTime,
      statusCode: 200
    });

    const isShorts = parsed.canonical.includes('/shorts/');
    const title = oembed?.title || 'YouTube Video';
    const authorName = oembed?.author_name || '';
    const thumbnailUrl = oembed?.thumbnail_url || `https://i.ytimg.com/vi/${parsed.id}/hqdefault.jpg`;

    return res.json({
      id: parsed.id,
      provider: 'youtube',
      permalink: parsed.canonical,
      mediaType: isShorts ? 'YouTube Short' : 'YouTube Video',
      title: title,
      caption: authorName ? `By ${authorName} on YouTube` : 'Recognized YouTube media',
      author: authorName,
      duration: null,
      resolutions: [],
      filesizeBytes: null,
      timestamp: null,
      thumbnailUrl: thumbnailUrl,
      downloadable: false,
      downloadUrl: null,
      guidance: {
        isRecognized: true,
        type: 'creator_policy_notice',
        summary: 'Direct YouTube downloading is not available in this workflow to protect creator rights and adhere to platform terms.',
        creatorAction: 'If this is your own video, you can download your original MP4 file directly from YouTube Studio.',
        creatorUrl: 'https://studio.youtube.com/',
        viewerAction: 'For offline personal viewing on mobile devices, use YouTube Premium official offline downloads within the YouTube app. YouTube does not provide MP4 file exports for viewer downloads.',
        officialHelpUrl: 'https://support.google.com/youtube/answer/6141269'
      },
      message: 'YouTube video recognized. Direct downloading is not available in this workflow. Video creators can download original MP4 files via YouTube Studio.'
    });
  }

  try {
    const { stdout } = await runYtDlp(['--dump-single-json', '--no-warnings', '--no-playlist', '--skip-download', '--socket-timeout', '12', '--retries', '1', '--', parsed.canonical], 35_000);
    let info;
    try { info = JSON.parse(stdout.trim()); } catch { throw new Error('The platform returned unreadable media metadata.'); }
    if (!info || (!info.url && !Array.isArray(info.formats))) {
      recordAnalyticsEvent({
        eventType: 'lookup',
        platform: parsed.provider,
        outcome: 'failed',
        errorCategory: 'No downloadable media found',
        durationMs: Date.now() - startTime,
        statusCode: 404
      });
      return res.status(404).json({ error: 'No downloadable public video was found for this link.' });
    }

    pruneDownloadJobs();
    const token = randomUUID();
    downloadJobs.set(token, { url: parsed.canonical, provider: parsed.provider, expiresAt: Date.now() + JOB_TTL_MS });

    recordAnalyticsEvent({
      eventType: 'lookup',
      platform: parsed.provider,
      outcome: 'success',
      durationMs: Date.now() - startTime,
      statusCode: 200
    });

    return res.json(safeMetadata(info, parsed, token));
  } catch (error) {
    const message = error.message || 'Could not retrieve this video.';
    const status = message.includes('missing yt-dlp') ? 503 : (message.includes('timed out') ? 504 : 422);

    let errorCategory = 'Platform error';
    if (message.includes('missing yt-dlp')) errorCategory = 'Server missing yt-dlp';
    else if (message.includes('timed out')) errorCategory = 'Lookup timed out';
    else if (message.includes('Instagram blocked guest access')) errorCategory = 'Instagram login required';
    else if (message.includes('private') || message.includes('login required')) errorCategory = 'Restricted or login required';
    else if (message.includes('rate-limit') || message.includes('429')) errorCategory = 'Platform rate-limited';

    recordAnalyticsEvent({
      eventType: 'lookup',
      platform: parsed.provider,
      outcome: message.includes('timed out') ? 'timeout' : 'failed',
      errorCategory,
      durationMs: Date.now() - startTime,
      statusCode: status
    });

    return res.status(status).json({ error: message });
  }
});

export function formatForQuality(quality) {
  const allowed = new Set(['best', '1080', '720', '480', '360']);
  const selected = allowed.has(String(quality || 'best')) ? String(quality || 'best') : 'best';
  if (selected === 'best') {
    return 'bv*[ext=mp4]+ba[ext=m4a]/bv*+ba/b[ext=mp4]/b';
  }
  const height = Number(selected);
  return `bv*[height<=${height}][ext=mp4]+ba[ext=m4a]/bv*[height<=${height}]+ba/b[height<=${height}][ext=mp4]/b[height<=${height}]/b`;
}

app.get('/api/media/:token/download', async (req, res) => {
  const startTime = Date.now();
  pruneDownloadJobs();
  const token = String(req.params.token || '');
  const job = downloadJobs.get(token);
  if (!job || !/^[a-f0-9-]{36}$/i.test(token)) {
    recordAnalyticsEvent({
      eventType: 'download',
      platform: 'unknown',
      outcome: 'failed',
      errorCategory: 'Expired or invalid download token',
      durationMs: Date.now() - startTime,
      statusCode: 404
    });
    return res.status(404).json({ error: 'This download link expired. Find the video again and retry.' });
  }

  if (activeDownloads >= MAX_ACTIVE_DOWNLOADS) {
    recordAnalyticsEvent({
      eventType: 'download',
      platform: job.provider,
      outcome: 'failed',
      errorCategory: 'Downloader busy (concurrency limit)',
      durationMs: Date.now() - startTime,
      statusCode: 429
    });
    res.setHeader('Retry-After', '10');
    return res.status(429).json({ 
      error: 'Downloads are busy right now. Please wait a few seconds and try again.',
      retryAfter: 10
    });
  }

  activeDownloads += 1;
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'reelflow-'));
  const outputTemplate = path.join(dir, 'reelflow.%(ext)s');
  let finished = false;
  let downloadRecorded = false;
  const abortController = new AbortController();

  const cleanup = async () => { 
    if (finished) return; 
    finished = true; 
    abortController.abort();
    activeDownloads = Math.max(0, activeDownloads - 1); 
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {}); 
  };

  res.on('close', () => { 
    if (!res.writableEnded) {
      if (!downloadRecorded) {
        downloadRecorded = true;
        recordAnalyticsEvent({
          eventType: 'download',
          platform: job.provider,
          outcome: 'aborted',
          errorCategory: 'Client disconnected before download completed',
          durationMs: Date.now() - startTime,
          statusCode: 499
        });
      }
      cleanup();
    }
  });

  let ytDlpResult = null;
  try {
    ytDlpResult = await runYtDlp(
      ['--no-playlist', '--no-part', '--merge-output-format', 'mp4', '--max-filesize', String(MAX_DOWNLOAD_BYTES), '--socket-timeout', '12', '--retries', '1', '-f', formatForQuality(req.query.quality), '-o', outputTemplate, '--', job.url],
      120_000,
      abortController.signal
    );
    const files = await fs.promises.readdir(dir);
    const filename = files.find(name => /^reelflow\.[a-zA-Z0-9]{1,8}$/.test(name));
    if (!filename) throw new Error('No video file was produced. The Reel may be unavailable or restricted.');
    const fullPath = path.join(dir, filename);
    const stat = await fs.promises.stat(fullPath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_DOWNLOAD_BYTES) throw new Error('The video exceeded the permitted download size.');

    const audioVerification = await verifyMediaAudio(fullPath);
    if (!audioVerification.verified || !audioVerification.hasAudio) {
      try {
        const diag = await buildMissingAudioDiagnostic({
          provider: job.provider,
          tempDir: dir,
          audioVerification,
          exitStatus: ytDlpResult?.exitCode ?? null,
          stdout: ytDlpResult?.stdout ?? '',
          stderr: ytDlpResult?.stderr ?? ''
        });
        console.warn(`[DIAGNOSTIC] Missing audio: ${JSON.stringify(diag)}`);
      } catch {}

      if (audioVerification.verified && !audioVerification.hasAudio) {
        throw new Error('Downloaded video stream has no audio. The audio track could not be retrieved or merged.');
      }
      throw new Error('Video audio track could not be verified by media tools.');
    }

    const ext = path.extname(filename).toLowerCase();

    res.setHeader('Content-Type', ext === '.mp4' ? 'video/mp4' : 'application/octet-stream');
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader('Content-Disposition', `attachment; filename="reelflow-${job.provider}-${token.slice(0, 8)}.${ext === '.mp4' ? 'mp4' : 'video'}"`);
    res.setHeader('Cache-Control', 'no-store');

    const stream = fs.createReadStream(fullPath);
    stream.on('error', async () => { 
      if (!downloadRecorded) {
        downloadRecorded = true;
        recordAnalyticsEvent({
          eventType: 'download',
          platform: job.provider,
          outcome: 'failed',
          errorCategory: 'Disk stream error',
          durationMs: Date.now() - startTime,
          statusCode: 500
        });
      }
      if (!res.headersSent) res.status(500).json({ error: 'Could not read the downloaded file.' }); 
      await cleanup(); 
    });

    stream.on('close', () => {
      if (!downloadRecorded) {
        downloadRecorded = true;
        recordAnalyticsEvent({
          eventType: 'download',
          platform: job.provider,
          outcome: 'success',
          durationMs: Date.now() - startTime,
          statusCode: 200
        });
      }
      cleanup();
    });

    stream.pipe(res);
  } catch (error) {
    if (!downloadRecorded) {
      downloadRecorded = true;
      const msg = error.message || '';
      let cat = 'Download processing failed';
      if (msg.includes('timed out')) cat = 'Download timed out';
      else if (msg.includes('exceeded the permitted download size')) cat = 'Exceeded maximum file size';
      else if (msg.includes('missing yt-dlp')) cat = 'Server missing yt-dlp';
      else if (msg.includes('no audio')) cat = 'Video stream missing audio';
      else if (msg.includes('could not be verified')) cat = 'Audio stream unverified';
      else if (msg.includes('FFmpeg')) cat = 'FFmpeg merge failed';

      recordAnalyticsEvent({
        eventType: 'download',
        platform: job.provider,
        outcome: msg.includes('timed out') ? 'timeout' : 'failed',
        errorCategory: cat,
        durationMs: Date.now() - startTime,
        statusCode: msg.includes('missing yt-dlp') ? 503 : 422
      });
    }

    await cleanup();
    if (!res.headersSent) res.status(error.message?.includes('missing yt-dlp') ? 503 : 422).json({ error: error.message || 'Download failed. The Reel may be unavailable or restricted.' });
  }
});

// Admin Authentication & Analytics APIs
app.post('/api/admin/login', checkLoginRateLimit, (req, res) => {
  const { password } = req.body || {};
  if (!verifyAdminPassword(password)) {
    return res.status(401).json({ error: 'Invalid admin password.' });
  }
  const token = createAdminSession();
  const isProduction = process.env.NODE_ENV === 'production';
  res.cookie('reelflow_admin_token', token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'strict' : 'lax',
    maxAge: 12 * 60 * 60 * 1000
  });
  return res.json({ ok: true, token });
});

app.post('/api/admin/logout', (req, res) => {
  const token = extractToken(req);
  if (token) {
    destroyAdminSession(token);
  }
  res.clearCookie('reelflow_admin_token');
  return res.json({ ok: true });
});

app.get('/api/admin/auth/check', (req, res) => {
  const token = extractToken(req);
  return res.json({ authenticated: isValidAdminSession(token) });
});

app.get('/api/admin/analytics', requireAdminAuth, async (req, res) => {
  const range = String(req.query.range || '7d');
  if (!['24h', '7d', '30d'].includes(range)) {
    return res.status(400).json({ error: 'Invalid range filter. Allowed values: 24h, 7d, 30d' });
  }
  try {
    const data = await getAggregatedAnalytics(range, activeDownloads);
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve analytics.' });
  }
});

// SEO endpoints: robots.txt and sitemap.xml
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.sendFile(path.join(clientDist, 'robots.txt'), (err) => {
    if (err) {
      res.type('text/plain').send(
        `User-agent: *\nAllow: /\nAllow: /privacy\nAllow: /terms\nAllow: /contact\nAllow: /assets/\nAllow: /og-image.jpg\nDisallow: /admin\nDisallow: /admin/\nDisallow: /api/admin\nDisallow: /api/admin/\nDisallow: /api/media/download\n\nSitemap: https://reelflow-fq7d.onrender.com/sitemap.xml\n`
      );
    }
  });
});

app.get('/sitemap.xml', (req, res) => {
  res.type('application/xml');
  res.sendFile(path.join(clientDist, 'sitemap.xml'), (err) => {
    if (err) {
      res.type('application/xml').send(
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>https://reelflow-fq7d.onrender.com/</loc>\n    <lastmod>2026-10-16</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>1.0</priority>\n  </url>\n  <url>\n    <loc>https://reelflow-fq7d.onrender.com/privacy</loc>\n    <lastmod>2026-10-16</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>\n  <url>\n    <loc>https://reelflow-fq7d.onrender.com/terms</loc>\n    <lastmod>2026-10-16</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>\n  <url>\n    <loc>https://reelflow-fq7d.onrender.com/contact</loc>\n    <lastmod>2026-10-16</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>\n</urlset>\n`
      );
    }
  });
});


const clientDist = path.resolve(__dirname, '../dist');
app.use(express.static(clientDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(clientDist, 'index.html'), err => { if (err) next(); });
});

const isMainModule = Boolean(process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url));
if (isMainModule) {
  app.listen(PORT, () => console.log(`ReelFlow API running at http://localhost:${PORT}`));
}

export { app };
