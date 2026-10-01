/**
 * Auth flows: login/logout, registration (incl. validation), terms page,
 * forgot-password (no email enumeration). Konzept.txt lines 29–44.
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
jest.mock('../models/passwordReset');

const bcrypt = require('bcryptjs');
const request = require('supertest');
const app = require('../server');
const User = require('../models/user');
const Company = require('../models/company');
const emailService = require('../services/email');
const PasswordReset = require('../models/passwordReset');
const { hashToken } = require('../services/resetToken');
const { loginAgent, buildDbUser, passwordHash, TEST_PASSWORD, ACCESS_CODE } = require('./helpers/login');
const sessionGuard = require('../middleware/auth');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Login', () => {
  test('successful login sets a session and redirects to /dashboard', async () => {
    const agent = await loginAgent(app, User, 'admin'); // asserts the 302 -> /dashboard itself
    const res = await agent.get('/dashboard');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Glovebox-Monitoring by KeT');
    expect(res.text).toContain('Testa'); // session user rendered on the landing page
  });

  test('wrong password redirects back to login without a session', async () => {
    const hash = await passwordHash();
    User.findByEmail.mockResolvedValueOnce(buildDbUser('admin', { password_hash: hash }));
    User.verifyPassword.mockImplementation((plain, h) => bcrypt.compare(plain, h));

    const agent = request.agent(app);
    const res = await agent
      .post('/auth/login')
      .type('form')
      .send({ email: 'admin@example.com', password: 'wrong-password' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/auth/login');

    // Flash message shown on the login page, session NOT established
    const loginPage = await agent.get('/auth/login');
    expect(loginPage.text).toContain('Invalid email, password or access number.');
    const dash = await agent.get('/dashboard');
    expect(dash.status).toBe(302);
    expect(dash.headers.location).toBe('/auth/login');
  });

  test('unknown email redirects back to login with the same generic error', async () => {
    User.findByEmail.mockResolvedValueOnce(null);
    const res = await request(app)
      .post('/auth/login')
      .type('form')
      .send({ email: 'nobody@example.com', password: 'whatever' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/auth/login');
    expect(User.verifyPassword).not.toHaveBeenCalled();
  });

  test('missing credentials redirect back to login', async () => {
    const res = await request(app).post('/auth/login').type('form').send({ email: '' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/auth/login');
    expect(User.findByEmail).not.toHaveBeenCalled();
  });
});

describe('Registration', () => {
  const validBody = {
    companyType: 'company',
    companyName: 'ACME Labs',
    city: 'Berlin',
    street: 'Main Street',
    housenumber: '12a',
    zip: '10115',
    firstname: 'Jane',
    lastname: 'Doe',
    email: 'Jane.Doe@Example.com',
    phone: ' +49 123 456 ',
    username: 'jd',
    department: 'management',
    departmentOther: '',
    password: 'Secret#2026',
    passwordConfirm: 'Secret#2026',
    agb: 'on'
  };

  test('happy path: creates company + admin user, sends welcome + KeT mails', async () => {
    User.findByEmail.mockResolvedValueOnce(null);
    Company.create.mockResolvedValueOnce(123);
    User.create.mockResolvedValueOnce(5);

    const res = await request(app).post('/auth/register').type('form').send(validBody);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/auth/login');

    expect(Company.create).toHaveBeenCalledWith({
      name: 'ACME Labs',
      type: 'company',
      city: 'Berlin',
      street: 'Main Street',
      housenumber: '12a',
      zip: '10115'
    });

    // First registered user becomes the company admin (Konzept line 59)
    expect(User.create).toHaveBeenCalledWith({
      companyId: 123,
      firstname: 'Jane',
      lastname: 'Doe',
      email: 'jane.doe@example.com',
      phone: '+49 123 456',
      username: 'JD',
      department: 'management',
      role: 'admin',
      password: 'Secret#2026'
    });

    // Welcome mail to the customer + notification to KeT (Konzept line 38)
    expect(emailService.sendWelcomeEmail).toHaveBeenCalledWith(validBody.email, 'ACME Labs');
    expect(emailService.sendNewRegistrationToKeT).toHaveBeenCalledWith(
      'ACME Labs', 'company', validBody.email
    );
  });

  test('rejects when passwords do not match', async () => {
    const res = await request(app)
      .post('/auth/register')
      .type('form')
      .send({ ...validBody, passwordConfirm: 'different' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/auth/register');
    expect(Company.create).not.toHaveBeenCalled();
    expect(User.create).not.toHaveBeenCalled();
  });

  test('rejects username longer than 4 characters', async () => {
    const res = await request(app)
      .post('/auth/register')
      .type('form')
      .send({ ...validBody, username: 'ABCDE' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/auth/register');
    expect(User.create).not.toHaveBeenCalled();
  });

  test('rejects when a required field is missing entirely (no TypeError)', async () => {
    const { username, ...withoutUsername } = validBody;
    const res = await request(app)
      .post('/auth/register')
      .type('form')
      .send(withoutUsername);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/auth/register');
    expect(Company.create).not.toHaveBeenCalled();
    expect(User.create).not.toHaveBeenCalled();
  });

  test('rejects department "other" with empty free text', async () => {
    const res = await request(app)
      .post('/auth/register')
      .type('form')
      .send({ ...validBody, department: 'other', departmentOther: '   ' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/auth/register');
    expect(User.create).not.toHaveBeenCalled();
  });

  test('rejects without accepted terms (agb)', async () => {
    const { agb, ...withoutAgb } = validBody;
    const res = await request(app).post('/auth/register').type('form').send(withoutAgb);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/auth/register');
    expect(User.create).not.toHaveBeenCalled();
  });

  test('rejects duplicate email', async () => {
    User.findByEmail.mockResolvedValueOnce(buildDbUser('admin', { password_hash: 'x' }));
    const res = await request(app).post('/auth/register').type('form').send(validBody);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/auth/register');
    expect(Company.create).not.toHaveBeenCalled();
  });
});

describe('Terms page', () => {
  test('GET /terms is public and shows the brand name', async () => {
    const res = await request(app).get('/terms');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Glovebox-Monitoring by KeT');
    expect(res.text).toContain('Terms');
  });
});

describe('Forgot password', () => {
  test('existing email: sends reset mail and redirects with generic message', async () => {
    const user = buildDbUser('admin', { password_hash: 'x' });
    User.findByEmail.mockResolvedValueOnce(user);

    const agent = request.agent(app);
    const res = await agent
      .post('/auth/forgot-password')
      .type('form')
      .send({ email: 'Admin@Example.com ' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/auth/login');
    expect(User.findByEmail).toHaveBeenCalledWith('admin@example.com');
    expect(emailService.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    expect(emailService.sendPasswordResetEmail).toHaveBeenCalledWith(
      user.email, expect.stringMatching(/^[0-9a-f]{64}$/)
    );

    const loginPage = await agent.get('/auth/login');
    expect(loginPage.text).toContain('If an account exists for that email');
  });

  test('unknown email: same response, no mail sent (no enumeration)', async () => {
    User.findByEmail.mockResolvedValueOnce(null);

    const agent = request.agent(app);
    const res = await agent
      .post('/auth/forgot-password')
      .type('form')
      .send({ email: 'nobody@example.com' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/auth/login'); // identical to the existing-email case
    expect(emailService.sendPasswordResetEmail).not.toHaveBeenCalled();

    const loginPage = await agent.get('/auth/login');
    expect(loginPage.text).toContain('If an account exists for that email');
  });

  test('invalid reset token redirects back to forgot-password', async () => {
    const res = await request(app).get('/auth/reset-password/deadbeef');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/auth/forgot-password');
  });
});

describe('Logout', () => {
  test('destroys the session and redirects to login', async () => {
    const agent = await loginAgent(app, User, 'user');

    const res = await agent.get('/auth/logout');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/auth/login');

    const dash = await agent.get('/dashboard');
    expect(dash.status).toBe(302);
    expect(dash.headers.location).toBe('/auth/login');
  });
});

describe('Login with access number (Freischaltung, KET\AUFTRAG section 3)', () => {
  const tryLogin = async (dbUser, body) => {
    const hash = await passwordHash();
    User.findByEmail.mockReset();   // ein gesperrter Versuch fragt die DB nicht — nichts darf liegen bleiben
    User.findByEmail.mockResolvedValueOnce(dbUser && { ...dbUser, password_hash: hash });
    User.verifyPassword.mockImplementation((plain, h) => bcrypt.compare(plain, h));
    const agent = request.agent(app);
    const res = await agent.post('/auth/login').type('form').send(body);
    const page = await agent.get('/auth/login');
    return { res, page };
  };
  const body = (o = {}) => ({ email: 'admin@example.com', password: TEST_PASSWORD, accessCode: ACCESS_CODE, ...o });

  test('correct password + number of the own active company -> logged in', async () => {
    const { res } = await tryLogin(buildDbUser('admin'), body());
    expect(res.headers.location).toBe('/dashboard');
  });

  test('missing or wrong number -> not logged in, generic message', async () => {
    for (const accessCode of ['', '999999', '12345']) {
      const { res, page } = await tryLogin(buildDbUser('admin'), body({ accessCode }));
      expect(res.headers.location).toBe('/auth/login');
      expect(page.text).toContain('Invalid email, password or access number.');
    }
  });

  test('pending registration -> told that approval is pending (only with correct password)', async () => {
    const pending = buildDbUser('admin', { company_status: 'pending', company_access_code: null });
    const ok = await tryLogin(pending, body({ accessCode: '' }));
    expect(ok.res.headers.location).toBe('/auth/login');
    expect(ok.page.text).toContain('awaiting approval');
    const wrongPw = await tryLogin(pending, body({ accessCode: '', password: 'nope' }));
    expect(wrongPw.page.text).not.toContain('awaiting approval');
  });

  test('suspended company -> no login, message names KeT', async () => {
    const { res, page } = await tryLogin(buildDbUser('admin', { company_status: 'suspended' }), body());
    expect(res.headers.location).toBe('/auth/login');
    expect(page.text).toContain('suspended');
  });

  test('after 5 failed attempts the account is blocked, even with correct data', async () => {
    const email = 'blocked@example.com';
    for (let i = 0; i < 5; i++) await tryLogin(buildDbUser('admin', { email }), body({ email, accessCode: '111111' }));
    const { res, page } = await tryLogin(buildDbUser('admin', { email }), body({ email }));
    expect(res.headers.location).toBe('/auth/login');
    expect(page.text).toContain('Too many failed attempts');
  });
});

describe('running sessions end when access ends (section 3)', () => {
  test('company suspended after login -> next request goes to login', async () => {
    const agent = await loginAgent(app, User, 'admin');
    expect((await agent.get('/dashboard')).status).toBe(200);
    User.sessionState.mockResolvedValue({ is_active: 1, company_status: 'suspended', company_access_code: ACCESS_CODE });
    sessionGuard.clearCache();
    const res = await agent.get('/dashboard');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/auth/login');
  });

  test('new access number generated -> old sessions end', async () => {
    const agent = await loginAgent(app, User, 'admin');
    User.sessionState.mockResolvedValue({ is_active: 1, company_status: 'active', company_access_code: '555555' });
    sessionGuard.clearCache();
    expect((await agent.get('/dashboard')).headers.location).toBe('/auth/login');
  });

  test('DB not reachable during the check -> session is NOT ended (a hiccup is no verdict)', async () => {
    const agent = await loginAgent(app, User, 'admin');
    User.sessionState.mockRejectedValue(new Error('db down'));
    sessionGuard.clearCache();
    expect((await agent.get('/dashboard')).status).toBe(200);
  });
});

describe('registration waits for approval (section 3)', () => {
  test('success message says approval is pending, not "please log in"', async () => {
    [User.findByEmail, Company.create, User.create].forEach(m => m.mockReset());   // keine Reste anderer Tests
    User.findByEmail.mockResolvedValueOnce(null);
    Company.create.mockResolvedValueOnce(99);
    User.create.mockResolvedValueOnce(1);
    const agent = request.agent(app);
    const res = await agent.post('/auth/register').type('form').send({
      companyType: 'company', companyName: 'Neu GmbH', city: 'X', street: 'Y', housenumber: '1', zip: '12345',
      firstname: 'A', lastname: 'B', email: 'neu@example.com', username: 'NEU', department: 'management',
      password: 'Secret123!', passwordConfirm: 'Secret123!', agb: 'on'
    });
    expect(res.headers.location).toBe('/auth/login');
    const page = await agent.get('/auth/login');
    expect(page.text).toContain('KeT will review your registration');
    expect(page.text).not.toContain('Registration successful! Please log in.');
  });
});

describe('login page has the access number field', () => {
  test('field accessCode, numeric', async () => {
    const res = await request(app).get('/auth/login');
    expect(res.text).toMatch(/<input[^>]*name="accessCode"[^>]*inputmode="numeric"/);
  });
});

describe('password reset survives restarts (tokens in the DB, Fund: in-memory map lost on every deploy)', () => {
  test('forgot-password stores only the SHA-256 hash of the mailed token, valid for 1 hour', async () => {
    User.findByEmail.mockReset();
    User.findByEmail.mockResolvedValueOnce(buildDbUser('admin', { id: 42 }));
    const before = Date.now();
    await request(app).post('/auth/forgot-password').type('form').send({ email: 'admin@example.com' });
    const mailedToken = emailService.sendPasswordResetEmail.mock.calls[0][1];
    expect(PasswordReset.create).toHaveBeenCalledTimes(1);
    const [userId, storedHash, expiresAt] = PasswordReset.create.mock.calls[0];
    expect(userId).toBe(42);
    expect(storedHash).toBe(hashToken(mailedToken));
    expect(storedHash).not.toBe(mailedToken);
    expect(expiresAt.getTime() - before).toBeGreaterThanOrEqual(3600000 - 1000);
    expect(expiresAt.getTime() - before).toBeLessThanOrEqual(3600000 + 5000);
  });

  test('a valid link (found in the DB) shows the form', async () => {
    PasswordReset.findValidUserId.mockResolvedValueOnce(42);
    const res = await request(app).get('/auth/reset-password/' + 'a'.repeat(64));
    expect(res.status).toBe(200);
    expect(PasswordReset.findValidUserId).toHaveBeenCalledWith(hashToken('a'.repeat(64)), expect.any(Date));
  });

  test('setting the password consumes the token once and updates exactly that user', async () => {
    PasswordReset.consume.mockResolvedValueOnce(42);
    const res = await request(app).post('/auth/reset-password/' + 'b'.repeat(64)).type('form')
      .send({ password: 'NewSecret123!', passwordConfirm: 'NewSecret123!' });
    expect(res.headers.location).toBe('/auth/login');
    expect(PasswordReset.consume).toHaveBeenCalledWith(hashToken('b'.repeat(64)), expect.any(Date));
    expect(User.updatePassword).toHaveBeenCalledWith(42, 'NewSecret123!');
  });

  test('used / expired / unknown token -> no password change', async () => {
    PasswordReset.consume.mockResolvedValueOnce(null);
    const res = await request(app).post('/auth/reset-password/' + 'c'.repeat(64)).type('form')
      .send({ password: 'NewSecret123!', passwordConfirm: 'NewSecret123!' });
    expect(res.headers.location).toBe('/auth/forgot-password');
    expect(User.updatePassword).not.toHaveBeenCalled();
  });

  test('mismatching passwords do not burn the token', async () => {
    PasswordReset.findValidUserId.mockResolvedValueOnce(42);
    await request(app).post('/auth/reset-password/' + 'd'.repeat(64)).type('form')
      .send({ password: 'NewSecret123!', passwordConfirm: 'other' });
    expect(PasswordReset.consume).not.toHaveBeenCalled();
    expect(User.updatePassword).not.toHaveBeenCalled();
  });
});

describe('password rule at every place a person sets a password (Betreiber 01.10.)', () => {
  test('registration with a weak password -> rejected, nothing created', async () => {
    [User.findByEmail, Company.create, User.create].forEach(m => m.mockReset());
    User.findByEmail.mockResolvedValue(null);
    const agent = request.agent(app);
    const res = await agent.post('/auth/register').type('form').send({
      companyType: 'company', companyName: 'X', city: 'X', street: 'Y', housenumber: '1', zip: '1',
      firstname: 'A', lastname: 'B', email: 'weak@example.com', username: 'WK', department: 'management',
      password: 'secret123', passwordConfirm: 'secret123', agb: 'on'
    });
    expect(res.headers.location).toBe('/auth/register');
    expect(Company.create).not.toHaveBeenCalled();
    expect((await agent.get('/auth/register')).text).toContain('at least 10 characters');
  });

  test('reset with a weak password -> rejected, link NOT used up', async () => {
    PasswordReset.findValidUserId.mockResolvedValueOnce(42);
    await request(app).post('/auth/reset-password/' + 'e'.repeat(64)).type('form')
      .send({ password: 'short', passwordConfirm: 'short' });
    expect(PasswordReset.consume).not.toHaveBeenCalled();
    expect(User.updatePassword).not.toHaveBeenCalled();
  });
});

describe('forgot-password is rate limited (Betreiber 01.10.: 3 per email, 10 per IP per hour)', () => {
  test('4th request for the same email in an hour sends no mail, same neutral answer', async () => {
    const email = 'flood@example.com';
    User.findByEmail.mockReset();
    User.findByEmail.mockResolvedValue(buildDbUser('admin', { email }));
    emailService.sendPasswordResetEmail.mockClear();
    const answers = [];
    for (let i = 0; i < 4; i++) {
      const agent = request.agent(app);
      const res = await agent.post('/auth/forgot-password').type('form').send({ email });
      answers.push(res.headers.location);
      expect((await agent.get('/auth/login')).text).toContain('If an account exists for that email');
    }
    expect(emailService.sendPasswordResetEmail).toHaveBeenCalledTimes(3);
    expect(new Set(answers)).toEqual(new Set(['/auth/login']));
    User.findByEmail.mockReset();
  });
});

describe('forms name the password rule before submitting', () => {
  test('register and reset pages show the rule and require 10 characters', async () => {
    PasswordReset.findValidUserId.mockResolvedValueOnce(42);
    for (const page of [await request(app).get('/auth/register'), await request(app).get('/auth/reset-password/' + 'f'.repeat(64))]) {
      expect(page.text).toContain('At least 10 characters, with an upper case letter');
      expect(page.text).toMatch(/name="password"[^>]*minlength="10"/);
    }
  });
});
