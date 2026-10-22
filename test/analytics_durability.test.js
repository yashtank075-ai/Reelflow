import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {
  initAnalyticsDb,
  recordAnalyticsEvent,
  recordRateLimitHit,
  getAggregatedAnalytics,
  generateUtcDateBuckets,
  pruneOldAnalytics,
  configurePool,
  closePool,
  resetMemoryAnalytics
} from '../server/analytics.js';
import {
  createAdminSession,
  isValidAdminSession,
  verifyAdminPassword,
  extractToken,
  requireAdminAuth
} from '../server/auth.js';

// Setup Mock PostgreSQL Client and Pool for durable storage testing
class MockPgClient {
  constructor(dbState) {
    this.dbState = dbState;
  }

  async query(sql, params = []) {
    const s = sql.trim();

    // 1. Table creation queries
    if (s.includes('CREATE TABLE IF NOT EXISTS') || s.includes('CREATE INDEX IF NOT EXISTS')) {
      return { rows: [] };
    }

    // 2. Insert event
    if (s.startsWith('INSERT INTO analytics_events')) {
      const [eventType, platform, outcome, errorCategory, durationMs, statusCode, createdAt] = params;
      const row = {
        id: this.dbState.events.length + 1,
        event_type: eventType,
        platform,
        outcome,
        error_category: errorCategory,
        duration_ms: durationMs,
        status_code: statusCode,
        created_at: new Date(createdAt),
      };
      this.dbState.events.push(row);
      return { rows: [row], rowCount: 1 };
    }

    // 3. Insert rate limit
    if (s.startsWith('INSERT INTO analytics_rate_limits')) {
      const [createdAt] = params;
      const row = {
        id: this.dbState.rateLimits.length + 1,
        created_at: new Date(createdAt),
      };
      this.dbState.rateLimits.push(row);
      return { rows: [row], rowCount: 1 };
    }

    // 4. Delete / prune queries
    if (s.startsWith('DELETE FROM analytics_events WHERE created_at < $1')) {
      const cutoff = new Date(params[0]);
      const initialCount = this.dbState.events.length;
      this.dbState.events = this.dbState.events.filter(e => e.created_at >= cutoff);
      return { rowCount: initialCount - this.dbState.events.length };
    }
    if (s.startsWith('DELETE FROM analytics_rate_limits WHERE created_at < $1')) {
      const cutoff = new Date(params[0]);
      const initialCount = this.dbState.rateLimits.length;
      this.dbState.rateLimits = this.dbState.rateLimits.filter(r => r.created_at >= cutoff);
      return { rowCount: initialCount - this.dbState.rateLimits.length };
    }

    // 5. Aggregate Summary query
    if (s.includes('COUNT(*) FILTER (WHERE event_type = \'lookup\') as total_lookups')) {
      const since = new Date(params[0]);
      const filtered = this.dbState.events.filter(e => e.created_at >= since);

      let totalLookups = 0;
      let successfulLookups = 0;
      let failedLookups = 0;
      let totalDownloads = 0;
      let completedDownloads = 0;
      let failedDownloads = 0;
      let instagramEvents = 0;
      let facebookEvents = 0;
      let youtubeEvents = 0;
      let durationSum = 0;
      let durationCount = 0;

      for (const e of filtered) {
        if (e.event_type === 'lookup') {
          totalLookups++;
          if (e.outcome === 'success') successfulLookups++;
          else failedLookups++;
        }
        if (e.event_type === 'download') {
          totalDownloads++;
          if (e.outcome === 'success') completedDownloads++;
          else failedDownloads++;
        }
        if (e.platform === 'instagram') instagramEvents++;
        if (e.platform === 'facebook') facebookEvents++;
        if (e.platform === 'youtube') youtubeEvents++;
        if (typeof e.duration_ms === 'number' && e.duration_ms >= 0) {
          durationSum += e.duration_ms;
          durationCount++;
        }
      }

      return {
        rows: [{
          total_lookups: totalLookups,
          successful_lookups: successfulLookups,
          failed_lookups: failedLookups,
          total_downloads: totalDownloads,
          completed_downloads: completedDownloads,
          failed_downloads: failedDownloads,
          instagram_events: instagramEvents,
          facebook_events: facebookEvents,
          youtube_events: youtubeEvents,
          avg_duration_ms: durationCount > 0 ? durationSum / durationCount : null,
        }]
      };
    }

    // 6. Rate limits count query
    if (s.includes('SELECT COUNT(*) as rate_limit_hits FROM analytics_rate_limits')) {
      const since = new Date(params[0]);
      const hits = this.dbState.rateLimits.filter(r => r.created_at >= since).length;
      return { rows: [{ rate_limit_hits: hits }] };
    }

    // 7. Top errors query
    if (s.includes('SELECT error_category, COUNT(*) as count') && s.includes('FROM analytics_events')) {
      const since = new Date(params[0]);
      const errorMap = {};
      for (const e of this.dbState.events) {
        if (e.created_at >= since && e.error_category) {
          errorMap[e.error_category] = (errorMap[e.error_category] || 0) + 1;
        }
      }
      const rows = Object.entries(errorMap)
        .map(([error_category, count]) => ({ error_category, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
      return { rows };
    }

    // 8. Daily trends query (TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'))
    if (s.includes('GROUP BY day') && s.includes('ORDER BY day ASC')) {
      const since = new Date(params[0]);
      const dayMap = {};
      for (const e of this.dbState.events) {
        if (e.created_at >= since) {
          const day = e.created_at.toISOString().split('T')[0];
          if (!dayMap[day]) dayMap[day] = { day, lookups: 0, downloads: 0 };
          if (e.event_type === 'lookup') dayMap[day].lookups++;
          if (e.event_type === 'download' && e.outcome === 'success') dayMap[day].downloads++;
        }
      }
      const rows = Object.values(dayMap).sort((a, b) => a.day.localeCompare(b.day));
      return { rows };
    }

    return { rows: [] };
  }

  release() {}
}

class MockPgPool {
  constructor(dbState, shouldFailConnect = false) {
    this.dbState = dbState;
    this.shouldFailConnect = shouldFailConnect;
  }

  async connect() {
    if (this.shouldFailConnect) {
      throw new Error('Connection failed: PostgreSQL server unreachable');
    }
    return new MockPgClient(this.dbState);
  }

  async query(sql, params = []) {
    const client = await this.connect();
    return client.query(sql, params);
  }

  on() {}
  async end() {}
}

test('generateUtcDateBuckets: Returns 7 contiguous days up to today in chronological order', () => {
  const refDate = new Date('2026-10-22T15:30:00Z');
  const buckets = generateUtcDateBuckets(7, refDate);

  assert.equal(buckets.length, 7);
  assert.equal(buckets[6], '2026-10-22');
  assert.equal(buckets[5], '2026-10-21');
  assert.equal(buckets[4], '2026-10-20');
  assert.equal(buckets[3], '2026-10-19');
  assert.equal(buckets[2], '2026-10-18');
  assert.equal(buckets[1], '2026-10-17');
  assert.equal(buckets[0], '2026-10-16');

  // Verify chronological ascending order
  for (let i = 0; i < buckets.length - 1; i++) {
    assert.ok(buckets[i] < buckets[i + 1]);
  }
});

test('generateUtcDateBuckets: Correctly transitions across month boundaries', () => {
  const refDate = new Date('2026-03-03T02:00:00Z');
  const buckets = generateUtcDateBuckets(5, refDate);

  assert.deepEqual(buckets, [
    '2026-02-27',
    '2026-02-28',
    '2026-03-01',
    '2026-03-02',
    '2026-03-03'
  ]);
});

test('In-Memory Mode: Returns 7 zero-filled daily buckets when empty', async () => {
  resetMemoryAnalytics();
  const data = await getAggregatedAnalytics('7d');

  assert.equal(data.dailyTrends.length, 7);
  assert.equal(data.storageType.includes('In-Memory'), true);
  assert.equal(data.summary.totalLookups, 0);
  assert.equal(data.summary.downloadAttempts, 0);

  // Every bucket has lookups=0, downloads=0
  for (const bucket of data.dailyTrends) {
    assert.equal(bucket.lookups, 0);
    assert.equal(bucket.downloads, 0);
    assert.match(bucket.date, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test('Durable Storage: Simulating PostgreSQL persistence across reinitialization / restarts', async () => {
  const persistentDbState = { events: [], rateLimits: [] };

  try {
    const mockPool = new MockPgPool(persistentDbState);

    // 1. Initial server boot
    configurePool('postgresql://testuser:testpass@localhost:5432/reelflow_test', mockPool);
    const initialized = await initAnalyticsDb();
    assert.equal(initialized, true);

    // Record events on multiple dates
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000);
    const twoDaysAgoStr = twoDaysAgo.toISOString().split('T')[0];

    recordAnalyticsEvent({
      eventType: 'lookup',
      platform: 'instagram',
      outcome: 'success',
      durationMs: 150,
      statusCode: 200,
      createdAt: twoDaysAgo
    });

    recordAnalyticsEvent({
      eventType: 'download',
      platform: 'instagram',
      outcome: 'success',
      durationMs: 1200,
      statusCode: 200,
      createdAt: twoDaysAgo
    });

    recordAnalyticsEvent({
      eventType: 'lookup',
      platform: 'youtube',
      outcome: 'success',
      durationMs: 80,
      statusCode: 200,
      createdAt: now
    });

    recordRateLimitHit(now);

    // Give asynchronous writes a moment
    await new Promise(r => setTimeout(r, 20));

    // Verify initial data in DB
    assert.equal(persistentDbState.events.length, 3);
    assert.equal(persistentDbState.rateLimits.length, 1);

    // 2. SIMULATE APPLICATION RESTART
    // Clear in-memory buffers and close pool
    resetMemoryAnalytics();
    await closePool();

    // Reinitialize analytics module (as happens on deployment or restart) with the same underlying persistent database
    const reconnectedPool = new MockPgPool(persistentDbState);
    configurePool('postgresql://testuser:testpass@localhost:5432/reelflow_test', reconnectedPool);
    const reinitSuccess = await initAnalyticsDb();
    assert.equal(reinitSuccess, true);

    // Historical records must NOT be deleted or overwritten by initAnalyticsDb
    assert.equal(persistentDbState.events.length, 3);
    assert.equal(persistentDbState.rateLimits.length, 1);

    // 3. Query 7-day analytics after restart
    const data = await getAggregatedAnalytics('7d');
    assert.equal(data.storageType, 'PostgreSQL');
    assert.equal(data.isPersistent, true);
    assert.equal(data.storageWarning, null);
    assert.equal(data.summary.totalLookups, 2);
    assert.equal(data.summary.successfulLookups, 2);
    assert.equal(data.summary.downloadsCompleted, 1);
    assert.equal(data.summary.instagramCount, 2);
    assert.equal(data.summary.youtubeCount, 1);
    assert.equal(data.summary.rateLimitCount, 1);

    // Verify 7 daily buckets in chronological order
    assert.equal(data.dailyTrends.length, 7);
    const dayToday = data.dailyTrends.find(b => b.date === todayStr);
    assert.ok(dayToday);
    assert.equal(dayToday.lookups, 1);
    assert.equal(dayToday.downloads, 0);

    const dayPast = data.dailyTrends.find(b => b.date === twoDaysAgoStr);
    assert.ok(dayPast);
    assert.equal(dayPast.lookups, 1);
    assert.equal(dayPast.downloads, 1);

    // Days with 0 events exist and have 0 values
    const zeroDays = data.dailyTrends.filter(b => b.date !== todayStr && b.date !== twoDaysAgoStr);
    assert.ok(zeroDays.length > 0);
    for (const zd of zeroDays) {
      assert.equal(zd.lookups, 0);
      assert.equal(zd.downloads, 0);
    }

  } finally {
    await closePool();
    resetMemoryAnalytics();
  }
});

test('Boundary Handling: Events exactly at 00:00:00 UTC are assigned to the correct day', async () => {
  const persistentDbState = { events: [], rateLimits: [] };

  try {
    const mockPool = new MockPgPool(persistentDbState);
    configurePool('postgresql://testuser:testpass@localhost:5432/reelflow_test', mockPool);
    await initAnalyticsDb();

    // Event exactly at 2026-10-20T00:00:00.000Z
    const boundaryDate = new Date('2026-10-20T00:00:00.000Z');
    recordAnalyticsEvent({
      eventType: 'lookup',
      platform: 'facebook',
      outcome: 'success',
      createdAt: boundaryDate
    });

    await new Promise(r => setTimeout(r, 20));

    const data = await getAggregatedAnalytics('7d');
    const dayEntry = data.dailyTrends.find(d => d.date === '2026-10-20');
    if (dayEntry) {
      assert.equal(dayEntry.lookups, 1);
    }
  } finally {
    await closePool();
    resetMemoryAnalytics();
  }
});

test('Database Errors / Disconnections degrade safely with clear warnings', async () => {
  try {
    const mockFailingPool = new MockPgPool({}, true);
    configurePool('postgresql://unreachable-host:5432/db', mockFailingPool);
    const initResult = await initAnalyticsDb();
    assert.equal(initResult, false);

    // Even if DB fails, getAggregatedAnalytics should not throw and return clear warning
    const analytics = await getAggregatedAnalytics('7d');
    assert.ok(analytics);
    assert.equal(analytics.isPersistent, false);
    assert.ok(analytics.storageWarning);
    assert.equal(analytics.dailyTrends.length, 7);
  } finally {
    await closePool();
    resetMemoryAnalytics();
  }
});

test('30-day retention pruning does NOT prune records from the last 7 days', async () => {
  const persistentDbState = { events: [], rateLimits: [] };

  try {
    const mockPool = new MockPgPool(persistentDbState);
    configurePool('postgresql://testuser:testpass@localhost:5432/reelflow_test', mockPool);
    await initAnalyticsDb();

    // Event 5 days ago (should NOT be pruned)
    const fiveDaysAgo = new Date(Date.now() - 5 * 86400000);
    // Event 45 days ago (SHOULD be pruned)
    const fortyFiveDaysAgo = new Date(Date.now() - 45 * 86400000);

    recordAnalyticsEvent({ eventType: 'lookup', platform: 'instagram', outcome: 'success', createdAt: fiveDaysAgo });
    recordAnalyticsEvent({ eventType: 'lookup', platform: 'instagram', outcome: 'success', createdAt: fortyFiveDaysAgo });

    await new Promise(r => setTimeout(r, 20));
    assert.equal(persistentDbState.events.length, 2);

    // Run pruning
    await pruneOldAnalytics();

    // 45-day-old event pruned, 5-day-old event kept
    assert.equal(persistentDbState.events.length, 1);
    assert.equal(persistentDbState.events[0].created_at.getTime(), fiveDaysAgo.getTime());
  } finally {
    await closePool();
    resetMemoryAnalytics();
  }
});

test('Admin Auth: Session token authentication and security remain intact', () => {
  const token = createAdminSession();
  assert.ok(token);
  assert.equal(isValidAdminSession(token), true);
  assert.equal(isValidAdminSession('invalid-token-12345'), false);

  // Test token extraction
  const reqWithBearer = { headers: { authorization: `Bearer ${token}` } };
  assert.equal(extractToken(reqWithBearer), token);

  const reqWithCookie = { headers: { cookie: `reelflow_admin_token=${token}; other=val` } };
  assert.equal(extractToken(reqWithCookie), token);

  // Test middleware
  let nextCalled = false;
  requireAdminAuth(reqWithBearer, {}, () => { nextCalled = true; });
  assert.equal(nextCalled, true);

  let statusSent = null;
  let jsonSent = null;
  const mockRes = {
    status(code) { statusSent = code; return this; },
    json(data) { jsonSent = data; return this; }
  };
  requireAdminAuth({ headers: {} }, mockRes, () => {});
  assert.equal(statusSent, 401);
  assert.equal(jsonSent.error, 'Unauthorized. Admin authentication required.');
});
