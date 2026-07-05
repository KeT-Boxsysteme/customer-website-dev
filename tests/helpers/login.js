/**
 * Test helper: log in via the real /auth/login route and return a supertest
 * agent that carries the session cookie.
 *
 * Usage (in a test file):
 *   jest.mock('../models/user');               // auto-mock
 *   const User = require('../models/user');
 *   const { loginAgent } = require('./helpers/login');
 *   const agent = await loginAgent(app, User, 'admin');
 *
 * routes/auth.js compares the password via User.verifyPassword(plain, hash)
 * (bcryptjs under the hood), so we generate a real bcrypt hash — with a cheap
 * cost factor (4) to keep the suite fast — and wire verifyPassword back to
 * bcryptjs.compare so the genuine comparison code path is exercised.
 */
const bcrypt = require('bcryptjs');
const request = require('supertest');

const TEST_PASSWORD = 'correct-horse-battery';
const COMPANY_ID = 7;
const USER_ID = 42;

let cachedHash = null;
async function passwordHash() {
  if (!cachedHash) cachedHash = await bcrypt.hash(TEST_PASSWORD, 4);
  return cachedHash;
}

/** DB-row-shaped user (snake_case, like the users table). */
function buildDbUser(role, overrides = {}) {
  return {
    id: USER_ID,
    company_id: COMPANY_ID,
    firstname: 'Testa',
    lastname: 'Tester',
    email: `${role}@example.com`,
    phone: null,
    username: 'TSTU',
    department: 'management',
    role,
    is_active: 1,
    ...overrides
  };
}

/**
 * Returns a supertest agent logged in as the given role
 * ('admin' | 'controller' | 'user' | 'box_user').
 */
async function loginAgent(app, User, role, overrides = {}) {
  const hash = await passwordHash();
  const user = buildDbUser(role, { password_hash: hash, ...overrides });

  User.findByEmail.mockResolvedValueOnce(user);
  User.verifyPassword.mockImplementation((plain, h) => bcrypt.compare(plain, h));

  const agent = request.agent(app);
  const res = await agent
    .post('/auth/login')
    .type('form')
    .send({ email: user.email, password: TEST_PASSWORD });

  if (res.status !== 302 || res.headers.location !== '/dashboard') {
    throw new Error(
      `Test login failed for role "${role}": ${res.status} -> ${res.headers.location}`
    );
  }
  return agent;
}

module.exports = { loginAgent, buildDbUser, passwordHash, TEST_PASSWORD, COMPANY_ID, USER_ID };
