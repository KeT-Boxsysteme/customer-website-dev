/**
 * Anmeldung bleibt, solange ein Geraet sie nutzt (Betreiber 24.10.2026: "Sensor einmal zuweisen, dann muss das
 * laufen, und zwar immer"; abgemeldet erst nach 24 h OHNE Nutzung). Vorher lief das Cookie fest 24 h nach dem
 * Login ab — auch wenn der Pi/das Tablet alle 5 s sendete.
 */
jest.mock('../config/database', () => ({
  getPool: jest.fn(), closePool: jest.fn().mockResolvedValue(undefined), sql: {}
}));
jest.mock('../services/email', () => ({}));
jest.mock('../models/user');
jest.mock('../models/box');
jest.mock('../models/company');

const app = require('../server');
const User = require('../models/user');
const Box = require('../models/box');
const { loginAgent } = require('./helpers/login');

const DAY_MS = 24 * 60 * 60 * 1000;
const sessionCookie = res => (res.headers['set-cookie'] || []).find(c => c.startsWith('connect.sid='));
const expiresOf = cookie => new Date(/Expires=([^;]+)/.exec(cookie)[1]).getTime();

test('every request of a logged-in device renews the login for another 24 h', async () => {
  const agent = await loginAgent(app, User, 'user');
  Box.findAllByCompany.mockResolvedValue([]);
  const res = await agent.get('/monitoring/sensors');   // so fragt der Hintergrund-Verbinder
  expect(res.status).toBe(200);
  const cookie = sessionCookie(res);
  expect(cookie).toBeDefined();
  // Ablauf = jetzt + 24 h (nicht Login + 24 h); 1 Minute Toleranz fuer die Testdauer
  expect(Math.abs(expiresOf(cookie) - (Date.now() + DAY_MS))).toBeLessThan(60 * 1000);
});

test('the idle limit stays 24 h (no longer lifetime than decided)', async () => {
  const agent = await loginAgent(app, User, 'user');
  Box.findAllByCompany.mockResolvedValue([]);
  const cookie = sessionCookie(await agent.get('/monitoring/sensors'));
  expect(expiresOf(cookie) - Date.now()).toBeLessThanOrEqual(DAY_MS + 1000);
});

