/**
 * Internal endpoints for KeT Management (KET\AUFTRAG 7.9/7.10, agreed with the KET session 2026-10-01):
 *   POST /internal/companies/:id/activated | /code-changed | /service-password
 * Header X-KeT-Secret, no access number in the body, repeatable without duplicate mail or user.
 */
jest.mock('../config/database', () => ({
  getPool: jest.fn().mockRejectedValue(new Error('DB access not allowed in tests')),
  closePool: jest.fn().mockResolvedValue(undefined),
  sql: {}
}));
jest.mock('../services/email', () => ({ sendAccessCodeEmail: jest.fn().mockResolvedValue(undefined), escapeHtml: s => s }));
jest.mock('../models/user');
jest.mock('../models/company');

const SECRET = 'x'.repeat(40);
process.env.KET_API_SECRET = SECRET;

const request = require('supertest');
const app = require('../server');
const User = require('../models/user');
const Company = require('../models/company');
const emailService = require('../services/email');

const active = (o = {}) => ({ id: 17, name: 'Labor GmbH', status: 'active', access_code: '482913', notified_code: null, ...o });
const post = (path, secret = SECRET) => {
  const r = request(app).post(path);
  return secret ? r.set('X-KeT-Secret', secret) : r;
};

beforeEach(() => {
  jest.clearAllMocks();
  Company.findById.mockResolvedValue(active());
  Company.claimNotification.mockResolvedValue(true);
  Company.releaseNotification.mockResolvedValue(undefined);
  User.ensureServiceUser.mockResolvedValue('created');
  User.findAdminEmailsByCompany.mockResolvedValue(['chef@labor.de']);
  User.findServiceUser.mockResolvedValue({ id: 99, email: 'service-17@ketbox.de', is_active: 1 });
  User.updatePassword.mockResolvedValue(undefined);
  emailService.sendAccessCodeEmail.mockResolvedValue(undefined);
});

describe('secret', () => {
  test('missing or wrong secret -> 401, nothing happens', async () => {
    for (const s of [null, 'wrong', SECRET + 'x']) {
      const res = await post('/internal/companies/17/activated', s);
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ ok: false, error: 'unauthorized' });
    }
    expect(Company.findById).not.toHaveBeenCalled();
  });
});

describe('POST /internal/companies/:id/activated', () => {
  test('creates the service user and mails the number to the admins', async () => {
    const res = await post('/internal/companies/17/activated');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, mailSent: true, serviceUser: 'created' });
    expect(User.ensureServiceUser).toHaveBeenCalledWith(17, 'service-17@ketbox.de', expect.any(String));
    expect(Company.claimNotification).toHaveBeenCalledWith(17, '482913');
    expect(emailService.sendAccessCodeEmail).toHaveBeenCalledWith(['chef@labor.de'], 'Labor GmbH', '482913', { isNewCode: false });
  });

  test('repeated call: no second mail, no second user', async () => {
    Company.claimNotification.mockResolvedValue(false);   // Mail fuer diese Nummer ist schon raus
    User.ensureServiceUser.mockResolvedValue('exists');
    const res = await post('/internal/companies/17/activated');
    expect(res.body).toEqual({ ok: true, mailSent: false, alreadyNotified: true, serviceUser: 'exists' });
    expect(emailService.sendAccessCodeEmail).not.toHaveBeenCalled();
  });

  test('mail fails -> 502 mail_failed and the claim is released (retry will send)', async () => {
    emailService.sendAccessCodeEmail.mockRejectedValue(new Error('smtp down'));
    const res = await post('/internal/companies/17/activated');
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ ok: false, error: 'mail_failed', serviceUser: 'created' });
    expect(Company.releaseNotification).toHaveBeenCalledWith(17, '482913');
  });

  test('not active / no number / unknown company -> stable error codes', async () => {
    Company.findById.mockResolvedValueOnce(active({ status: 'pending' }));
    expect((await post('/internal/companies/17/activated')).body).toEqual({ ok: false, error: 'not_active' });
    Company.findById.mockResolvedValueOnce(active({ access_code: null }));
    expect((await post('/internal/companies/17/activated')).body).toEqual({ ok: false, error: 'no_access_code' });
    Company.findById.mockResolvedValueOnce(null);
    const res = await post('/internal/companies/17/activated');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ ok: false, error: 'not_found' });
    expect(emailService.sendAccessCodeEmail).not.toHaveBeenCalled();
  });

  test('no admin to mail -> mailSent false with reason, claim released', async () => {
    User.findAdminEmailsByCompany.mockResolvedValue([]);
    const res = await post('/internal/companies/17/activated');
    expect(res.body).toEqual({ ok: true, mailSent: false, reason: 'no_admin_user', serviceUser: 'created' });
    expect(Company.releaseNotification).toHaveBeenCalledWith(17, '482913');
  });

  test('invalid id -> 400', async () => {
    expect((await post('/internal/companies/abc/activated')).status).toBe(400);
  });
});

describe('POST /internal/companies/:id/code-changed', () => {
  test('mails the NEW number with the "new number" wording', async () => {
    Company.findById.mockResolvedValue(active({ access_code: '777123', notified_code: '482913' }));
    const res = await post('/internal/companies/17/code-changed');
    expect(res.body.mailSent).toBe(true);
    expect(emailService.sendAccessCodeEmail).toHaveBeenCalledWith(['chef@labor.de'], 'Labor GmbH', '777123', { isNewCode: true });
  });
});

describe('POST /internal/companies/:id/service-password', () => {
  test('new random password, returned once, only the hash is stored', async () => {
    const a = await post('/internal/companies/17/service-password');
    const b = await post('/internal/companies/17/service-password');
    expect(a.body.ok).toBe(true);
    expect(a.body.login).toBe('service-17@ketbox.de');
    expect(a.body.password).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(a.body.password).not.toBe(b.body.password);
    expect(User.updatePassword).toHaveBeenCalledWith(99, a.body.password);   // Modell speichert nur den Hash
  });

  test('only for active companies', async () => {
    Company.findById.mockResolvedValue(active({ status: 'suspended' }));
    expect((await post('/internal/companies/17/service-password')).body).toEqual({ ok: false, error: 'not_active' });
    expect(User.updatePassword).not.toHaveBeenCalled();
  });
});

describe('not configured', () => {
  test('without KET_API_SECRET the endpoints are closed (503), never open', async () => {
    const saved = process.env.KET_API_SECRET;
    delete process.env.KET_API_SECRET;
    const res = await post('/internal/companies/17/activated', 'anything');
    process.env.KET_API_SECRET = saved;
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ok: false, error: 'not_configured' });
  });
});

describe('POST /internal/companies/:id/delete (Betreiber 01.10.: delete website data, nothing in KET)', () => {
  const counts = { password_resets: 1, alert_acks: 2, measurements: 30, measurements_detached: 0, alert_acks_detached: 0, sensor_readings: 400, boxes: 2, sessions: 3, users: 4, companies: 1 };

  test('without secret -> 401, nothing deleted', async () => {
    const res = await post('/internal/companies/17/delete', null);
    expect(res.status).toBe(401);
    expect(Company.deleteCompletely).not.toHaveBeenCalled();
  });

  test('suspended company -> deleted, counts returned, no mail', async () => {
    Company.deleteCompletely.mockResolvedValue({ result: 'deleted', counts });
    const res = await post('/internal/companies/17/delete');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, deleted: counts });
    expect(Company.deleteCompletely).toHaveBeenCalledWith(17);
    expect(emailService.sendAccessCodeEmail).not.toHaveBeenCalled();
  });

  test('active company -> 409 is_active (suspend first), checked inside the delete transaction', async () => {
    Company.deleteCompletely.mockResolvedValue({ result: 'is_active' });
    const res = await post('/internal/companies/17/delete');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ ok: false, error: 'is_active' });
  });

  test('already gone -> 404 not_found (KET treats it as already deleted)', async () => {
    Company.deleteCompletely.mockResolvedValue({ result: 'not_found' });
    const res = await post('/internal/companies/17/delete');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ ok: false, error: 'not_found' });
  });

  test('invalid id -> 400', async () => {
    const res = await post('/internal/companies/abc/delete');
    expect(res.status).toBe(400);
    expect(Company.deleteCompletely).not.toHaveBeenCalled();
  });
});
