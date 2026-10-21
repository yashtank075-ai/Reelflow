import { useState, useRef, useEffect } from 'react';
import { 
  ArrowDownToLine, 
  ArrowUpRight, 
  Check, 
  CirclePlay, 
  Clapperboard, 
  Download, 
  Link2, 
  ShieldCheck, 
  Sparkles, 
  Zap, 
  Clipboard, 
  X, 
  AlertCircle, 
  Clock, 
  HardDrive, 
  RotateCw,
  Lock,
  Smartphone,
  Info,
  ExternalLink,
  ChevronRight,
  ChevronDown,
  ArrowLeft,
  Mail,
  FileText,
  History,
  Trash2,
  AlertTriangle
} from 'lucide-react';

import AdminAnalytics from './AdminAnalytics.jsx';

function formatDuration(seconds) {
  if (!seconds || typeof seconds !== 'number') return null;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function formatBytes(bytes) {
  if (!bytes || typeof bytes !== 'number' || bytes <= 0) return null;
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

import {
  HISTORY_STORAGE_KEY,
  MAX_HISTORY_ENTRIES,
  loadStoredHistory,
  persistHistory,
  clearStoredHistory
} from './historyStorage.js';

export {
  HISTORY_STORAGE_KEY,
  MAX_HISTORY_ENTRIES,
  loadStoredHistory,
  persistHistory,
  clearStoredHistory
};

function getInitialPage() {
  const path = window.location.pathname.toLowerCase();
  const hash = window.location.hash.toLowerCase();
  if (path.startsWith('/admin') || hash === '#admin') return 'admin';
  if (path === '/privacy' || hash === '#privacy') return 'privacy';
  if (path === '/terms' || hash === '#terms') return 'terms';
  if (path === '/contact' || hash === '#contact') return 'contact';
  return 'home';
}

export default function App() {
  const [currentPage, setCurrentPage] = useState(getInitialPage);

  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [quality, setQuality] = useState('best');
  const [thumbError, setThumbError] = useState(false);
  const [downloadSuccess, setDownloadSuccess] = useState(false);
  const [activeModal, setActiveModal] = useState(null); // Quick drawer/modal if opened in-place
  const [openFaq, setOpenFaq] = useState(null); // Index of expanded FAQ accordion item
  const [downloadHistory, setDownloadHistory] = useState(loadStoredHistory);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [historyStorageWarning, setHistoryStorageWarning] = useState(false);
  const inputRef = useRef(null);

  // Synchronize browser history & page titles
  useEffect(() => {
    const handlePop = () => {
      setCurrentPage(getInitialPage());
    };
    window.addEventListener('popstate', handlePop);
    window.addEventListener('hashchange', handlePop);
    return () => {
      window.removeEventListener('popstate', handlePop);
      window.removeEventListener('hashchange', handlePop);
    };
  }, []);

  useEffect(() => {
    switch (currentPage) {
      case 'privacy':
        document.title = 'Privacy Policy — ReelFlow';
        break;
      case 'terms':
        document.title = 'Terms of Use — ReelFlow';
        break;
      case 'contact':
        document.title = 'Contact & Support — ReelFlow';
        break;
      case 'admin':
        document.title = 'Admin Analytics — ReelFlow';
        break;
      default:
        document.title = 'ReelFlow — Download Instagram Reels, Facebook Videos & Preview YouTube Links';
    }
  }, [currentPage]);

  function navigateTo(page, e) {
    if (e) e.preventDefault();
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const targetPath = page === 'home' ? '/' : `/${page}`;
    window.history.pushState({}, '', targetPath);
  }

  if (currentPage === 'admin') {
    return (
      <div className="app-shell">
        <AdminAnalytics onBack={() => navigateTo('home')} />
      </div>
    );
  }

  if (currentPage === 'privacy' || currentPage === 'terms' || currentPage === 'contact') {
    return (
      <div className="app-shell">
        <header className="topbar legal-topbar">
          <div className="wrap nav-container">
            <a 
              className="brand" 
              href="/" 
              aria-label="ReelFlow Home"
              onClick={(e) => { e.preventDefault(); navigateTo('home'); }}
            >
              <span className="brand-mark">
                <Clapperboard size={18} />
              </span>
              <span>
                ReelFlow<span className="brand-dot">.</span>
              </span>
            </a>

            <a 
              className="nav-back-button" 
              href="/" 
              aria-label="Back to Downloader"
              onClick={(e) => { e.preventDefault(); navigateTo('home'); }}
            >
              <ArrowLeft size={14} className="nav-back-icon" />
              <span>Back to Downloader</span>
            </a>
          </div>
        </header>

        <main className="legal-page-overlay">
          <div className="wrap legal-page-wrap">
            <div className="legal-page-card">
              <div className="legal-page-header">
                <h2>
                  {currentPage === 'privacy' && 'Privacy Policy'}
                  {currentPage === 'terms' && 'Terms of Service'}
                  {currentPage === 'contact' && 'Contact & Support'}
                </h2>
                <p className="legal-page-sub">
                  {currentPage === 'privacy' && 'Last updated: October 2026 · Committed to zero personal data logging'}
                  {currentPage === 'terms' && 'Last updated: October 2026 · Conditions for responsible personal use'}
                  {currentPage === 'contact' && 'Direct developer support and inquiries'}
                </p>
              </div>

              <div className="legal-page-body">
                {currentPage === 'privacy' && (
                  <>
                    <section className="legal-section">
                      <h3>1. Zero Personal Data Collection</h3>
                      <p>
                        ReelFlow does not require accounts, user registrations, cookies, or social-media passwords. We do not store, track, or inspect your personal credentials or visitor IP addresses.
                      </p>
                    </section>

                    <section className="legal-section">
                      <h3>2. Transient Media Processing</h3>
                      <p>
                        When you submit a public Instagram Reel or Facebook video link:
                      </p>
                      <ul>
                        <li>The link is validated strictly against platform allowlists and sent to the yt-dlp media extraction engine.</li>
                        <li>Temporary video files created during multiplexing are streamed directly to your browser and <strong>purged immediately</strong> from server disks upon stream finish or client disconnect.</li>
                        <li>Download tokens are generated in volatile memory with short 15-minute expirations and are never saved to persistent storage.</li>
                      </ul>
                    </section>

                    <section className="legal-section">
                      <h3>3. Privacy-First Operational Analytics</h3>
                      <p>
                        Our operational dashboard monitors aggregate system health only (such as total lookups, download success rates, generic error categories, and rate limits). Raw video URLs, titles, media files, and visitor IP addresses are never recorded. Operational events older than 30 days are automatically deleted by a daily retention cleanup task.
                      </p>
                    </section>

                    <section className="legal-section">
                      <h3>4. Third-Party Media</h3>
                      <p>
                        Media files are retrieved transiently from public servers operated by Meta/Instagram. ReelFlow does not host, index, or store video content on its servers.
                      </p>
                    </section>
                  </>
                )}

                {currentPage === 'terms' && (
                  <>
                    <section className="legal-section">
                      <h3>1. Acceptance of Terms</h3>
                      <p>
                        By accessing ReelFlow (https://reelflow-fq7d.onrender.com/), you agree to use this utility in full compliance with all applicable copyright and intellectual property laws.
                      </p>
                    </section>

                    <section className="legal-section">
                      <h3>2. Permitted Use</h3>
                      <p>
                        ReelFlow is provided strictly for personal, non-commercial archiving, research, and fair-use viewing of content you own or for which you have explicit permission from the rights holder.
                      </p>
                    </section>

                    <section className="legal-section">
                      <h3>3. Prohibited Conduct</h3>
                      <ul>
                        <li>Do not use automated bots, scrapers, or flood scripts to abuse or overload the ReelFlow infrastructure.</li>
                        <li>Do not attempt to bypass login screens, paywalls, or privacy controls. ReelFlow refuses requests for private, age-restricted, or login-gated videos.</li>
                        <li>Do not redistribute copyrighted media without permission from its original creators.</li>
                      </ul>
                    </section>

                    <section className="legal-section">
                      <h3>4. Service Availability &amp; Disclaimer</h3>
                      <p>
                        ReelFlow is provided "as is" and "as available". We do not guarantee uninterrupted access or format availability, as third-party platform delivery mechanisms are subject to change without notice. ReelFlow is an independent utility and is not affiliated with, authorized, or endorsed by Meta, Instagram, or Facebook.
                      </p>
                    </section>
                  </>
                )}

                {currentPage === 'contact' && (
                  <>
                    <section className="legal-section">
                      <h3>Get in Touch</h3>
                      <p>
                        For technical feedback, bug reports regarding specific public link structures, or DMCA/content inquiries, you can reach out via the administrator mailbox:
                      </p>
                      
                      <div className="contact-box">
                        <div className="contact-item">
                          <Mail size={18} />
                          <div>
                            <strong>Email Inquiries</strong>
                            <p>support@reelflow.app (or submit an issue via the project repository)</p>
                          </div>
                        </div>
                        <div className="contact-item">
                          <ShieldCheck size={18} />
                          <div>
                            <strong>Response Time</strong>
                            <p>Typically 24 to 48 business hours for verified inquiries</p>
                          </div>
                        </div>
                      </div>
                    </section>

                    <section className="legal-section">
                      <h3>Content Inquiries &amp; Rights Owners</h3>
                      <p>
                        ReelFlow does not host media or operate persistent media databases. All downloads are real-time transient streams from the respective host platform. If you wish to make content inaccessible, ensure the video privacy is set to private or restricted on the host platform.
                      </p>
                    </section>
                  </>
                )}
              </div>
            </div>
          </div>
        </main>

        <footer className="footer">
          <div className="wrap footer-wrap">
            <div className="footer-top">
              <a 
                className="brand" 
                href="/" 
                aria-label="ReelFlow Home"
                onClick={(e) => { e.preventDefault(); navigateTo('home'); }}
              >
                <span className="brand-mark">
                  <Clapperboard size={17} />
                </span>
                <span>
                  ReelFlow<span className="brand-dot">.</span>
                </span>
              </a>

              <div className="footer-nav">
                <a 
                  className="footer-link" 
                  href="/privacy" 
                  onClick={(e) => { e.preventDefault(); navigateTo('privacy'); }}
                >
                  Privacy Policy
                </a>
                <a 
                  className="footer-link" 
                  href="/terms" 
                  onClick={(e) => { e.preventDefault(); navigateTo('terms'); }}
                >
                  Terms of Service
                </a>
                <a 
                  className="footer-link" 
                  href="/contact" 
                  onClick={(e) => { e.preventDefault(); navigateTo('contact'); }}
                >
                  Contact
                </a>
              </div>
            </div>

            <div className="footer-bottom">
              <p className="footer-disclaimer">
                Independent utility. Not affiliated with Instagram, Facebook, or Meta. Download only public media you own or have permission from its rights holder to save. Respect copyright law and platform guidelines.
              </p>
              <p className="footer-copyright">
                © 2026 ReelFlow. All rights reserved.
              </p>
            </div>
          </div>
        </footer>
      </div>
    );
  }

  // Quick paste from clipboard
  async function handlePaste() {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text) {
          setUrl(text.trim());
          setError('');
        }
      } else {
        inputRef.current?.focus();
      }
    } catch {
      inputRef.current?.focus();
    }
  }

  // Clear input
  function handleClear() {
    setUrl('');
    setError('');
    setNotice('');
    setResult(null);
    setThumbError(false);
    setDownloadSuccess(false);
    inputRef.current?.focus();
  }

  async function lookup(e) {
    e?.preventDefault?.();
    if (loading) return;
    setError('');
    setNotice('');
    setResult(null);
    setThumbError(false);
    setDownloadSuccess(false);

    const trimmed = url.trim();
    if (!trimmed) {
      setError('Please paste a link first.');
      return;
    }

    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch {
      setError('Please paste a valid Instagram Reel, Facebook video, or YouTube URL.');
      return;
    }

    const host = parsed.hostname.toLowerCase();
    const instagramHost = ['instagram.com', 'www.instagram.com', 'm.instagram.com'].includes(host);
    const facebookHost = ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com', 'fb.watch'].includes(host);
    const youtubeHost = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(host);

    const instagramPath = /^\/(reel|reels|p)\/[A-Za-z0-9_-]+\/?$/i.test(parsed.pathname);
    const facebookPath = (
      /^\/(watch|reel|share\/(v|r)|videos)(\/|$)/i.test(parsed.pathname) || 
      /^\/[^/]+\/videos\//i.test(parsed.pathname) || 
      host === 'fb.watch'
    ) && (
      parsed.searchParams.has('v') || 
      parsed.searchParams.has('story_fbid') || 
      /\/(videos|reel|share\/(v|r))\/[A-Za-z0-9._-]+/i.test(parsed.pathname) || 
      host === 'fb.watch'
    );
    const youtubePath = (
      (host === 'youtu.be' && /^\/[A-Za-z0-9_-]{11}\/?$/.test(parsed.pathname)) ||
      (host !== 'youtu.be' && /^\/shorts\/[A-Za-z0-9_-]{11}\/?$/i.test(parsed.pathname)) ||
      (host !== 'youtu.be' && /^\/watch\/?$/i.test(parsed.pathname) && /^[A-Za-z0-9_-]{11}$/.test(parsed.searchParams.get('v') || ''))
    );

    if (
      parsed.protocol !== 'https:' || 
      parsed.username || 
      parsed.password || 
      parsed.port || 
      (!(instagramHost && instagramPath) && !(facebookHost && facebookPath) && !(youtubeHost && youtubePath))
    ) {
      setError('Unsupported link. Please paste a public Instagram Reel, Facebook video, or YouTube URL.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/media/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: parsed.href })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not find media for this link.');
      setResult(data);
      setNotice(data.message || '');
      setQuality('best');
    } catch (err) {
      setError(err.message || 'Something went wrong while fetching the media.');
    } finally {
      setLoading(false);
    }
  }

  function removeHistoryEntry(id) {
    setDownloadHistory(prev => {
      const updated = prev.filter(item => item.id !== id);
      persistHistory(updated);
      return updated;
    });
  }

  function clearAllHistory() {
    clearStoredHistory();
    setDownloadHistory([]);
    setHistoryStorageWarning(false);
    setShowClearConfirm(false);
  }

  async function downloadVideo() {
    if (!result?.downloadUrl || downloading) return;
    setDownloading(true);
    setError('');
    setDownloadSuccess(false);

    // Prepare reliable history metadata
    const historyId = `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const platform = result.provider === 'facebook' ? 'Facebook' : 'Instagram';
    const cleanTitle = (result.title && typeof result.title === 'string' && result.title.trim().length > 0)
      ? result.title.trim().substring(0, 80)
      : `${platform} Video`;
    const qualityLabel = quality === 'best' ? 'Original / Best' : `${quality}p`;

    try {
      const response = await fetch(`${result.downloadUrl}?quality=${encodeURIComponent(quality)}`);
      if (!response.ok) {
        let data = {};
        try {
          data = await response.json();
        } catch {}
        throw new Error(data.error || 'Download failed. The video may have expired or is restricted.');
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `reelflow-${result.provider || 'video'}-${result.id || 'media'}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
      setDownloadSuccess(true);
      setTimeout(() => setDownloadSuccess(false), 4000);

      // Record initiated / saved entry
      const newEntry = {
        id: historyId,
        provider: result.provider === 'facebook' ? 'facebook' : 'instagram',
        title: cleanTitle,
        quality: qualityLabel,
        timestamp: Date.now(),
        status: 'started' // Browser initiated download stream
      };

      setDownloadHistory(prev => {
        const filtered = prev.filter(item => item.id !== historyId);
        const updated = [newEntry, ...filtered].slice(0, MAX_HISTORY_ENTRIES);
        const saved = persistHistory(updated);
        if (!saved && updated.length > 0) {
          setHistoryStorageWarning(true);
        } else {
          setHistoryStorageWarning(false);
        }
        return updated;
      });
    } catch (err) {
      const isConcurrencyBusy = err.message && (err.message.includes('busy') || err.message.includes('retry'));
      const friendlyError = isConcurrencyBusy
        ? 'Downloads are busy right now. Please wait a few seconds and try again.'
        : (err.message || 'Download failed. Please try again.');
      setError(friendlyError);

      // Record failed entry so user is aware
      const failedEntry = {
        id: historyId,
        provider: result.provider === 'facebook' ? 'facebook' : 'instagram',
        title: cleanTitle,
        quality: qualityLabel,
        timestamp: Date.now(),
        status: 'failed'
      };

      setDownloadHistory(prev => {
        const filtered = prev.filter(item => item.id !== historyId);
        const updated = [failedEntry, ...filtered].slice(0, MAX_HISTORY_ENTRIES);
        const saved = persistHistory(updated);
        if (!saved && updated.length > 0) {
          setHistoryStorageWarning(true);
        }
        return updated;
      });
    } finally {
      setDownloading(false);
    }
  }

  // Determine available options based on real server metadata
  const standardOptions = [
    { value: 'best', label: 'Best Available (Original)' },
    { value: '1080', label: '1080p (Full HD)', minHeight: 1080 },
    { value: '720', label: '720p (HD)', minHeight: 720 },
    { value: '480', label: '480p (SD)', minHeight: 480 },
    { value: '360', label: '360p (Data saver)', minHeight: 360 }
  ];

  // If backend returned specific resolutions, display them accurately
  const backendResolutions = Array.isArray(result?.resolutions) ? result.resolutions : [];
  const maxDetectedHeight = backendResolutions.length > 0 ? Math.max(...backendResolutions) : null;

  // Platform-aware check for input URL
  const isYouTubeInput = (() => {
    const trimmed = url.trim();
    if (!trimmed) return false;
    try {
      const parsed = new URL(trimmed);
      const host = parsed.hostname.toLowerCase();
      return ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(host);
    } catch {
      return /youtu(\.be|be\.com)/i.test(trimmed);
    }
  })();

  return (
    <div className="app-shell">
      {/* Top Navbar */}
      <header className="topbar">
        <div className="wrap nav-container">
          <a className="brand" href="/" aria-label="ReelFlow Home">
            <span className="brand-mark">
              <Clapperboard size={18} />
            </span>
            <span>
              ReelFlow<span className="brand-dot">.</span>
            </span>
          </a>

          <nav className="nav-links" aria-label="Main Navigation">
            <a href="#features" className="nav-link">Features</a>
            <a href="#how-it-works" className="nav-link">How It Works</a>
            <a href="#faq" className="nav-link">FAQ</a>
          </nav>

          <div className="nav-actions">
            <div className="top-pill operational">
              <span className="live-dot" />
              <span>Operational</span>
            </div>
            <a href="#url-input" className="top-pill action-pill" onClick={() => inputRef.current?.focus()}>
              <Zap size={11} className="action-pill-icon" />
              <span>Quick Save</span>
            </a>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main>
        {/* Hero Section */}
        <section className="hero wrap">
          <div className="eyebrow">
            <Sparkles size={14} />
            <span>Fast &amp; Private Media Downloader</span>
          </div>

          <h1>
            Download Instagram Reels, Facebook Videos &amp;<br />
            <span>Preview YouTube Links.</span>
          </h1>

          <p className="hero-copy">
            Save publicly accessible Instagram Reels and Facebook videos in high quality. Enter a supported YouTube link to preview video details and access official creator guidance.
          </p>

          <div className="platform-chips">
            <span className="platform-chip instagram">
              <Sparkles size={12} /> Instagram Reels (Download)
            </span>
            <span className="platform-chip facebook">
              <Zap size={12} /> Facebook Videos (Download)
            </span>
            <span className="platform-chip youtube">
              <CirclePlay size={12} /> YouTube &amp; Shorts (Preview &amp; Guidance)
            </span>
            <span className="platform-chip">
              <Lock size={12} /> No Password Needed
            </span>
          </div>

          {/* Search / Lookup Form */}
          <div className="lookup-form-container">
            <form className="lookup-form" onSubmit={lookup}>
              <div className="input-wrap">
                <Link2 size={20} className="input-icon" />
                <label htmlFor="url-input" className="sr-only">
                  Instagram Reel, Facebook, or YouTube video URL
                </label>
                <input
                  ref={inputRef}
                  id="url-input"
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="Paste Instagram Reel, Facebook, or YouTube URL..."
                  aria-label="Instagram, Facebook, or YouTube video URL"
                  aria-describedby="input-desc"
                  required
                />
                <div className="input-tools">
                  {url ? (
                    <button 
                      type="button" 
                      className="tool-btn icon-only" 
                      onClick={handleClear} 
                      aria-label="Clear input"
                      title="Clear"
                    >
                      <X size={15} />
                    </button>
                  ) : (
                    <button 
                      type="button" 
                      className="tool-btn" 
                      onClick={handlePaste}
                      aria-label="Paste from clipboard"
                    >
                      <Clipboard size={14} />
                      <span>Paste</span>
                    </button>
                  )}
                </div>
              </div>

              <button className="button primary" type="submit" disabled={loading}>
                {loading ? (
                  <>
                    <span className="spinner" />
                    <span>Finding…</span>
                  </>
                ) : isYouTubeInput ? (
                  <>
                    <span>Preview YouTube Video</span>
                    <ArrowUpRight size={17} />
                  </>
                ) : (
                  <>
                    <span>Fetch Media</span>
                    <ArrowUpRight size={17} />
                  </>
                )}
              </button>
            </form>

            <div className="input-caption" id="input-desc">
              <span>
                <ShieldCheck size={14} /> No Account Required · Privacy-Conscious Processing
              </span>
              <span>
                <Smartphone size={14} /> Works on iPhone, Android &amp; PC
              </span>
            </div>
          </div>

          {/* Loading Skeleton */}
          {loading && (
            <div className="result-card skeleton-card" aria-busy="true" aria-label="Loading video information">
              <div className="skeleton-line title" />
              <div className="result-content">
                <div className="reel-thumb skeleton-box" />
                <div className="result-info">
                  <div className="skeleton-line badge" />
                  <div className="skeleton-line heading" />
                  <div className="skeleton-line desc" />
                  <div className="skeleton-line select" />
                  <div className="skeleton-line btn" />
                </div>
              </div>
            </div>
          )}

          {/* Feedback & Result Blocks */}
          {error && (
            <div className="alert error" role="alert">
              <AlertCircle size={18} />
              <div className="alert-content">
                <div>{error}</div>
                <div className="alert-actions">
                  <button type="button" className="retry-btn" onClick={lookup}>
                    <RotateCw size={13} />
                    <span>Retry</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {notice && (
            <div className="alert info" role="status">
              <Sparkles size={18} />
              <div className="alert-content">{notice}</div>
            </div>
          )}

          {/* Premium Result Card */}
          {result && !loading && (
            <section className="result-card">
              <div className="result-head">
                <div>
                  <span className="mini-label">
                    {result.provider === 'facebook' ? 'FACEBOOK VIDEO' : (result.provider === 'youtube' ? 'YOUTUBE MEDIA' : 'INSTAGRAM REEL')}
                  </span>
                  <h2>{result.provider === 'youtube' ? 'Video Preview' : 'Media Ready'}</h2>
                </div>
                <span className={`status-pill ${result.provider === 'youtube' ? 'policy-pill' : ''}`}>
                  {result.provider === 'youtube' ? (
                    <>
                      <Info size={14} /> YouTube Preview
                    </>
                  ) : (
                    <>
                      <Check size={14} /> Accessible
                    </>
                  )}
                </span>
              </div>

              <div className="result-content">
                <div className="reel-thumb">
                  {result.thumbnailUrl && !thumbError ? (
                    <img 
                      src={result.thumbnailUrl} 
                      alt={result.title || "Video preview thumbnail"} 
                      loading="lazy" 
                      onError={() => setThumbError(true)}
                    />
                  ) : (
                    <div className="thumb-placeholder">
                      <CirclePlay size={44} />
                      <span>{result.provider === 'facebook' ? 'FACEBOOK VIDEO' : (result.provider === 'youtube' ? 'YOUTUBE VIDEO' : 'REEL PREVIEW')}</span>
                    </div>
                  )}
                  <span className="thumb-badge">
                    {result.provider === 'facebook' ? 'Facebook' : (result.provider === 'youtube' ? 'YouTube' : 'Reel')}
                  </span>
                </div>

                <div className="result-info">
                  {/* Verified Metadata Badges */}
                  <div className="meta-badges">
                    <span className="meta-badge">
                      {result.provider === 'facebook' ? 'Facebook Video' : (result.provider === 'youtube' ? (result.mediaType || 'YouTube Video') : 'Instagram Reel')}
                    </span>
                    {result.duration && (
                      <span className="meta-badge">
                        <Clock size={12} /> {formatDuration(result.duration)}
                      </span>
                    )}
                    {result.provider !== 'youtube' && (
                      <span className="meta-badge">
                        <HardDrive size={12} /> {result.filesizeBytes ? `~${formatBytes(result.filesizeBytes)}` : 'Size unavailable'}
                      </span>
                    )}
                    {maxDetectedHeight && (
                      <span className="meta-badge">
                        Up to {maxDetectedHeight}p
                      </span>
                    )}
                  </div>

                  <h3>
                    {result.title ? (result.title.slice(0, 85) + (result.title.length > 85 ? '...' : '')) : (result.caption ? result.caption.slice(0, 85) : 'Public Video')}
                  </h3>

                  {result.caption ? (
                    <div className="result-description-block">
                      <p>{result.caption}</p>
                    </div>
                  ) : null}

                  {/* YouTube Educational Guidance Block */}
                  {result.provider === 'youtube' ? (
                    <div className="youtube-guidance-card">
                      <div className="youtube-guidance-head">
                        <ShieldCheck size={18} className="guidance-icon" />
                        <div>
                          <strong>YouTube Download Policy &amp; Lawful Options</strong>
                          <p>
                            ReelFlow respects copyright law and YouTube terms. Direct downloading of arbitrary third-party YouTube videos is not available in this workflow.
                          </p>
                        </div>
                      </div>

                      <div className="youtube-guidance-options">
                        <div className="guidance-option">
                          <h4>For Video Owners &amp; Creators:</h4>
                          <p>
                            If you own this video, you can download your original high-resolution MP4 copy directly via official creator tools.
                          </p>
                          <a
                            href="https://studio.youtube.com/"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="button secondary outline full"
                          >
                            <span>Open YouTube Studio</span>
                            <ArrowUpRight size={14} />
                          </a>
                        </div>

                        <div className="guidance-option">
                          <h4>For Offline Mobile Viewing:</h4>
                          <p>
                            YouTube Premium subscribers can save videos for offline viewing within the official YouTube mobile app. Note that offline viewing stays inside the YouTube app and is not an MP4 file export.
                          </p>
                          <a
                            href="https://support.google.com/youtube/answer/6141269"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="guidance-link"
                          >
                            <span>Learn about official YouTube downloads</span>
                            <ChevronRight size={13} />
                          </a>
                        </div>
                      </div>

                      <div className="result-actions" style={{ marginTop: '16px' }}>
                        <a
                          className="button secondary full"
                          href={result.permalink}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <span>Watch on YouTube</span>
                          <ArrowUpRight size={15} />
                        </a>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* Dynamic Video Quality Selector for Instagram & Facebook */}
                      <div className="quality-control">
                        <label htmlFor="video-quality" className="quality-control-label">
                          <span>Select Resolution</span>
                          <small>
                            {maxDetectedHeight ? `Source max: ${maxDetectedHeight}p` : 'MP4 video stream'}
                          </small>
                        </label>
                        <div className="quality-select-wrapper">
                          <select
                            id="video-quality"
                            value={quality}
                            onChange={(e) => setQuality(e.target.value)}
                            disabled={downloading}
                          >
                            {standardOptions.map(opt => {
                              const isUnavailable = maxDetectedHeight && opt.minHeight && opt.minHeight > maxDetectedHeight;
                              return (
                                <option 
                                  key={opt.value} 
                                  value={opt.value}
                                  disabled={isUnavailable}
                                >
                                  {opt.label} {isUnavailable ? '(Not available in source)' : ''}
                                </option>
                              );
                            })}
                          </select>
                        </div>
                        <small>Only resolutions provided by the platform can be retrieved.</small>
                      </div>

                      <div className="result-actions">
                        <button
                          className={`button primary full ${downloadSuccess ? 'success-state' : ''}`}
                          onClick={downloadVideo}
                          disabled={!result.downloadable || downloading}
                        >
                          {downloading ? (
                            <>
                              <span className="spinner" />
                              <span>Preparing &amp; Downloading…</span>
                            </>
                          ) : downloadSuccess ? (
                            <>
                              <Check size={18} />
                              <span>Download Started!</span>
                            </>
                          ) : (
                            <>
                              <Download size={17} />
                              <span>{result.downloadable ? 'Download MP4' : 'Media Unavailable'}</span>
                            </>
                          )}
                        </button>

                        <a
                          className="button secondary full"
                          href={result.permalink}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <span>View on {result.provider === 'facebook' ? 'Facebook' : 'Instagram'}</span>
                          <ArrowUpRight size={15} />
                        </a>
                      </div>

                      {!result.downloadable && (
                        <p className="download-note">
                          The platform did not provide a downloadable video for this link.
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* Social Proof Row */}
          <div className="trust-row">
            <span>
              <Check size={15} /> 1-Click Fast Save
            </span>
            <span>
              <Check size={15} /> Lossless Audio &amp; Video
            </span>
            <span>
              <Check size={15} /> No Watermark Added
            </span>
            <span>
              <Check size={15} /> Fully Responsive
            </span>
          </div>

          {/* Recent Downloads History Panel */}
          <section className="history-section" aria-labelledby="history-heading">
            <div className="history-header">
              <div className="history-title-wrap">
                <span className="history-badge-icon" aria-hidden="true">
                  <History size={16} />
                </span>
                <div>
                  <h3 id="history-heading" className="history-title">Recent Downloads</h3>
                  <p className="history-subtitle">Stored privately on this browser • Max 20 items</p>
                </div>
              </div>

              {downloadHistory.length > 0 && (
                <div className="history-actions">
                  {showClearConfirm ? (
                    <div className="clear-confirm-group">
                      <span className="confirm-text">Clear all?</span>
                      <button 
                        type="button"
                        className="btn-history-confirm"
                        onClick={clearAllHistory}
                        aria-label="Confirm clear all history"
                      >
                        Yes, Clear
                      </button>
                      <button 
                        type="button"
                        className="btn-history-cancel"
                        onClick={() => setShowClearConfirm(false)}
                        aria-label="Cancel clearing history"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="btn-clear-history"
                      onClick={() => setShowClearConfirm(true)}
                      aria-label="Clear download history"
                    >
                      <Trash2 size={13} />
                      <span>Clear History</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {downloadHistory.length === 0 ? (
              <div className="history-empty">
                <span className="history-empty-icon" aria-hidden="true">
                  <Download size={20} />
                </span>
                <p className="history-empty-text">No recent downloads yet.</p>
                <small className="history-empty-sub">
                  When you download an Instagram Reel or Facebook video, it will appear here for easy reference. History is saved locally in this browser only.
                </small>
              </div>
            ) : (
              <div className="history-list-wrap">
                <ul className="history-list" role="list">
                  {downloadHistory.map((entry) => {
                    const dateObj = new Date(entry.timestamp);
                    const formattedTime = !isNaN(dateObj.getTime())
                      ? dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' · ' + dateObj.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
                      : 'Recently';

                    const isFacebook = entry.provider === 'facebook';

                    return (
                      <li key={entry.id} className="history-item">
                        <div className="history-item-main">
                          <span className={`history-platform-tag ${isFacebook ? 'facebook' : 'instagram'}`}>
                            {isFacebook ? <Zap size={11} /> : <Sparkles size={11} />}
                            <span>{isFacebook ? 'Facebook' : 'Instagram'}</span>
                          </span>

                          <span className="history-item-title" title={entry.title}>
                            {entry.title}
                          </span>
                        </div>

                        <div className="history-item-meta">
                          <span className="history-quality-badge">
                            {entry.quality || 'MP4'}
                          </span>

                          <span className={`history-status-badge ${entry.status}`}>
                            {entry.status === 'started' ? (
                              <>
                                <span className="status-indicator-dot success" />
                                <span>Download Started</span>
                              </>
                            ) : (
                              <>
                                <span className="status-indicator-dot failed" />
                                <span>Failed</span>
                              </>
                            )}
                          </span>

                          <time className="history-time" dateTime={new Date(entry.timestamp).toISOString()}>
                            <Clock size={12} className="history-time-icon" aria-hidden="true" />
                            <span>{formattedTime}</span>
                          </time>
                        </div>

                        <button
                          type="button"
                          className="btn-delete-entry"
                          onClick={() => removeHistoryEntry(entry.id)}
                          aria-label={`Remove "${entry.title}" from history`}
                          title="Remove from history"
                        >
                          <X size={15} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {historyStorageWarning && (
                  <div className="history-storage-warning" role="alert">
                    <AlertTriangle size={13} />
                    <span>Browser storage is nearly full or restricted. Oldest items were removed to preserve space.</span>
                  </div>
                )}
                <div className="history-footer-note">
                  <span>Privacy Notice:</span> Stored strictly in local browser storage (localStorage). Never synced or logged on ReelFlow servers.
                </div>
              </div>
            )}
          </section>
        </section>

        {/* Feature Grid Section */}
        <section className="section wrap" id="features">
          <div className="section-heading">
            <span className="mini-label">WHY REELFLOW</span>
            <h2>
              Designed for speed.<br />
              <span>Built for simplicity.</span>
            </h2>
            <p>A refined tool crafted to save and preview public videos effortlessly on any screen.</p>
          </div>

          <div className="feature-grid">
            <article className="feature-card">
              <div className="feature-icon">
                <Zap size={22} />
              </div>
              <h3>Fast Link Lookup</h3>
              <p>Fetches media metadata efficiently without asking for user logins, passwords, or cookies.</p>
            </article>

            <article className="feature-card">
              <div className="feature-icon">
                <CirclePlay size={22} />
              </div>
              <h3>Media Preview</h3>
              <p>Preview verified thumbnail, description, platform source, and duration before downloading.</p>
            </article>

            <article className="feature-card">
              <div className="feature-icon">
                <ArrowDownToLine size={22} />
              </div>
              <h3>Quality Selection</h3>
              <p>Choose the optimal resolution from available stream tracks to match your screen or data plan.</p>
            </article>
          </div>
        </section>

        {/* How It Works Section */}
        <section className="how-section" id="how-it-works">
          <div className="wrap">
            <div className="section-heading">
              <span className="mini-label">HOW IT WORKS</span>
              <h2>Three steps. That's it.</h2>
              <p>No account or registration required.</p>
            </div>

            <div className="steps">
              <article className="step-card">
                <span className="step-number">01</span>
                <h3>Copy Link</h3>
                <p>Copy a public Reel or video link from Instagram, Facebook, or YouTube.</p>
              </article>

              <article className="step-card">
                <span className="step-number">02</span>
                <h3>Paste &amp; Fetch</h3>
                <p>Paste the link above and click "Fetch Media" (or "Preview YouTube Video") to inspect details.</p>
              </article>

              <article className="step-card">
                <span className="step-number">03</span>
                <h3>Download or Preview</h3>
                <p>Download supported Instagram and Facebook videos directly in your chosen resolution, or view official YouTube creator guidance.</p>
              </article>
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section className="section wrap faq-section" id="faq" aria-labelledby="faq-title">
          <div className="section-heading">
            <span className="mini-label">FAQS</span>
            <h2 id="faq-title">Frequently Asked Questions</h2>
            <p>Everything you need to know about downloading Instagram Reels, Facebook videos, and previewing YouTube links with ReelFlow.</p>
          </div>

          <div className="faq-accordion" role="region" aria-label="Frequently Asked Questions Accordion">
            {[
              {
                q: "What is ReelFlow?",
                a: "ReelFlow is a fast, web-based media utility designed to download publicly accessible Instagram Reels and Facebook videos in clean MP4 format, and to preview supported YouTube video links with verified metadata and official creator guidance. It works entirely in your browser without requiring account registrations, passwords, or browser extensions."
              },
              {
                q: "How do I download an Instagram Reel or Facebook video?",
                a: "Downloading is straightforward in three simple steps: 1) Copy the link of any public Instagram Reel or Facebook video; 2) Paste the link into the search bar at the top of ReelFlow and click 'Fetch Media'; 3) Once the media preview and available resolutions appear, select your preferred quality and click 'Download MP4'."
              },
              {
                q: "Can I download Facebook videos?",
                a: "Yes. ReelFlow supports standard public Facebook video posts, Facebook Watch clips, and public Facebook Reels. Simply copy the public link from Facebook, paste it into the downloader, and retrieve the video."
              },
              {
                q: "Can I preview YouTube videos on ReelFlow?",
                a: "Yes. When you paste a supported public YouTube link (including youtube.com/watch, youtu.be, and YouTube Shorts), ReelFlow fetches verified video metadata, title, author, and thumbnail, displaying a clear 'YouTube Preview'. Direct downloading is not available in this workflow in order to respect copyright and YouTube platform terms; creators can access official tools via YouTube Studio, and viewers are guided to official YouTube offline features."
              },
              {
                q: "Can I choose video quality?",
                a: "Yes, for downloadable Instagram and Facebook media when multiple formats are supplied by the hosting platform. ReelFlow inspects the media stream and presents available resolutions (such as Original/Best, 1080p, 720p, or 480p). Note that quality options depend strictly on what the source video was originally uploaded with and what the platform exposes publicly."
              },
              {
                q: "Do I need to log in to Instagram, Facebook, or YouTube?",
                a: "No. ReelFlow never asks for your Instagram, Facebook, or YouTube credentials, passwords, session cookies, or personal accounts. It is entirely anonymous and interacts only with publicly accessible URLs."
              },
              {
                q: "Why is my video URL not working?",
                a: "A URL may fail to load if: 1) The post is private, friends-only, or restricted to logged-in accounts; 2) The video was deleted or removed by its author; 3) The link is malformed or belongs to an unsupported URL format (such as temporary Stories or private direct messages); 4) The platform is temporarily rate-limiting requests or changing its delivery endpoint."
              },
              {
                q: "Why is my video download failing?",
                a: "Downloads can fail if your download token expired (tokens are kept valid for 15 minutes for security and memory efficiency), if the upstream server broke the stream connection, or if your network disconnected during multiplexing. If this happens, simply click 'Find Video' again to generate a fresh link."
              },
              {
                q: "Can I use ReelFlow on my mobile phone?",
                a: "Yes. ReelFlow is built with a responsive, mobile-first design. It works seamlessly on iOS (Safari, Chrome) and Android (Chrome, Firefox, Samsung Internet). On iPhones, downloads save directly to your Files app or Photos gallery."
              },
              {
                q: "Does ReelFlow store my downloaded videos?",
                a: "No. ReelFlow does not operate a permanent media storage library or database of user downloads. All video processing is transient: media is fetched and streamed directly to your browser, and temporary working files on the server are purged immediately upon stream completion or disconnection. Operational logs record only aggregate system health metrics (like total lookups and success rates) with zero raw video links or visitor IP addresses."
              },
              {
                q: "Why can't I download arbitrary YouTube videos directly?",
                a: "ReelFlow complies strictly with YouTube terms and copyright laws. YouTube's platform terms prohibit downloading third-party videos without rights holder permission or bypassing access controls. When you paste a YouTube link, ReelFlow recognizes the video and provides lawful options: video creators can download their own MP4 files directly from YouTube Studio, while viewers can use official offline downloads in the YouTube mobile app via YouTube Premium."
              },
              {
                q: "Is ReelFlow free to use?",
                a: "Yes, ReelFlow is free to use for personal, fair-use archiving and research. Please ensure you respect copyright laws and platform terms: download only media that you own, create, or have explicit permission from the rights holder to archive."
              }
            ].map((item, idx) => {
              const isOpen = openFaq === idx;
              const buttonId = `faq-btn-${idx}`;
              const panelId = `faq-panel-${idx}`;

              return (
                <div 
                  key={idx} 
                  className={`faq-accordion-item ${isOpen ? 'open' : ''}`}
                >
                  <button
                    type="button"
                    id={buttonId}
                    className="faq-accordion-trigger"
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick={() => setOpenFaq(isOpen ? null : idx)}
                  >
                    <span className="faq-question-text">{item.q}</span>
                    <span className="faq-icon-wrap" aria-hidden="true">
                      <ChevronDown size={18} className={`faq-chevron ${isOpen ? 'rotated' : ''}`} />
                    </span>
                  </button>

                  <div
                    id={panelId}
                    role="region"
                    aria-labelledby={buttonId}
                    className={`faq-accordion-panel ${isOpen ? 'expanded' : 'collapsed'}`}
                  >
                    <div className="faq-accordion-content">
                      <p>{item.a}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </main>

      {/* Modern Footer with Navigation */}
      <footer className="footer">
        <div className="wrap footer-wrap">
          <div className="footer-top">
            <a className="brand" href="/" aria-label="ReelFlow Home">
              <span className="brand-mark">
                <Clapperboard size={17} />
              </span>
              <span>
                ReelFlow<span className="brand-dot">.</span>
              </span>
            </a>

            <div className="footer-nav">
              <a 
                className="footer-link" 
                href="/privacy" 
                onClick={(e) => { e.preventDefault(); navigateTo('privacy'); }}
              >
                Privacy Policy
              </a>
              <a 
                className="footer-link" 
                href="/terms" 
                onClick={(e) => { e.preventDefault(); navigateTo('terms'); }}
              >
                Terms of Service
              </a>
              <a 
                className="footer-link" 
                href="/contact" 
                onClick={(e) => { e.preventDefault(); navigateTo('contact'); }}
              >
                Contact
              </a>
            </div>
          </div>

          <div className="footer-bottom">
            <p className="footer-disclaimer">
              Independent utility. Not affiliated with Instagram, Facebook, or Meta. Download only public media you own or have permission from its rights holder to save. Respect copyright law and platform guidelines.
            </p>
            <p className="footer-copyright">
              © 2026 ReelFlow. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}