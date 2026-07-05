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
