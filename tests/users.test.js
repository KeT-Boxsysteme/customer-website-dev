/**
 * User management (routes/users.js): own company only, role whitelist, internal "service" user
 * visible but not changeable by customers (KET\AUFTRAG 7.10, 7.13), access number for the admin (7.3).
 * Fund 01.10.: PUT/DELETE /users/:id did not check the company and accepted any role value.
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
  sendContactMessage: jest.fn().mockResolvedValue(undefined),
  sendAccessCodeEmail: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../models/user');
jest.mock('../models/box');
jest.mock('../models/company');
jest.mock('../models/measurement');
jest.mock('../models/alertAck');

const app = require('../server');
const User = require('../models/user');
const Company = require('../models/company');
const emailService = require('../services/email');
const { loginAgent, COMPANY_ID, ACCESS_CODE } = require('./helpers/login');

const OTHER = 77;   // a user id
const form = (o = {}) => ({ firstname: 'A', lastname: 'B', email: 'a@b.de', username: 'AB', department: 'lab', role: 'user', ...o });

let agent;
beforeEach(async () => {
  jest.clearAllMocks();
  User.findAllByCompany.mockResolvedValue([]);
  User.update.mockResolvedValue(1);
  User.softDelete.mockResolvedValue(1);
  User.create.mockResolvedValue(5);
  Company.findById.mockResolvedValue({ id: COMPANY_ID, name: 'Test GmbH', access_code: ACCESS_CODE, status: 'active' });
  agent = await loginAgent(app, User, 'admin');
});

describe('own company only (the lock sits in the query)', () => {
  test('update and delete pass the session company to the model', async () => {
    User.findById.mockResolvedValue({ id: OTHER, company_id: COMPANY_ID, role: 'user' });
    await agent.put(`/users/${OTHER}`).type('form').send(form());
    expect(User.update).toHaveBeenCalledWith(OTHER, COMPANY_ID, expect.any(Object));
    await agent.delete(`/users/${OTHER}`);
    expect(User.softDelete).toHaveBeenCalledWith(OTHER, COMPANY_ID);
  });

  test('user of another company -> 404, nothing written', async () => {
    User.findById.mockResolvedValue({ id: OTHER, company_id: 999, role: 'user' });
    expect((await agent.put(`/users/${OTHER}`).type('form').send(form())).status).toBe(404);
    expect((await agent.delete(`/users/${OTHER}`)).status).toBe(404);
    expect(User.update).not.toHaveBeenCalled();
    expect(User.softDelete).not.toHaveBeenCalled();
  });
});

describe('role whitelist (service is internal, 7.10)', () => {
  test('creating or editing with role "service" or an unknown role is rejected', async () => {
    for (const role of ['service', 'superadmin']) {
      await agent.post('/users').type('form').send({ ...form({ role }), password: 'Secret123!' });
      expect(User.create).not.toHaveBeenCalled();
    }
    User.findById.mockResolvedValue({ id: OTHER, company_id: COMPANY_ID, role: 'user' });
    await agent.put(`/users/${OTHER}`).type('form').send(form({ role: 'service' }));
    expect(User.update).not.toHaveBeenCalled();
  });

  test('a customer role is accepted', async () => {
    await agent.post('/users').type('form').send({ ...form({ role: 'controller' }), password: 'Secret123!' });
    expect(User.create).toHaveBeenCalledWith(expect.objectContaining({ role: 'controller', companyId: COMPANY_ID }));
  });

  test('the role choice in the form does not offer "service"', async () => {
    const page = await agent.get('/users/create');
    expect(page.text).not.toMatch(/<option value="service"/);
  });
});

describe('service user: visible, not changeable by customers (7.13)', () => {
  const service = { id: OTHER, company_id: COMPANY_ID, role: 'service', firstname: 'KeT', lastname: 'Service', email: 'service-7@ketbox.de', username: 'KET' };

  test('listed, but without edit/delete buttons', async () => {
    User.findAllByCompany.mockResolvedValue([service]);
    const page = await agent.get('/users');
    expect(page.text).toContain('service-7@ketbox.de');
    expect(page.text).not.toContain(`/users/${OTHER}/edit`);
    expect(page.text).not.toMatch(new RegExp(`action="/users/${OTHER}\\?_method=DELETE"`));
  });

  test('edit page, update and delete are refused on the server', async () => {
    User.findById.mockResolvedValue(service);
    expect((await agent.get(`/users/${OTHER}/edit`)).status).toBe(403);
    expect((await agent.put(`/users/${OTHER}`).type('form').send(form())).status).toBe(403);
    expect((await agent.delete(`/users/${OTHER}`)).status).toBe(403);
    expect(User.update).not.toHaveBeenCalled();
    expect(User.softDelete).not.toHaveBeenCalled();
  });
});

describe('service role has admin rights (7.10)', () => {
  test('a service user may open user management', async () => {
    const svc = await loginAgent(app, User, 'service');
    expect((await svc.get('/users')).status).toBe(200);
    expect((await svc.get('/boxes')).status).not.toBe(403);
  });
});

describe('access number for the admin (7.3)', () => {
  test('user management offers the number of the own organization — hidden until clicked (Betreiber 01.10.)', async () => {
    const page = await agent.get('/users');
    // nur im Datenattribut des Knopfes, nicht als sichtbarer Text
    expect(page.text).toMatch(new RegExp('<button[^>]*data-access-code="' + ACCESS_CODE + '"[^>]*aria-pressed="false"'));
    const visibleText = page.text.replace(/<[^>]+>/g, ' ');
    expect(visibleText).not.toContain(ACCESS_CODE);
    expect(visibleText).toContain('Show');
  });

  test('the mail to a newly created user carries the number', async () => {
    await agent.post('/users').type('form').send({ ...form(), password: 'Secret123!' });
    expect(emailService.sendUserCreatedEmail).toHaveBeenCalledWith('a@b.de', 'Test GmbH', ACCESS_CODE);
  });
});

describe('password rule when an admin creates a user (Betreiber 01.10.)', () => {
  test('weak password -> not created', async () => {
    await agent.post('/users').type('form').send({ ...form(), password: 'secret123' });
    expect(User.create).not.toHaveBeenCalled();
  });
});
