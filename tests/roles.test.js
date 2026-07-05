/**
 * Access matrix per Konzept.txt (lines 60–64):
 *   admin      – unrestricted
 *   controller – everything except user management
 *   user       – monitoring + diagrams only
 *   box_user   – monitoring + diagrams only (kiosk/tablet role)
 */
jest.mock('../config/database', () => ({
  getPool: jest.fn().mockRejectedValue(new Error('DB access not allowed in tests')),
  closePool: jest.fn().mockResolvedValue(undefined),
  sql: {}
}));
jest.mock('../services/email', () => ({
  sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
  sendNewRegistrationToKeT: jest.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
  sendUserCreatedEmail: jest.fn().mockResolvedValue(undefined),
  sendContactMessage: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../models/user');
jest.mock('../models/box');
jest.mock('../models/company');
jest.mock('../models/measurement');
jest.mock('../models/alertAck');

const request = require('supertest');
const app = require('../server');
const User = require('../models/user');
const Box = require('../models/box');
const { loginAgent, COMPANY_ID } = require('./helpers/login');

beforeEach(() => {
  jest.clearAllMocks();
  User.findAllByCompany.mockResolvedValue([]);
  User.getUsernamesByCompany.mockResolvedValue([]);
  Box.findAllByCompany.mockResolvedValue([]);
});

const ROLES = ['admin', 'controller', 'user', 'box_user'];

// path → expected status per role
const MATRIX = [
  ['/users',      { admin: 200, controller: 403, user: 403, box_user: 403 }],
  ['/boxes',      { admin: 200, controller: 200, user: 403, box_user: 403 }],
  ['/monitoring', { admin: 200, controller: 200, user: 200, box_user: 200 }],
  ['/diagrams',   { admin: 200, controller: 200, user: 200, box_user: 200 }],
  ['/dashboard',  { admin: 200, controller: 200, user: 200, box_user: 200 }]
];

describe('Role-based access matrix', () => {
  for (const [path, expectations] of MATRIX) {
    for (const role of ROLES) {
      const expected = expectations[role];
      test(`${role} GET ${path} -> ${expected}`, async () => {
        const agent = await loginAgent(app, User, role);
        const res = await agent.get(path);
        expect(res.status).toBe(expected);
        if (expected === 403) {
          // 403 page rendered, no data leaked from the protected route
          expect(res.text).not.toContain('User Management</h');
        }
      });
    }
  }

  test('sub-routes are protected too: controller GET /users/create -> 403', async () => {
    const agent = await loginAgent(app, User, 'controller');
    const res = await agent.get('/users/create');
    expect(res.status).toBe(403);
  });

  test('sub-routes are protected too: user GET /boxes/create -> 403', async () => {
    const agent = await loginAgent(app, User, 'user');
    const res = await agent.get('/boxes/create');
    expect(res.status).toBe(403);
  });

  test('write access follows the same matrix: user POST /boxes -> 403', async () => {
    const agent = await loginAgent(app, User, 'user');
    const res = await agent.post('/boxes').type('form').send({ manufacturer: 'MBraun' });
    expect(res.status).toBe(403);
    expect(Box.create).not.toHaveBeenCalled();
  });
});

describe('Unauthenticated access redirects to /auth/login', () => {
  for (const [path] of MATRIX) {
    test(`GET ${path} unauthenticated -> 302 /auth/login`, async () => {
      const res = await request(app).get(path);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/auth/login');
    });
  }
});

describe('Company scoping', () => {
  test('GET /boxes queries boxes with the companyId from the session', async () => {
    const agent = await loginAgent(app, User, 'admin');
    await agent.get('/boxes');
    expect(Box.findAllByCompany).toHaveBeenCalledWith(COMPANY_ID);
  });

  test('GET /users queries users with the companyId from the session', async () => {
    const agent = await loginAgent(app, User, 'admin');
    await agent.get('/users');
    expect(User.findAllByCompany).toHaveBeenCalledWith(COMPANY_ID);
  });
});
