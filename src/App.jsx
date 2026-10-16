import { useState, useRef } from 'react';
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
  Smartphone
} from 'lucide-react';

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

export default function App() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [quality, setQuality] = useState('best');
  const [thumbError, setThumbError] = useState(false);
  const [downloadSuccess, setDownloadSuccess] = useState(false);
  const [activeModal, setActiveModal] = useState(null); // 'privacy' | 'terms' | 'contact'
  const inputRef = useRef(null);

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
            Save the moments.<br />
            <span>Keep the memories.</span>
          </h1>

          <p className="hero-copy">
            Paste any public Instagram Reel or Facebook video link to preview media and save it in high definition without logging in.
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
          {result && (
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
            <button type="button" className="footer-link-btn" onClick={() => setActiveModal('privacy')}>
              Privacy Policy
            </button>
            <button type="button" className="footer-link-btn" onClick={() => setActiveModal('terms')}>
              Terms of Use
            </button>
            <button type="button" className="footer-link-btn" onClick={() => setActiveModal('contact')}>
              Contact
            </button>
          </div>
        </div>

        <p className="footer-disclaimer">
          Independent utility. Not affiliated with Instagram, Facebook, or Meta. Download only public media you own or have permission from its rights holder to save. Respect copyright law and platform guidelines.
        </p>
      </footer>

      {/* Accessible Modals for Privacy, Terms & Contact */}
      {activeModal && (
        <div className="modal-overlay" onClick={() => setActiveModal(null)} role="dialog" aria-modal="true">
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                {activeModal === 'privacy' && 'Privacy Policy'}
                {activeModal === 'terms' && 'Terms of Use'}
                {activeModal === 'contact' && 'Contact & Support'}
              </h3>
              <button 
                type="button" 
                className="modal-close-btn" 
                onClick={() => setActiveModal(null)}
                aria-label="Close dialog"
              >
                <X size={16} />
              </button>
            </div>

            <div className="modal-body">
              {activeModal === 'privacy' && (
                <>
                  <p>ReelFlow is built with strict privacy standards:</p>
                  <ul>
                    <li>We do not require or ask for your Instagram, Facebook, or social passwords or tokens.</li>
                    <li>We do not track your personal identity or sell your browsing history.</li>
                    <li>Temporary download files are purged immediately from server storage once streaming completes.</li>
                    <li>Download tokens are generated in volatile memory with short 15-minute expirations.</li>
                  </ul>
                  <p>All interactions with public media links adhere to open metadata inspections.</p>
                </>
              )}

              {activeModal === 'terms' && (
                <>
                  <p>By using ReelFlow, you agree to the following conditions:</p>
                  <ul>
                    <li>You will only download public content for personal, non-commercial use, or content for which you own the copyright or have explicit permission.</li>
                    <li>You will not use automated scrapers to abuse or overload the service.</li>
                    <li>ReelFlow provides media access as-is, subject to upstream platform availability.</li>
                    <li>ReelFlow is an independent project and is not sponsored by or affiliated with Instagram or Meta.</li>
                  </ul>
                </>
              )}

              {activeModal === 'contact' && (
                <>
                  <p>Have questions, suggestions, or reports?</p>
                  <p>ReelFlow is an open developer utility. If you experience issues with specific link formats or wish to report a concern, reach out to the project administrator or consult the project repository documentation.</p>
                  <p style={{ marginTop: '14px', color: 'var(--text-muted)' }}>Response time is typically within 24–48 hours for verified inquiries.</p>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}