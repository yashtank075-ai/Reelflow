import pg from 'pg';
import crypto from 'node:crypto';

const { Pool } = pg;

// In-memory fallback ring buffers for resilient analytics when DB is not configured or temporarily down
const MEMORY_LIMIT = 5000;
const memoryEvents = [];
const memoryRateLimitEvents = [];

let pool = null;
let dbInitialized = false;

// Check if DATABASE_URL is configured
if (process.env.DATABASE_URL) {
  try {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    pool.on('error', (err) => {
      console.error('[Analytics DB Pool Error]', err.message);
    });
  } catch (err) {
    console.error('[Analytics DB Init Error]', err.message);
  }
}

/**
 * Initialize PostgreSQL Schema safely
 */
export async function initAnalyticsDb() {
  if (!pool) return false;
  try {
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS analytics_events (
          id BIGSERIAL PRIMARY KEY,
          event_type VARCHAR(32) NOT NULL,
          platform VARCHAR(16) NOT NULL,
          outcome VARCHAR(16) NOT NULL,
          error_category VARCHAR(64),
          duration_ms INTEGER,
          status_code INTEGER,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_analytics_created_at ON analytics_events(created_at);
        CREATE INDEX IF NOT EXISTS idx_analytics_event_type ON analytics_events(event_type);
        CREATE INDEX IF NOT EXISTS idx_analytics_platform ON analytics_events(platform);

        CREATE TABLE IF NOT EXISTS analytics_rate_limits (
          id BIGSERIAL PRIMARY KEY,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_analytics_rl_created_at ON analytics_rate_limits(created_at);
      `);
      dbInitialized = true;
      console.log('[Analytics] PostgreSQL schema verified and ready');
      return true;
    } finally {
      client.release();
    }
  } catch (err) {
    console.warn('[Analytics] DB connection failed. Using in-memory analytics mode:', err.message);
    return false;
  }
}

// Allowed enums for strict data validation (privacy-preserving)
const ALLOWED_EVENT_TYPES = new Set(['lookup', 'download']);
const ALLOWED_PLATFORMS = new Set(['instagram', 'facebook', 'youtube', 'unknown']);
const ALLOWED_OUTCOMES = new Set(['success', 'failed', 'aborted', 'timeout']);

/**
 * Record an analytics event asynchronously without blocking callers
 */
export function recordAnalyticsEvent({
  eventType,
  platform = 'unknown',
  outcome,
  errorCategory = null,
  durationMs = null,
  statusCode = null,
}) {
  const safeEventType = ALLOWED_EVENT_TYPES.has(eventType) ? eventType : 'unknown';
  const safePlatform = ALLOWED_PLATFORMS.has(platform) ? platform : 'unknown';
  const safeOutcome = ALLOWED_OUTCOMES.has(outcome) ? outcome : 'failed';
  const safeCategory = errorCategory ? String(errorCategory).slice(0, 64) : null;
  const safeDuration = typeof durationMs === 'number' && durationMs >= 0 ? Math.round(durationMs) : null;
  const safeStatus = typeof statusCode === 'number' ? statusCode : null;
  const now = new Date();

  // Always write to in-memory ring buffer (ensures dashboard works everywhere)
  memoryEvents.push({
    eventType: safeEventType,
    platform: safePlatform,
    outcome: safeOutcome,
    errorCategory: safeCategory,
    durationMs: safeDuration,
    statusCode: safeStatus,
    createdAt: now,
  });
  if (memoryEvents.length > MEMORY_LIMIT) memoryEvents.shift();

  // If DB is connected, persist asynchronously
  if (pool && dbInitialized) {
    pool.query(
      `INSERT INTO analytics_events (event_type, platform, outcome, error_category, duration_ms, status_code, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [safeEventType, safePlatform, safeOutcome, safeCategory, safeDuration, safeStatus, now]
    ).catch((err) => {
      console.error('[Analytics Event Write Error]', err.message);
    });
  }
}

/**
 * Record an HTTP 429 rate limit hit
 */
export function recordRateLimitHit() {
  const now = new Date();
  memoryRateLimitEvents.push(now);
  if (memoryRateLimitEvents.length > MEMORY_LIMIT) memoryRateLimitEvents.shift();

  if (pool && dbInitialized) {
    pool.query(`INSERT INTO analytics_rate_limits (created_at) VALUES ($1)`, [now])
      .catch((err) => console.error('[Analytics Rate Limit Write Error]', err.message));
  }
}

/**
 * Run 30-day retention cleanup safely
 */
export async function pruneOldAnalytics() {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  
  // Prune memory
  const memCutoffTime = cutoff.getTime();
  while (memoryEvents.length > 0 && memoryEvents[0].createdAt.getTime() < memCutoffTime) {
    memoryEvents.shift();
  }
  while (memoryRateLimitEvents.length > 0 && memoryRateLimitEvents[0].getTime() < memCutoffTime) {
    memoryRateLimitEvents.shift();
  }

  // Prune database if connected
  if (pool && dbInitialized) {
    try {
      await pool.query(`DELETE FROM analytics_events WHERE created_at < $1`, [cutoff]);
      await pool.query(`DELETE FROM analytics_rate_limits WHERE created_at < $1`, [cutoff]);
    } catch (err) {
      console.error('[Analytics Retention Error]', err.message);
    }
  }
}

/**
 * Query aggregated analytics for the admin dashboard
 */
export async function getAggregatedAnalytics(range = '7d', activeDownloadsCount = 0) {
  const validRanges = { '24h': 1, '7d': 7, '30d': 30 };
  const days = validRanges[range] || 7;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  if (pool && dbInitialized) {
    try {
      return await queryDatabaseAnalytics(since, activeDownloadsCount);
    } catch (err) {
      console.warn('[Analytics] DB query failed, falling back to in-memory store:', err.message);
    }
  }

  return queryMemoryAnalytics(since, activeDownloadsCount);
}

async function queryDatabaseAnalytics(since, activeDownloadsCount) {
  const client = await pool.connect();
  try {
    const summaryRes = await client.query(`
      SELECT 
        COUNT(*) FILTER (WHERE event_type = 'lookup') as total_lookups,
        COUNT(*) FILTER (WHERE event_type = 'lookup' AND outcome = 'success') as successful_lookups,
        COUNT(*) FILTER (WHERE event_type = 'lookup' AND outcome != 'success') as failed_lookups,
        COUNT(*) FILTER (WHERE event_type = 'download') as total_downloads,
        COUNT(*) FILTER (WHERE event_type = 'download' AND outcome = 'success') as completed_downloads,
        COUNT(*) FILTER (WHERE event_type = 'download' AND outcome != 'success') as failed_downloads,
        COUNT(*) FILTER (WHERE platform = 'instagram') as instagram_events,
        COUNT(*) FILTER (WHERE platform = 'facebook') as facebook_events,
        COUNT(*) FILTER (WHERE platform = 'youtube') as youtube_events,
        AVG(duration_ms) FILTER (WHERE duration_ms IS NOT NULL) as avg_duration_ms
      FROM analytics_events
      WHERE created_at >= $1
    `, [since]);

    const rlRes = await client.query(`
      SELECT COUNT(*) as rate_limit_hits FROM analytics_rate_limits WHERE created_at >= $1
    `, [since]);

    const errorsRes = await client.query(`
      SELECT error_category, COUNT(*) as count
      FROM analytics_events
      WHERE created_at >= $1 AND error_category IS NOT NULL
      GROUP BY error_category
      ORDER BY count DESC
      LIMIT 10
    `, [since]);

    const trendsRes = await client.query(`
      SELECT 
        DATE_TRUNC('day', created_at) as day,
        COUNT(*) FILTER (WHERE event_type = 'lookup') as lookups,
        COUNT(*) FILTER (WHERE event_type = 'download' AND outcome = 'success') as downloads
      FROM analytics_events
      WHERE created_at >= $1
      GROUP BY day
      ORDER BY day ASC
    `, [since]);

    const s = summaryRes.rows[0] || {};
    const totalDownloads = Number(s.total_downloads || 0);
    const completedDownloads = Number(s.completed_downloads || 0);
    const downloadSuccessRate = totalDownloads > 0 ? Math.round((completedDownloads / totalDownloads) * 100) : 0;

    return {
      storageType: 'PostgreSQL',
      summary: {
        totalLookups: Number(s.total_lookups || 0),
        successfulLookups: Number(s.successful_lookups || 0),
        failedLookups: Number(s.failed_lookups || 0),
        downloadAttempts: totalDownloads,
        downloadsCompleted: completedDownloads,
        downloadsFailedOrAborted: Number(s.failed_downloads || 0),
        downloadSuccessRate,
        instagramCount: Number(s.instagram_events || 0),
        facebookCount: Number(s.facebook_events || 0),
        youtubeCount: Number(s.youtube_events || 0),
        avgDurationMs: s.avg_duration_ms ? Math.round(Number(s.avg_duration_ms)) : null,
        rateLimitCount: Number(rlRes.rows[0]?.rate_limit_hits || 0),
        activeDownloads: activeDownloadsCount,
      },
      topErrors: errorsRes.rows.map(r => ({ category: r.error_category, count: Number(r.count) })),
      dailyTrends: trendsRes.rows.map(r => ({
        date: r.day ? new Date(r.day).toISOString().split('T')[0] : '',
        lookups: Number(r.lookups || 0),
        downloads: Number(r.downloads || 0),
      })),
    };
  } finally {
    client.release();
  }
}

function queryMemoryAnalytics(since, activeDownloadsCount) {
  const sinceTime = since.getTime();
  const events = memoryEvents.filter(e => e.createdAt.getTime() >= sinceTime);
  const rlHits = memoryRateLimitEvents.filter(d => d.getTime() >= sinceTime).length;

  let totalLookups = 0;
  let successfulLookups = 0;
  let failedLookups = 0;
  let downloadAttempts = 0;
  let downloadsCompleted = 0;
  let downloadsFailedOrAborted = 0;
  let instagramCount = 0;
  let facebookCount = 0;
  let youtubeCount = 0;
  let durationSum = 0;
  let durationCount = 0;

  const errorCounts = {};
  const dayBuckets = {};

  for (const e of events) {
    if (e.platform === 'instagram') instagramCount++;
    if (e.platform === 'facebook') facebookCount++;
    if (e.platform === 'youtube') youtubeCount++;

    if (e.eventType === 'lookup') {
      totalLookups++;
      if (e.outcome === 'success') successfulLookups++;
      else failedLookups++;
    } else if (e.eventType === 'download') {
      downloadAttempts++;
      if (e.outcome === 'success') downloadsCompleted++;
      else downloadsFailedOrAborted++;
    }

    if (e.durationMs) {
      durationSum += e.durationMs;
      durationCount++;
    }

    if (e.errorCategory) {
      errorCounts[e.errorCategory] = (errorCounts[e.errorCategory] || 0) + 1;
    }

    const dayKey = e.createdAt.toISOString().split('T')[0];
    if (!dayBuckets[dayKey]) dayBuckets[dayKey] = { lookups: 0, downloads: 0 };
    if (e.eventType === 'lookup') dayBuckets[dayKey].lookups++;
    if (e.eventType === 'download' && e.outcome === 'success') dayBuckets[dayKey].downloads++;
  }

  const downloadSuccessRate = downloadAttempts > 0 ? Math.round((downloadsCompleted / downloadAttempts) * 100) : 0;
  const avgDurationMs = durationCount > 0 ? Math.round(durationSum / durationCount) : null;

  const topErrors = Object.entries(errorCounts)
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const dailyTrends = Object.entries(dayBuckets)
    .map(([date, counts]) => ({ date, lookups: counts.lookups, downloads: counts.downloads }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    storageType: pool && dbInitialized ? 'PostgreSQL' : 'In-Memory (Resilient)',
    summary: {
      totalLookups,
      successfulLookups,
      failedLookups,
      downloadAttempts,
      downloadsCompleted,
      downloadsFailedOrAborted,
      downloadSuccessRate,
      instagramCount,
      facebookCount,
      youtubeCount,
      avgDurationMs,
      rateLimitCount: rlHits,
      activeDownloads: activeDownloadsCount,
    },
    topErrors,
    dailyTrends,
  };
}
