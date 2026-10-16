import crypto from 'node:crypto';

// In-memory admin session storage: token -> { expiresAt }
const adminSessions = new Map();
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

// In-memory login rate limiter: ip -> { count, resetAt }
const loginAttempts = new Map();

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/**
 * Clean up expired admin sessions
 */
export function pruneAdminSessions() {
  const now = Date.now();
  for (const [tokenHash, session] of adminSessions) {
    if (session.expiresAt <= now) adminSessions.delete(tokenHash);
  }
  for (const [ip, attempt] of loginAttempts) {
    if (now > attempt.resetAt) loginAttempts.delete(ip);
  }
}
setInterval(pruneAdminSessions, 15 * 60_000).unref();

/**
 * Validate admin password securely against ADMIN_SECRET or ADMIN_PASSWORD
 */
export function verifyAdminPassword(inputPassword) {
  const configuredPassword = process.env.ADMIN_PASSWORD || process.env.ADMIN_SECRET || 'reelflow-admin-2026';
  if (!inputPassword || typeof inputPassword !== 'string') return false;

  const inputBuf = Buffer.from(crypto.createHash('sha256').update(inputPassword.trim()).digest());
  const expectedBuf = Buffer.from(crypto.createHash('sha256').update(configuredPassword.trim()).digest());

  if (inputBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(inputBuf, expectedBuf);
}

/**
 * Create a new admin session token, storing only its SHA-256 hash server-side
 */
export function createAdminSession() {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  adminSessions.set(tokenHash, {
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  return rawToken;
}

/**
 * Validate session token using its SHA-256 hash
 */
export function isValidAdminSession(rawToken) {
  if (!rawToken || typeof rawToken !== 'string') return false;
  const tokenHash = hashToken(rawToken);
  const session = adminSessions.get(tokenHash);
  if (!session) return false;
  if (session.expiresAt <= Date.now()) {
    adminSessions.delete(tokenHash);
    return false;
  }
  return true;
}

/**
 * Destroy admin session by token hash
 */
export function destroyAdminSession(rawToken) {
  if (rawToken) {
    const tokenHash = hashToken(rawToken);
    adminSessions.delete(tokenHash);
  }
}

/**
 * Express middleware to check login rate limit
 */
export function checkLoginRateLimit(req, res, next) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const attempt = loginAttempts.get(ip) || { count: 0, resetAt: now + 15 * 60_000 };

  if (now > attempt.resetAt) {
    attempt.count = 0;
    attempt.resetAt = now + 15 * 60_000;
  }

  attempt.count++;
  loginAttempts.set(ip, attempt);

  if (attempt.count > 10) {
    return res.status(429).json({ error: 'Too many login attempts. Please wait 15 minutes.' });
  }

  next();
}

/**
 * Extract token from Authorization header or Cookie
 */
export function extractToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const cookies = req.headers.cookie;
  if (cookies) {
    const match = cookies.match(/(?:^|;\s*)reelflow_admin_token=([^;]+)/);
    if (match) return match[1];
  }
  return null;
}

/**
 * Middleware to protect admin routes
 */
export function requireAdminAuth(req, res, next) {
  const token = extractToken(req);
  if (!isValidAdminSession(token)) {
    return res.status(401).json({ error: 'Unauthorized. Admin authentication required.' });
  }
  next();
}
