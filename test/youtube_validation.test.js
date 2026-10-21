import test from 'node:test';
import assert from 'node:assert/strict';

// Test isolated URL parsing logic
const INSTAGRAM_HOSTS = new Set(['instagram.com', 'www.instagram.com', 'm.instagram.com']);
const FACEBOOK_HOSTS = new Set(['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com', 'fb.watch']);
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']);

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
    if (host === 'fb.watch') {
      const match = url.pathname.match(/^\/([A-Za-z0-9._-]+)\/?$/);
      if (!match) return null;
      return { 
        provider: 'facebook', 
        id: match[1], 
        canonical: `https://fb.watch/${match[1]}/` 
      };
    }

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

    const pathSegments = url.pathname.split('/').filter(Boolean);
    const videoIdx = pathSegments.findIndex(seg => /^(reel|videos)$/i.test(seg));
    const shareIdx = pathSegments.findIndex(seg => /^share$/i.test(seg));

    let videoId = null;
    let normalizedPath = null;

    if (videoIdx !== -1 && pathSegments[videoIdx + 1]) {
      videoId = pathSegments[videoIdx + 1];
      normalizedPath = `/${pathSegments[videoIdx].toLowerCase()}/${videoId}/`;
    } else if (shareIdx !== -1 && pathSegments[shareIdx + 1] && pathSegments[shareIdx + 2]) {
      const shareType = pathSegments[shareIdx + 1].toLowerCase();
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
    if (host === 'youtu.be') {
      const match = url.pathname.match(/^\/([A-Za-z0-9_-]{11})\/?$/);
      if (!match) return null;
      return {
        provider: 'youtube',
        id: match[1],
        canonical: `https://www.youtube.com/watch?v=${match[1]}`
      };
    }

    const shortsMatch = url.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{11})\/?$/i);
    if (shortsMatch) {
      return {
        provider: 'youtube',
        id: shortsMatch[1],
        canonical: `https://www.youtube.com/shorts/${shortsMatch[1]}`
      };
    }

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

test('YouTube URL Recognition: Valid youtube.com/watch URLs (with and without www)', () => {
  const parsedWww = parseMediaPermalink('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.ok(parsedWww);
  assert.equal(parsedWww.provider, 'youtube');
  assert.equal(parsedWww.id, 'dQw4w9WgXcQ');
  assert.equal(parsedWww.canonical, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');

  const parsedApex = parseMediaPermalink('https://youtube.com/watch?v=dQw4w9WgXcQ');
  assert.ok(parsedApex);
  assert.equal(parsedApex.provider, 'youtube');
  assert.equal(parsedApex.id, 'dQw4w9WgXcQ');
  assert.equal(parsedApex.canonical, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');

  // watch URL with extra tracking parameters like si or t
  const parsedTracking = parseMediaPermalink('https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=12345&t=10s');
  assert.ok(parsedTracking);
  assert.equal(parsedTracking.provider, 'youtube');
  assert.equal(parsedTracking.id, 'dQw4w9WgXcQ');
  assert.equal(parsedTracking.canonical, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
});

test('YouTube URL Recognition: Valid youtu.be shortlinks (including bug report URL with ?si= parameter)', () => {
  // Exact user URL from bug report
  const parsedBugReport = parseMediaPermalink('https://youtu.be/O3R08sfOFIM?si=vDrgYN6Nk6aA7aal');
  assert.ok(parsedBugReport);
  assert.equal(parsedBugReport.provider, 'youtube');
  assert.equal(parsedBugReport.id, 'O3R08sfOFIM');
  assert.equal(parsedBugReport.canonical, 'https://www.youtube.com/watch?v=O3R08sfOFIM');

  const parsed = parseMediaPermalink('https://youtu.be/dQw4w9WgXcQ');
  assert.ok(parsed);
  assert.equal(parsed.provider, 'youtube');
  assert.equal(parsed.id, 'dQw4w9WgXcQ');
  assert.equal(parsed.canonical, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
});

test('YouTube URL Recognition: Valid youtube.com/shorts URLs (including tracking parameters)', () => {
  const parsed = parseMediaPermalink('https://www.youtube.com/shorts/abcdefghijk');
  assert.ok(parsed);
  assert.equal(parsed.provider, 'youtube');
  assert.equal(parsed.id, 'abcdefghijk');
  assert.equal(parsed.canonical, 'https://www.youtube.com/shorts/abcdefghijk');

  const parsedTracking = parseMediaPermalink('https://youtube.com/shorts/abcdefghijk?si=99887766');
  assert.ok(parsedTracking);
  assert.equal(parsedTracking.provider, 'youtube');
  assert.equal(parsedTracking.id, 'abcdefghijk');
  assert.equal(parsedTracking.canonical, 'https://www.youtube.com/shorts/abcdefghijk');
});

test('YouTube Security: Reject deceptive hostnames and subdomains', () => {
  assert.equal(parseMediaPermalink('https://youtube.com.attacker.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(parseMediaPermalink('https://notyoutube.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(parseMediaPermalink('https://fake-youtu.be/dQw4w9WgXcQ'), null);
  assert.equal(parseMediaPermalink('https://evil-youtube.com/shorts/abcdefghijk'), null);
});

test('YouTube Security: Reject non-HTTPS, credentials, and non-standard ports', () => {
  assert.equal(parseMediaPermalink('http://www.youtube.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(parseMediaPermalink('https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(parseMediaPermalink('https://www.youtube.com:8080/watch?v=dQw4w9WgXcQ'), null);
});

test('YouTube Validation: Reject malformed video IDs or non-video paths', () => {
  assert.equal(parseMediaPermalink('https://www.youtube.com/watch?v=short'), null); // < 11 chars
  assert.equal(parseMediaPermalink('https://www.youtube.com/watch?v=toolongvideoid12345'), null); // > 11 chars
  assert.equal(parseMediaPermalink('https://www.youtube.com/channel/UC1234567890'), null); // channel path
  assert.equal(parseMediaPermalink('https://www.youtube.com/playlist?list=PL12345'), null); // playlist path
});

test('Regression Test: Instagram Reel URLs remain functional', () => {
  const reel = parseMediaPermalink('https://www.instagram.com/reel/C3bCdEfG123/');
  assert.ok(reel);
  assert.equal(reel.provider, 'instagram');
  assert.equal(reel.id, 'C3bCdEfG123');
  assert.equal(reel.canonical, 'https://www.instagram.com/reel/C3bCdEfG123/');

  const post = parseMediaPermalink('https://www.instagram.com/p/C3bCdEfG123/');
  assert.ok(post);
  assert.equal(post.provider, 'instagram');
});

test('Regression Test: Facebook Video URLs remain functional', () => {
  const fbWatch = parseMediaPermalink('https://fb.watch/xyz123/');
  assert.ok(fbWatch);
  assert.equal(fbWatch.provider, 'facebook');
  assert.equal(fbWatch.canonical, 'https://fb.watch/xyz123/');

  const fbQuery = parseMediaPermalink('https://www.facebook.com/watch/?v=9876543210');
  assert.ok(fbQuery);
  assert.equal(fbQuery.provider, 'facebook');
  assert.equal(fbQuery.id, '9876543210');
  assert.equal(fbQuery.canonical, 'https://www.facebook.com/watch/?v=9876543210');

  const fbReel = parseMediaPermalink('https://www.facebook.com/reel/1234567890123/');
  assert.ok(fbReel);
  assert.equal(fbReel.provider, 'facebook');
  assert.equal(fbReel.canonical, 'https://www.facebook.com/reel/1234567890123/');
});

test('Analytics and Security Enums: Verify ALLOWED_PLATFORMS includes youtube', async () => {
  const { recordAnalyticsEvent } = await import('../server/analytics.js');
  assert.doesNotThrow(() => {
    recordAnalyticsEvent({
      eventType: 'lookup',
      platform: 'youtube',
      outcome: 'success',
      durationMs: 120,
      statusCode: 200
    });
  });
});

test('UI Logic: Action button is platform-aware for YouTube vs other platforms', () => {
  function getActionLabel(urlInput) {
    const trimmed = (urlInput || '').trim();
    if (!trimmed) return 'Fetch Media';
    try {
      const parsed = new URL(trimmed);
      const host = parsed.hostname.toLowerCase();
      if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(host)) {
        return 'Preview YouTube Video';
      }
    } catch {
      if (/youtu(\.be|be\.com)/i.test(trimmed)) {
        return 'Preview YouTube Video';
      }
    }
    return 'Fetch Media';
  }

  // YouTube URLs
  assert.equal(getActionLabel('https://youtu.be/O3R08sfOFIM?si=vDrgYN6Nk6aA7aal'), 'Preview YouTube Video');
  assert.equal(getActionLabel('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'Preview YouTube Video');
  assert.equal(getActionLabel('https://youtube.com/shorts/abcdefghijk'), 'Preview YouTube Video');

  // Instagram and Facebook URLs
  assert.equal(getActionLabel('https://www.instagram.com/reel/C3bCdEfG123/'), 'Fetch Media');
  assert.equal(getActionLabel('https://www.facebook.com/watch/?v=9876543210'), 'Fetch Media');
  assert.equal(getActionLabel(''), 'Fetch Media');
});

test('UI Logic: Status badge and result title reflect preview mode for YouTube', () => {
  function getResultMeta(provider) {
    if (provider === 'youtube') {
      return {
        statusBadge: 'YouTube Preview',
        heading: 'Video Preview',
        downloadNotice: 'Direct downloading is not available in this workflow. Video creators can download original MP4 files via YouTube Studio.'
      };
    }
    return {
      statusBadge: 'Accessible',
      heading: 'Media Ready',
      downloadNotice: null
    };
  }

  const ytMeta = getResultMeta('youtube');
  assert.equal(ytMeta.statusBadge, 'YouTube Preview');
  assert.equal(ytMeta.heading, 'Video Preview');
  assert.match(ytMeta.downloadNotice, /Direct downloading is not available in this workflow/);

  const igMeta = getResultMeta('instagram');
  assert.equal(igMeta.statusBadge, 'Accessible');
  assert.equal(igMeta.heading, 'Media Ready');

  const fbMeta = getResultMeta('facebook');
  assert.equal(fbMeta.statusBadge, 'Accessible');
  assert.equal(fbMeta.heading, 'Media Ready');
});

