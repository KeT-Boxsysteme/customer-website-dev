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
