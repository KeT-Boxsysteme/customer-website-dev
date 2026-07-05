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

const bcrypt = require('bcryptjs');
const request = require('supertest');
const app = require('../server');
const User = require('../models/user');
const Company = require('../models/company');
const emailService = require('../services/email');
const { loginAgent, buildDbUser, passwordHash, TEST_PASSWORD } = require('./helpers/login');

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
    expect(loginPage.text).toContain('Invalid email or password.');
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
    password: 'secret123',
    passwordConfirm: 'secret123',
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
      password: 'secret123'
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
