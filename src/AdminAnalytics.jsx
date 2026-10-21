import { useState, useEffect } from 'react';
import { 
  BarChart3, 
  ArrowLeft, 
  RefreshCw, 
  ShieldCheck, 
  TrendingUp, 
  Download, 
  Search, 
  AlertTriangle, 
  Clock, 
  CheckCircle, 
  XCircle, 
  Lock, 
  LogOut,
  Database,
  Layers,
  Activity,
  Clapperboard
} from 'lucide-react';

export default function AdminAnalytics({ onBack }) {
  const [token, setToken] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState('');

  const [range, setRange] = useState('7d');
  const [analytics, setAnalytics] = useState(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState('');

  // Check auth on mount via credentials cookie or memory token
  useEffect(() => {
    checkAuth();
  }, [token]);

  async function checkAuth() {
    try {
      const res = await fetch('/api/admin/auth/check', {
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      const data = await res.json();
      if (data.authenticated) {
        setAuthenticated(true);
        fetchAnalytics(range, token);
      } else {
        setAuthenticated(false);
      }
    } catch {
      setAuthenticated(false);
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    if (!password) return;
    setLoginLoading(true);
    setLoginError('');

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Authentication failed');

      // Keep token in React state memory only, cookie handles persistence
      setToken(data.token || '');
      setAuthenticated(true);
      setPassword('');
      fetchAnalytics(range, data.token);
    } catch (err) {
      setLoginError(err.message);
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleLogout() {
    try {
      await fetch('/api/admin/logout', { 
        method: 'POST',
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
    } catch {}
    setToken('');
    setAuthenticated(false);
    setAnalytics(null);
  }

  async function fetchAnalytics(selectedRange = range, authToken = token) {
    setDataLoading(true);
    setDataError('');
    try {
      const res = await fetch(`/api/admin/analytics?range=${selectedRange}`, {
        credentials: 'include',
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {}
      });
      if (res.status === 401) {
        setAuthenticated(false);
        setToken('');
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load metrics');
      setAnalytics(data);
    } catch (err) {
      setDataError(err.message);
    } finally {
      setDataLoading(false);
    }
  }

  function onRangeChange(newRange) {
    setRange(newRange);
    fetchAnalytics(newRange);
  }

  return (
    <div className="admin-page-container">
      {/* Top Navbar */}
      <header className="topbar admin-topbar">
        <div className="wrap nav-container">
          <button type="button" className="brand" onClick={onBack} aria-label="ReelFlow Home" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            <span className="brand-mark">
              <Clapperboard size={18} />
            </span>
            <span>
              ReelFlow<span className="brand-dot">.</span>
            </span>
          </button>

          <div className="admin-nav-actions">
            <button type="button" className="nav-back-button" onClick={onBack} aria-label="Back to Downloader">
              <ArrowLeft size={14} className="nav-back-icon" />
              <span className="btn-text-full">Back to Downloader</span>
              <span className="btn-text-short">Back</span>
            </button>

            {authenticated && (
              <button type="button" className="btn-logout" onClick={handleLogout} title="Logout" aria-label="Logout">
                <LogOut size={14} />
                <span className="btn-text-full">Logout</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="admin-analytics-view wrap">
        {/* Subheader Title & Badge */}
        <div className="admin-subhead">
          <div className="admin-title-badge">
            <ShieldCheck size={15} />
            <span>Privacy-Conscious Analytics</span>
          </div>
        </div>

      {/* Login Screen if Unauthenticated */}
      {!authenticated ? (
        <div className="admin-login-card">
          <div className="lock-icon-wrap">
            <Lock size={26} />
          </div>
          <h2>Admin Authentication</h2>
          <p>Access the private operational analytics dashboard. Protected by rate-limiting and secure sessions.</p>

          <form onSubmit={handleLogin} className="admin-login-form">
            <div className="admin-input-wrap">
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter admin password..."
                required
                autoFocus
              />
            </div>

            {loginError && <div className="admin-alert error">{loginError}</div>}

            <button type="submit" className="button primary full" disabled={loginLoading}>
              {loginLoading ? 'Authenticating…' : 'Access Analytics'}
            </button>
          </form>

          <div className="login-privacy-note">
            <ShieldCheck size={13} />
            <span>No user URLs, cookies, media titles, or IP addresses are recorded or exposed.</span>
          </div>
        </div>
      ) : (
        /* Analytics Dashboard */
        <div className="analytics-content">
          {/* Controls bar */}
          <div className="analytics-controls">
            <div className="range-selector">
              <button 
                type="button" 
                className={`range-btn ${range === '24h' ? 'active' : ''}`}
                onClick={() => onRangeChange('24h')}
              >
                24 Hours
              </button>
              <button 
                type="button" 
                className={`range-btn ${range === '7d' ? 'active' : ''}`}
                onClick={() => onRangeChange('7d')}
              >
                Last 7 Days
              </button>
              <button 
                type="button" 
                className={`range-btn ${range === '30d' ? 'active' : ''}`}
                onClick={() => onRangeChange('30d')}
              >
                Last 30 Days
              </button>
            </div>

            <div className="storage-badge-wrap">
              <span className="storage-badge">
                <Database size={13} />
                <span>{analytics?.storageType || 'Storage'}</span>
              </span>
              <button 
                type="button" 
                className="btn-refresh" 
                onClick={() => fetchAnalytics(range)} 
                disabled={dataLoading}
                title="Refresh Metrics"
              >
                <RefreshCw size={14} className={dataLoading ? 'spin-anim' : ''} />
              </button>
            </div>
          </div>

          {dataError && <div className="admin-alert error">{dataError}</div>}

          {/* Metric Cards Grid */}
          <div className="metrics-grid">
            <div className="metric-card">
              <div className="metric-icon-wrap lookups">
                <Search size={18} />
              </div>
              <div className="metric-data">
                <span className="metric-label">Total Lookups</span>
                <span className="metric-value">{analytics?.summary?.totalLookups ?? 0}</span>
                <span className="metric-sub">
                  {analytics?.summary?.successfulLookups ?? 0} success · {analytics?.summary?.failedLookups ?? 0} failed
                </span>
              </div>
            </div>

            <div className="metric-card">
              <div className="metric-icon-wrap downloads">
                <Download size={18} />
              </div>
              <div className="metric-data">
                <span className="metric-label">Downloads Completed</span>
                <span className="metric-value">{analytics?.summary?.downloadsCompleted ?? 0}</span>
                <span className="metric-sub">
                  {analytics?.summary?.downloadAttempts ?? 0} attempts · {analytics?.summary?.downloadsFailedOrAborted ?? 0} failed/aborted
                </span>
              </div>
            </div>

            <div className="metric-card">
              <div className="metric-icon-wrap rate">
                <TrendingUp size={18} />
              </div>
              <div className="metric-data">
                <span className="metric-label">Download Success Rate</span>
                <span className="metric-value">{analytics?.summary?.downloadSuccessRate ?? 0}%</span>
                <span className="metric-sub">Verified stream close lifecycle</span>
              </div>
            </div>

            <div className="metric-card">
              <div className="metric-icon-wrap duration">
                <Clock size={18} />
              </div>
              <div className="metric-data">
                <span className="metric-label">Avg Processing Time</span>
                <span className="metric-value">
                  {analytics?.summary?.avgDurationMs ? `${(analytics.summary.avgDurationMs / 1000).toFixed(1)}s` : '—'}
                </span>
                <span className="metric-sub">yt-dlp execution pipeline</span>
              </div>
            </div>
          </div>

          {/* Platforms & Rate Limits */}
          <div className="analytics-two-col">
            <div className="panel-card">
              <h3>Platform Distribution</h3>
              <p className="panel-sub">Breakdown of lookup and download traffic by platform.</p>

              <div className="platform-breakdown">
                <div className="platform-row">
                  <div className="platform-name">
                    <span className="platform-dot instagram" />
                    <span>Instagram</span>
                  </div>
                  <span className="platform-count">{analytics?.summary?.instagramCount ?? 0} events</span>
                </div>
                <div className="platform-row">
                  <div className="platform-name">
                    <span className="platform-dot facebook" />
                    <span>Facebook</span>
                  </div>
                  <span className="platform-count">{analytics?.summary?.facebookCount ?? 0} events</span>
                </div>
                <div className="platform-row">
                  <div className="platform-name">
                    <span className="platform-dot youtube" />
                    <span>YouTube</span>
                  </div>
                  <span className="platform-count">{analytics?.summary?.youtubeCount ?? 0} events</span>
                </div>
              </div>

              <div className="active-downloads-pill">
                <Activity size={14} />
                <span>Currently Active Concurrent Downloads: <strong>{analytics?.summary?.activeDownloads ?? 0}</strong></span>
              </div>
            </div>

            <div className="panel-card">
              <h3>Security &amp; Throttling</h3>
              <p className="panel-sub">Protection events recorded within the selected timeframe.</p>

              <div className="security-stat-box">
                <div className="security-stat">
                  <span className="stat-num">{analytics?.summary?.rateLimitCount ?? 0}</span>
                  <span className="stat-desc">HTTP 429 Rate-Limit Triggers</span>
                </div>
                <p className="security-note">
                  Protected against abusive scrapers via IP sliding window limits.
                </p>
              </div>
            </div>
          </div>

          {/* Daily Trends & Sanitized Error Categories */}
          <div className="analytics-two-col">
            <div className="panel-card">
              <h3>Daily Activity</h3>
              <p className="panel-sub">Volume of lookups and completed downloads per day.</p>

              {(!analytics?.dailyTrends || analytics.dailyTrends.length === 0) ? (
                <div className="empty-state">No trend activity recorded for this period.</div>
              ) : (
                <div className="trend-table-wrap">
                  <table className="analytics-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th style={{ textAlign: 'center' }}>Lookups</th>
                        <th style={{ textAlign: 'right' }}>Downloads</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.dailyTrends.map(t => (
                        <tr key={t.date}>
                          <td>{t.date}</td>
                          <td style={{ textAlign: 'center' }}>{t.lookups}</td>
                          <td style={{ textAlign: 'right' }}><span className="tag-success">{t.downloads}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="panel-card">
              <h3>Top Sanitized Error Categories</h3>
              <p className="panel-sub">Aggregated error classes without any user or media data.</p>

              {(!analytics?.topErrors || analytics.topErrors.length === 0) ? (
                <div className="empty-state">No errors recorded in this time range. Everything smooth!</div>
              ) : (
                <div className="error-table-wrap">
                  <table className="analytics-table">
                    <thead>
                      <tr>
                        <th>Category</th>
                        <th style={{ textAlign: 'right' }}>Occurrences</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.topErrors.map(err => (
                        <tr key={err.category}>
                          <td>{err.category}</td>
                          <td style={{ textAlign: 'right' }}><span className="tag-error">{err.count}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Privacy Guarantee Note */}
          <div className="analytics-privacy-footer">
            <ShieldCheck size={16} />
            <span>
              <strong>Privacy-First Architecture:</strong> Raw video URLs, titles, visitor IP addresses, cookies, and media payloads are strictly filtered and never stored in analytics logs or tables.
            </span>
          </div>
        </div>
      )}
      </main>
    </div>
  );
}
