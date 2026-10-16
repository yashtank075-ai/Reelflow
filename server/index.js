import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
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
  verifyAdminPassword, 
  createAdminSession, 
  destroyAdminSession, 
  isValidAdminSession, 
  checkLoginRateLimit, 
  requireAdminAuth,
  extractToken
} from './auth.js';

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
const downloadJobs = new Map();
const JOB_TTL_MS = 15 * 60 * 1000;

function parseMediaPermalink(input) {
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
    const isVideoPath = /^\/(?:watch\/?|reel\/|share\/v\/|share\/r\/|videos\/|[^/]+\/videos\/)/i.test(url.pathname) || host === 'fb.watch';
    const hasVideoId = url.searchParams.has('v') || url.searchParams.has('story_fbid') || /\/(?:videos|reel|share\/[vr])\/[A-Za-z0-9._-]+/i.test(url.pathname) || host === 'fb.watch';
    if (!isVideoPath || !hasVideoId) return null;
    url.hash = '';
    return { provider: 'facebook', id: url.pathname.split('/').filter(Boolean).pop()?.slice(0, 100) || 'video', canonical: url.toString() };
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

function runYtDlp(args, timeoutMs = 45_000) {
  return new Promise((resolve, reject) => {
    const binary = resolveYtDlpBinary();
    const child = spawn(binary, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let settled = false;
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error('The media request timed out. Try again later.')); }, timeoutMs);
    const finish = (err, value) => { if (settled) return; settled = true; clearTimeout(timer); err ? reject(err) : resolve(value); };
    child.stdout.on('data', chunk => { stdout += chunk.toString(); if (stdout.length > 2_000_000) { child.kill('SIGKILL'); finish(new Error('Media metadata response was too large.')); } });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-4000); });
    child.on('error', err => finish(new Error(err.code === 'ENOENT' ? 'The server is missing yt-dlp. Install it and ensure the yt-dlp command is on PATH.' : 'Could not start the media downloader.')));
    child.on('close', code => code === 0 ? finish(null, { stdout, stderr }) : finish(new Error(safeYtDlpError(stderr))));
  });
}
function safeYtDlpError(stderr) {
  const s = String(stderr || '').toLowerCase();
  if (s.includes('empty media response')) return 'Instagram blocked guest access or sent an empty media response. The platform requires account login for this Reel.';
  if (s.includes('private') || s.includes('login required') || s.includes('sign in') || s.includes('cookies')) return 'This video is private, age-restricted, or requires login. ReelFlow does not collect social-media passwords or use login cookies.';
  if (s.includes('429') || s.includes('rate-limit')) return 'The platform is temporarily rate-limiting requests. Wait a while before trying again.';
  if (s.includes('unsupported url')) return 'This video URL could not be processed. Check the link or update yt-dlp.';
  return 'The platform did not provide accessible media. The video may be unavailable, restricted, or blocked by the platform.';
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

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'ReelFlow API', downloader: 'yt-dlp', credentialsRequired: false, supportedPlatforms: ['instagram', 'facebook'] }));

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
    return res.status(400).json({ error: 'Enter a supported public Instagram Reel or Facebook video URL.' });
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

function formatForQuality(quality) {
  const allowed = new Set(['best', '1080', '720', '480', '360']);
  const selected = allowed.has(String(quality || 'best')) ? String(quality || 'best') : 'best';
  if (selected === 'best') return 'best[ext=mp4]/best';
  const height = Number(selected);
  return `best[height<=${height}][ext=mp4]/best[height<=${height}]/best`;
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
    return res.status(429).json({ error: 'The downloader is busy. Please retry shortly.' });
  }

  activeDownloads += 1;
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'reelflow-'));
  const outputTemplate = path.join(dir, 'reelflow.%(ext)s');
  let finished = false;
  let downloadRecorded = false;

  const cleanup = async () => { 
    if (finished) return; 
    finished = true; 
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

  try {
    await runYtDlp(['--no-warnings', '--no-playlist', '--no-part', '--max-filesize', String(MAX_DOWNLOAD_BYTES), '--socket-timeout', '12', '--retries', '1', '-f', formatForQuality(req.query.quality), '-o', outputTemplate, '--', job.url], 120_000);
    const files = await fs.promises.readdir(dir);
    const filename = files.find(name => /^reelflow\.[a-zA-Z0-9]{1,8}$/.test(name));
    if (!filename) throw new Error('No video file was produced. The Reel may be unavailable or restricted.');
    const fullPath = path.join(dir, filename);
    const stat = await fs.promises.stat(fullPath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_DOWNLOAD_BYTES) throw new Error('The video exceeded the permitted download size.');
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

const clientDist = path.resolve(__dirname, '../dist');
app.use(express.static(clientDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(clientDist, 'index.html'), err => { if (err) next(); });
});
app.listen(PORT, () => console.log(`ReelFlow API running at http://localhost:${PORT}`));
