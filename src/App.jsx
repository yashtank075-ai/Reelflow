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
  ArrowLeft,
  Mail,
  FileText
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
        document.title = 'ReelFlow — Download Instagram Reels & Facebook Videos';
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
        <header className="topbar">
          <div className="wrap nav-container">
            <a className="brand" href="/" onClick={(e) => navigateTo('home', e)} aria-label="ReelFlow Home">
              <span className="brand-mark">
                <Clapperboard size={19} />
              </span>
              <span>
                reelflow<span className="brand-dot">.</span>
              </span>
            </a>
            <div className="top-pill">
              <span className="live-dot" />
              <span>Admin Console</span>
            </div>
          </div>
        </header>

        <AdminAnalytics onBack={() => navigateTo('home')} />
      </div>
    );
  }

  if (currentPage === 'privacy' || currentPage === 'terms' || currentPage === 'contact') {
    return (
      <div className="app-shell">
        <header className="topbar legal-topbar">
          <div className="wrap nav-container">
            <a className="brand" href="/" aria-label="ReelFlow Home">
              <span className="brand-mark">
                <Clapperboard size={18} />
              </span>
              <span>
                reelflow<span className="brand-dot">.</span>
              </span>
            </a>

            <a className="nav-back-button" href="/" aria-label="Back to Downloader">
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

        <footer className="footer wrap">
          <div className="footer-top">
            <a className="brand" href="/" aria-label="ReelFlow Home">
              <span className="brand-mark">
                <Clapperboard size={16} />
              </span>
              <span>
                reelflow<span className="brand-dot">.</span>
              </span>
            </a>

            <div className="footer-nav">
              <a className="footer-link" href="https://reelflow-fq7d.onrender.com/privacy" target="_blank" rel="noopener noreferrer">
                Privacy Policy
              </a>
              <a className="footer-link" href="https://reelflow-fq7d.onrender.com/terms" target="_blank" rel="noopener noreferrer">
                Terms of Service
              </a>
              <a className="footer-link" href="https://reelflow-fq7d.onrender.com/contact" target="_blank" rel="noopener noreferrer">
                Contact
              </a>
            </div>
          </div>

          <p className="footer-disclaimer">
            Independent utility. Not affiliated with Instagram, Facebook, or Meta. Download only public media you own or have permission from its rights holder to save. Respect copyright law and platform guidelines.
          </p>
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
      setError('Please paste a valid Instagram Reel or Facebook video URL.');
      return;
    }

    const host = parsed.hostname.toLowerCase();
    const instagramHost = ['instagram.com', 'www.instagram.com', 'm.instagram.com'].includes(host);
    const facebookHost = ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com', 'fb.watch'].includes(host);
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

    if (
      parsed.protocol !== 'https:' || 
      parsed.username || 
      parsed.password || 
      parsed.port || 
      (!(instagramHost && instagramPath) && !(facebookHost && facebookPath))
    ) {
      setError('Unsupported link. Please paste a public Instagram Reel or Facebook video URL.');
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

  async function downloadVideo() {
    if (!result?.downloadUrl || downloading) return;
    setDownloading(true);
    setError('');
    setDownloadSuccess(false);

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
    } catch (err) {
      setError(err.message || 'Download failed. Please try again.');
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

  return (
    <div className="app-shell">
      {/* Top Navbar */}
      <header className="topbar">
        <div className="wrap nav-container">
          <a className="brand" href="/" aria-label="ReelFlow Home">
            <span className="brand-mark">
              <Clapperboard size={19} />
            </span>
            <span>
              reelflow<span className="brand-dot">.</span>
            </span>
          </a>

          <div className="top-pill">
            <span className="live-dot" />
            <span>Operational</span>
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
            Download Instagram Reels &amp;<br />
            <span>Facebook Videos Fast.</span>
          </h1>

          <p className="hero-copy">
            Save publicly accessible Instagram Reels and Facebook videos with ReelFlow. Choose an available video quality and download supported videos easily.
          </p>

          <div className="platform-chips">
            <span className="platform-chip instagram">
              <Sparkles size={12} /> Instagram Reels
            </span>
            <span className="platform-chip facebook">
              <Zap size={12} /> Facebook Videos
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
                <input
                  ref={inputRef}
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="Paste Instagram Reel or Facebook URL..."
                  aria-label="Instagram or Facebook video URL"
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
                ) : (
                  <>
                    <span>Fetch Media</span>
                    <ArrowUpRight size={17} />
                  </>
                )}
              </button>
            </form>

            <div className="input-caption">
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
                    {result.provider === 'facebook' ? 'FACEBOOK VIDEO' : 'INSTAGRAM REEL'}
                  </span>
                  <h2>Media Ready</h2>
                </div>
                <span className="status-pill">
                  <Check size={14} /> Accessible
                </span>
              </div>

              <div className="result-content">
                <div className="reel-thumb">
                  {result.thumbnailUrl && !thumbError ? (
                    <img 
                      src={result.thumbnailUrl} 
                      alt={result.title || "Reel preview thumbnail"} 
                      loading="lazy" 
                      onError={() => setThumbError(true)}
                    />
                  ) : (
                    <div className="thumb-placeholder">
                      <CirclePlay size={44} />
                      <span>{result.provider === 'facebook' ? 'FACEBOOK VIDEO' : 'REEL PREVIEW'}</span>
                    </div>
                  )}
                  <span className="thumb-badge">
                    {result.provider === 'facebook' ? 'Facebook' : 'Reel'}
                  </span>
                </div>

                <div className="result-info">
                  {/* Verified Metadata Badges */}
                  <div className="meta-badges">
                    <span className="meta-badge">
                      {result.provider === 'facebook' ? 'Facebook Video' : 'Instagram Reel'}
                    </span>
                    {result.duration && (
                      <span className="meta-badge">
                        <Clock size={12} /> {formatDuration(result.duration)}
                      </span>
                    )}
                    <span className="meta-badge">
                      <HardDrive size={12} /> {result.filesizeBytes ? `~${formatBytes(result.filesizeBytes)}` : 'Size unavailable'}
                    </span>
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

                  {/* Dynamic Video Quality Selector */}
                  <div className="quality-control">
                    <div className="quality-control-label">
                      <span>Select Resolution</span>
                      <small>
                        {maxDetectedHeight ? `Source max: ${maxDetectedHeight}p` : 'MP4 video stream'}
                      </small>
                    </div>
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
        </section>

        {/* Feature Grid Section */}
        <section className="section wrap">
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
        <section className="how-section">
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
                <p>Copy a public Reel or video URL from Instagram or Facebook.</p>
              </article>

              <article className="step-card">
                <span className="step-number">02</span>
                <h3>Paste &amp; Fetch</h3>
                <p>Paste the link above and click "Fetch Media" to retrieve details.</p>
              </article>

              <article className="step-card">
                <span className="step-number">03</span>
                <h3>Download Video</h3>
                <p>Pick your preferred resolution and save the video directly to your device.</p>
              </article>
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section className="section wrap">
          <div className="section-heading">
            <span className="mini-label">FAQS</span>
            <h2>Frequently Asked Questions</h2>
          </div>

          <div className="faq-grid">
            <div className="faq-item">
              <h4>Does it work on mobile phones?</h4>
              <p>Yes. ReelFlow is fully mobile responsive and touch-optimized for Safari, Chrome, and all major mobile browsers.</p>
            </div>

            <div className="faq-item">
              <h4>Do I need an account or Instagram login?</h4>
              <p>Never. ReelFlow does not require accounts, credentials, or cookies. It processes only public accessible media.</p>
            </div>

            <div className="faq-item">
              <h4>Can I save private videos or stories?</h4>
              <p>No. ReelFlow strictly respects platform privacy and access controls. Only public Reels and video posts are supported.</p>
            </div>

            <div className="faq-item">
              <h4>Where are downloaded files saved?</h4>
              <p>Files are saved directly to your device's default Downloads folder or your Photos app gallery.</p>
            </div>
          </div>
        </section>
      </main>

      {/* Modern Footer with Navigation */}
      <footer className="footer wrap">
        <div className="footer-top">
          <a className="brand" href="/" aria-label="ReelFlow Home">
            <span className="brand-mark">
              <Clapperboard size={16} />
            </span>
            <span>
              reelflow<span className="brand-dot">.</span>
            </span>
          </a>

          <div className="footer-nav">
            <a 
              className="footer-link" 
              href="https://reelflow-fq7d.onrender.com/privacy" 
              target="_blank" 
              rel="noopener noreferrer"
            >
              Privacy Policy
            </a>
            <a 
              className="footer-link" 
              href="https://reelflow-fq7d.onrender.com/terms" 
              target="_blank" 
              rel="noopener noreferrer"
            >
              Terms of Service
            </a>
            <a 
              className="footer-link" 
              href="https://reelflow-fq7d.onrender.com/contact" 
              target="_blank" 
              rel="noopener noreferrer"
            >
              Contact
            </a>
          </div>
        </div>

        <p className="footer-disclaimer">
          Independent utility. Not affiliated with Instagram, Facebook, or Meta. Download only public media you own or have permission from its rights holder to save. Respect copyright law and platform guidelines.
        </p>
      </footer>
    </div>
  );
}