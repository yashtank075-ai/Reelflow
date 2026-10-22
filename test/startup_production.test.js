import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

test('Production Startup: Render start script runs ReelFlow server directly and excludes api.js', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  
  // Verify start, build, and dev scripts run legitimate commands only
  assert.equal(pkg.scripts.start, 'node server/index.js', 'Start script must start Express directly');
  assert.equal(pkg.scripts.build, 'vite build', 'Build script must run vite build directly');
  assert.equal(pkg.scripts.dev, 'concurrently "npm run server" "npm run client"', 'Dev script must run server and client directly');

  // Verify none of the lifecycle scripts invoke api.js
  for (const [scriptName, scriptCmd] of Object.entries(pkg.scripts)) {
    assert.ok(
      !scriptCmd.includes('api.js'),
      `Script "${scriptName}" should not reference removed payload api.js (found: "${scriptCmd}")`
    );
  }

  // Verify api.js no longer exists on disk
  const apiJsExists = fs.existsSync(new URL('../api.js', import.meta.url));
  assert.equal(apiJsExists, false, 'api.js payload file must be permanently removed from repository');
});

test('Configuration Integrity: vite.config.js contains no obfuscated payload code', () => {
  const viteConfig = fs.readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
  assert.ok(!viteConfig.includes("global['!']"), 'vite.config.js must not contain injected global assignments');
  assert.ok(!viteConfig.includes('createRequire'), 'vite.config.js must not import createRequire');
  assert.ok(!viteConfig.includes('eval('), 'vite.config.js must not contain eval calls');
});

test('Production Server: Express server starts, binds to PORT, and remains running', async () => {
  const testPort = '5899';
  const child = spawn('node', ['server/index.js'], {
    env: {
      ...process.env,
      PORT: testPort,
      ADMIN_PASSWORD: 'test_secure_password_123'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    const started = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Server startup timed out after 7000ms'));
      }, 7000);

      child.stdout.on('data', (data) => {
        const msg = data.toString();
        if (msg.includes(`ReelFlow API running at http://localhost:${testPort}`)) {
          clearTimeout(timer);
          resolve(true);
        }
      });

      child.stderr.on('data', (data) => {
        const err = data.toString();
        if (err.includes('Error') && !err.includes('PostgreSQL')) {
          clearTimeout(timer);
          reject(new Error(`Server failed to start: ${err}`));
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      child.on('exit', (code) => {
        clearTimeout(timer);
        if (code !== 0 && code !== null) {
          reject(new Error(`Server exited unexpectedly with exit code ${code}`));
        }
      });
    });

    assert.equal(started, true, 'Server must start and log listen notification');

    // Verify HTTP connectivity on the assigned port
    const res = await fetch(`http://localhost:${testPort}/api/admin/auth/check`);
    assert.equal(res.status, 200, 'HTTP response on assigned PORT should be 200');
    const body = await res.json();
    assert.equal(typeof body.authenticated, 'boolean');

    // Verify /robots.txt content and public route allowance
    const robotsRes = await fetch(`http://localhost:${testPort}/robots.txt`);
    assert.equal(robotsRes.status, 200);
    const robotsText = await robotsRes.text();
    assert.ok(robotsText.includes('Allow: /terms'), 'robots.txt must allow /terms');
    assert.ok(robotsText.includes('Allow: /contact'), 'robots.txt must allow /contact');
    assert.ok(robotsText.includes('Allow: /privacy'), 'robots.txt must allow /privacy');
    assert.ok(robotsText.includes('Allow: /'), 'robots.txt must allow /');
    assert.ok(!robotsText.includes('Disallow: /terms'), 'robots.txt must not disallow /terms');
    assert.ok(!robotsText.includes('Disallow: /contact'), 'robots.txt must not disallow /contact');
    assert.ok(robotsText.includes('Sitemap: https://reelflow-fq7d.onrender.com/sitemap.xml'), 'robots.txt must reference valid sitemap');

    // Verify /sitemap.xml content
    const sitemapRes = await fetch(`http://localhost:${testPort}/sitemap.xml`);
    assert.equal(sitemapRes.status, 200);
    const sitemapText = await sitemapRes.text();
    assert.ok(sitemapText.includes('https://reelflow-fq7d.onrender.com/terms'), 'sitemap must list /terms');
    assert.ok(sitemapText.includes('https://reelflow-fq7d.onrender.com/contact'), 'sitemap must list /contact');
    assert.ok(sitemapText.includes('https://reelflow-fq7d.onrender.com/privacy'), 'sitemap must list /privacy');
  } finally {
    child.kill('SIGTERM');
  }
});
