import pg from 'pg';
import crypto from 'node:crypto';

const { Pool } = pg;

// In-memory fallback ring buffers for resilient analytics when DB is not configured or temporarily down
const MEMORY_LIMIT = 5000;
let memoryEvents = [];
let memoryRateLimitEvents = [];

let pool = null;
let dbInitialized = false;
let dbInitializationError = null;

/**
 * Configure or reconfigure the PostgreSQL connection pool
 */
export function configurePool(connectionString = process.env.DATABASE_URL, customPool = null) {
  if (pool) {
    try {
      pool.end().catch(() => {});
    } catch {}
    pool = null;
    dbInitialized = false;
    dbInitializationError = null;
  }

  if (customPool) {
    pool = customPool;
    return pool;
  }

  if (connectionString) {
    try {
      const PoolClass = pg.Pool || Pool;
      pool = new PoolClass({
        connectionString,
        ssl: connectionString.includes('localhost') || connectionString.includes('127.0.0.1')
          ? false
          : { rejectUnauthorized: false },
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      });
      pool.on('error', (err) => {
        console.error('[Analytics DB Pool Error]', err.message);
      });
    } catch (err) {
      dbInitializationError = err.message;
      console.error('[Analytics DB Pool Creation Error]', err.message);
    }
  }
  return pool;
}

// Automatically configure pool on module load if DATABASE_URL is present
if (process.env.DATABASE_URL) {
  configurePool(process.env.DATABASE_URL);
}

/**
 * Close pool and cleanup (useful for tests or graceful shutdown)
 */
export async function closePool() {
  if (pool) {
    try {
      await pool.end();
    } catch {}
    pool = null;
  }
  dbInitialized = false;
  dbInitializationError = null;
}

/**
 * Reset memory analytics (primarily for testing purposes)
 */
export function resetMemoryAnalytics() {
  memoryEvents = [];
  memoryRateLimitEvents = [];
}

/**
 * Initialize PostgreSQL Schema safely without recreating or erasing existing data
 */
export async function initAnalyticsDb() {
  if (!pool && process.env.DATABASE_URL) {
    configurePool(process.env.DATABASE_URL);
  }
  if (!pool) {
    dbInitialized = false;
    return false;
  }
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
      dbInitializationError = null;
      console.log('[Analytics] PostgreSQL schema verified and ready');
      return true;
    } finally {
      client.release();
    }
  } catch (err) {
    dbInitialized = false;
    dbInitializationError = err.message;
    console.warn('[Analytics] DB connection failed. Using in-memory analytics mode:', err.message);
    return false;
  }
}

/**
 * Get current storage status for diagnostic reporting
 */
export function getAnalyticsStorageStatus() {
  return {
    isConfigured: Boolean(process.env.DATABASE_URL),
    isInitialized: dbInitialized && Boolean(pool),
    error: dbInitializationError,
  };
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
  createdAt = null,
}) {
  const safeEventType = ALLOWED_EVENT_TYPES.has(eventType) ? eventType : 'unknown';
  const safePlatform = ALLOWED_PLATFORMS.has(platform) ? platform : 'unknown';
  const safeOutcome = ALLOWED_OUTCOMES.has(outcome) ? outcome : 'failed';
  const safeCategory = errorCategory ? String(errorCategory).slice(0, 64) : null;
  const safeDuration = typeof durationMs === 'number' && durationMs >= 0 ? Math.round(durationMs) : null;
  const safeStatus = typeof statusCode === 'number' ? statusCode : null;
  const now = createdAt instanceof Date ? createdAt : new Date();

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
export function recordRateLimitHit(timestamp = null) {
  const now = timestamp instanceof Date ? timestamp : new Date();
  memoryRateLimitEvents.push(now);
  if (memoryRateLimitEvents.length > MEMORY_LIMIT) memoryRateLimitEvents.shift();

  if (pool && dbInitialized) {
    pool.query(`INSERT INTO analytics_rate_limits (created_at) VALUES ($1)`, [now])
      .catch((err) => console.error('[Analytics Rate Limit Write Error]', err.message));
  }
}

/**
 * Run 30-day retention cleanup safely (preserves 7-day reports)
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
 * Generate a contiguous list of calendar days in UTC (YYYY-MM-DD)
 * @param {number} dayCount - Number of days up to and including today in UTC
 * @param {Date} [referenceDate] - Optional anchor date (defaults to now)
 */
export function generateUtcDateBuckets(dayCount = 7, referenceDate = new Date()) {
  const buckets = [];
  const ref = new Date(referenceDate);
  const anchorMidnight = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate());

  for (let i = dayCount - 1; i >= 0; i--) {
    const dayDate = new Date(anchorMidnight - i * 86400000);
    buckets.push(dayDate.toISOString().split('T')[0]);
  }
  return buckets;
}

/**
 * Query aggregated analytics for the admin dashboard
 */
export async function getAggregatedAnalytics(range = '7d', activeDownloadsCount = 0) {
  const validRanges = { '24h': 1, '7d': 7, '30d': 30 };
  const days = validRanges[range] || 7;

  // For 7d and 30d, compute calendar start at 00:00:00.000 UTC
  const now = new Date();
  let since;
  if (days === 1) {
    since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  } else {
    since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1), 0, 0, 0, 0));
  }

  const expectedDays = days > 1 ? generateUtcDateBuckets(days, now) : [];

  if (pool && dbInitialized) {
    try {
      return await queryDatabaseAnalytics(since, activeDownloadsCount, expectedDays);
    } catch (err) {
      console.warn('[Analytics] DB query failed, falling back to in-memory store:', err.message);
      const fallbackData = queryMemoryAnalytics(since, activeDownloadsCount, expectedDays);
      fallbackData.storageType = 'In-Memory (Fallback)';
      fallbackData.isPersistent = false;
      fallbackData.storageWarning = 'Database query failed. Displaying temporary in-memory metrics. Real persistence is temporarily degraded.';
      return fallbackData;
    }
  }

  const memData = queryMemoryAnalytics(since, activeDownloadsCount, expectedDays);
  if (process.env.DATABASE_URL) {
    memData.storageType = 'In-Memory (DB Unreachable)';
    memData.isPersistent = false;
    memData.storageWarning = 'DATABASE_URL is configured but database connection could not be established. Historical data will reset on server restart.';
  } else {
    memData.storageType = 'In-Memory (Ephemeral)';
    memData.isPersistent = false;
    memData.storageWarning = 'DATABASE_URL is not set. Analytics are running in ephemeral in-memory mode and will reset on server restart or redeploy.';
  }
  return memData;
}

async function queryDatabaseAnalytics(since, activeDownloadsCount, expectedDays = []) {
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
        TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') as day,
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

    // Map DB trends into daily buckets
    const trendMap = new Map();
    for (const row of trendsRes.rows) {
      if (row.day) {
        trendMap.set(row.day, {
          date: row.day,
          lookups: Number(row.lookups || 0),
          downloads: Number(row.downloads || 0),
        });
      }
    }

    let dailyTrends;
    if (expectedDays.length > 0) {
      dailyTrends = expectedDays.map(d => trendMap.get(d) || { date: d, lookups: 0, downloads: 0 });
    } else {
      dailyTrends = Array.from(trendMap.values()).sort((a, b) => a.date.localeCompare(b.date));
    }

    return {
      storageType: 'PostgreSQL',
      isPersistent: true,
      storageWarning: null,
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
      dailyTrends,
    };
  } finally {
    client.release();
  }
}

function queryMemoryAnalytics(since, activeDownloadsCount, expectedDays = []) {
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

  let dailyTrends;
  if (expectedDays.length > 0) {
    dailyTrends = expectedDays.map(d => ({
      date: d,
      lookups: dayBuckets[d]?.lookups || 0,
      downloads: dayBuckets[d]?.downloads || 0,
    }));
  } else {
    dailyTrends = Object.entries(dayBuckets)
      .map(([date, counts]) => ({ date, lookups: counts.lookups, downloads: counts.downloads }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  return {
    storageType: 'In-Memory (Resilient)',
    isPersistent: false,
    storageWarning: null,
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

