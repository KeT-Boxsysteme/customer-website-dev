// DB-Schicht mocken – Tests dürfen NIE die echte Azure-DB berühren
jest.mock('../config/database', () => ({
  getPool: jest.fn().mockRejectedValue(new Error('DB access not allowed in tests')),
  closePool: jest.fn().mockResolvedValue(undefined),
  sql: {}
}));

// E-Mail-Versand mocken – kein echter SMTP-Kontakt
jest.mock('../services/email', () => ({
  sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
  sendNewRegistrationToKeT: jest.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
  sendUserCreatedEmail: jest.fn().mockResolvedValue(undefined),
  sendContactMessage: jest.fn().mockResolvedValue(undefined)
}));

const request = require('supertest');
const app = require('../server');

describe('App basic routes (unauthenticated)', () => {
  test('GET / redirects to /auth/login when logged out', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/auth/login');
  });

  test('GET /auth/login returns 200 and contains "Glovebox-Monitoring"', async () => {
    const res = await request(app).get('/auth/login');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Glovebox-Monitoring');
  });

  test('GET /dashboard redirects to login when unauthenticated', async () => {
    const res = await request(app).get('/dashboard');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/auth/login');
  });

  test('GET /nonexistent returns 404', async () => {
    const res = await request(app).get('/nonexistent');
    expect(res.status).toBe(404);
  });
});

describe('Turbo + background sensor hub in the page head', () => {
  const request = require('supertest');
  test('login page loads Turbo, but not the sensor hub (nobody logged in)', async () => {
    const res = await request(app).get('/auth/login');
    expect(res.text).toContain('/js/vendor/turbo.umd.js');
    expect(res.text).not.toContain('/js/sensor-hub.js');
  });
});

describe('versioned asset URLs (no stale JS after a deploy)', () => {
  const request = require('supertest');
  test('scripts and stylesheet carry a content hash', async () => {
    const res = await request(app).get('/auth/login');
    expect(res.text).toMatch(/\/js\/vendor\/turbo\.umd\.js\?v=[0-9a-f]{10}"/);
    expect(res.text).toMatch(/\/css\/style\.css\?v=[0-9a-f]{10}"/);
    expect(res.text).toMatch(/\/js\/main\.js\?v=[0-9a-f]{10}"/);
  });
});

describe('deploys do not force a full reload (Betreiber 01.10.: a reload drops the Bluetooth connection)', () => {
  const request = require('supertest');
  const tag = (html, file) => (html.match(new RegExp('<(?:script|link)[^>]*' + file.split('.').join('\\.') + '\\?v=[^>]*>')) || [''])[0];
  test('only Turbo itself is tracked with reload; CSS is swapped dynamically', async () => {
    const res = await request(app).get('/auth/login');
    expect(tag(res.text, 'turbo.umd.js')).toContain('data-turbo-track="reload"');
    expect(tag(res.text, 'style.css')).toContain('data-turbo-track="dynamic"');
  });
});

describe('brand font Skyload (Konzept.txt: "Glovebox-Monitoring by KeT" in Skyload)', () => {
  const request = require('supertest');
  test('the font file referenced by the stylesheet is actually served', async () => {
    const css = await request(app).get('/css/style.css');
    const m = css.text.match(/@font-face\s*\{[^}]*font-family:\s*'Skyload'[^}]*url\('([^']+)'\)/);
    expect(m).not.toBeNull();
    const font = await request(app).get(m[1]);
    expect(font.status).toBe(200);
    expect(font.body.length).toBeGreaterThan(10000);
  });
});

describe('login/register pages stay scrollable on low screens (Fund 01.10.: form cut off, no scrolling)', () => {
  // overflow on <body> propagates to the viewport and blocks wheel scrolling; the decorative blobs are
  // position:fixed and need no clipping. Verified in a real browser with wheel events (scratch test).
  test('.auth-page sets no overflow hidden/clip', () => {
    const css = require('fs').readFileSync(require('path').join(__dirname, '../public/css/style.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');   // Kommentare raus — sonst findet die Wache die eigene Erklaerung
    const rule = css.match(/\.auth-page\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule[1]).not.toMatch(/overflow(-[xy])?\s*:\s*(hidden|clip)/);
  });
});

describe('KeT brand shown as the logo everywhere (Betreiber 02./03.10.: sidebar variant B, small logo instead of "KeT")', () => {
  const request = require('supertest');
  const fsx = require('fs');
  const pathx = require('path');

  test('public pages: logo instead of the "KeT" tile and instead of "by KeT", screen readers still read "KeT"', async () => {
    for (const url of ['/auth/login', '/auth/register', '/auth/forgot-password', '/terms']) {
      const html = (await request(app).get(url)).text;
      expect(html).toMatch(/<img[^>]*class="auth-brand__logo"[^>]*alt=""/);              // grosses Zeichen, schmueckend
      expect(html).toMatch(/Glovebox-Monitoring by <img[^>]*class="brand-logo"[^>]*alt="KeT"/);
      expect(html).not.toMatch(/auth-brand__mark/);
      expect(html.replace(/<title>[\s\S]*?<\/title>/g, '')).not.toMatch(/Glovebox-Monitoring by KeT/);   // Tab-Titel bleibt Text
    }
  });

  test('both logo files are served as images', async () => {
    for (const f of ['/img/ket-logo.webp', '/img/ket-logo-full.webp']) {
      const res = await request(app).get(f);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/webp');
    }
  });

  test('no view writes "by KeT" as text any more (one partial renders the brand)', () => {
    const dir = pathx.join(__dirname, '../views');
    const offenders = [];
    const walk = d => fsx.readdirSync(d, { withFileTypes: true }).forEach(e => {
      const p = pathx.join(d, e.name);
      if (e.isDirectory()) return walk(p);
      // sichtbare Wortmarke als Text — nicht Tab-Titel, Alt-Texte, Kommentare oder der Firmenname im Satz (AGB)
      const src = fsx.readFileSync(p, 'utf8').replace(/<title>[\s\S]*?<\/title>/g, '').replace(/<%#[\s\S]*?%>/g, '').replace(/alt="[^"]*"/g, '');
      if (/Glovebox-Monitoring by KeT|auth-brand__mark|logo-sub/.test(src)) offenders.push(pathx.relative(dir, p));
    });
    walk(dir);
    expect(offenders).toEqual([]);
  });
});
