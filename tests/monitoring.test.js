/**
 * Monitoring endpoints: traffic-light detail page, value submission,
 * maintenance resolve, ppm acknowledgements, contact message to KeT
 * (Konzept.txt lines 108–137).
 *
 * config/database is mocked with a tiny fake pool because the route resolves
 * user abbreviations (Kuerzel) with a direct query; mockAbbrevRows controls
 * what that lookup returns. No real DB is ever touched.
 */
let mockAbbrevRows = [];
jest.mock('../config/database', () => ({
  getPool: jest.fn(async () => ({
    request() {
      const req = {
        input() { return req; },
        query: async () => ({ recordset: mockAbbrevRows })
      };
      return req;
    }
  })),
  closePool: jest.fn().mockResolvedValue(undefined),
  sql: { Int: {}, NVarChar: jest.fn(() => ({})) }
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

const app = require('../server');
const User = require('../models/user');
const Box = require('../models/box');
const Measurement = require('../models/measurement');
const AlertAck = require('../models/alertAck');
const emailService = require('../services/email');
const { loginAgent, COMPANY_ID, USER_ID } = require('./helpers/login');

const BOX_ID = 5;

function makeBox(overrides = {}) {
  const fresh = new Date().toISOString();
  return {
    id: BOX_ID,
    company_id: COMPANY_ID,
    manufacturer: 'MBraun',
    project_number: 'P-100',
    box_type: 'Alpha 2000',
    box_alias: 'Lab Box 1',
    has_dual_filter: 1,
    has_solvent_filter: 1,
    solvent_filter_type: 'charcoal',
    charcoal_cycle_months: 6,
    molecular_sieve_cycle_months: null,
    has_solvent_sensor: 0,
    solvent_sensor_calibrated: null,
    has_o2_sensor: 1,
    o2_sensor_calibrated: '2024',
    has_h2o_sensor: 1,
    h2o_sensor_calibrated: '2025',
    last_cleaned: null,
    has_fridge: 1,
    fridge_temp: 4,
    has_oil_pump: 0,
    last_oil_change: null,
    glove_ports: 4,
    usage_type: 'underpressure',
    build_year: 2021,
    additional_notes: null,
    is_active: 1,
    created_at: '2024-01-01T00:00:00Z',
    // all maintenance freshly done unless a test overrides it
    last_h2o_cleaning: fresh,
    last_charcoal_done: fresh,
    last_sieve_done: fresh,
    last_solvent_test: fresh,
    last_oil_done: fresh,
    ...overrides
  };
}

let agent;
beforeEach(async () => {
  jest.clearAllMocks();
  mockAbbrevRows = [];
  Box.findAllByCompany.mockResolvedValue([]);
  Box.findById.mockResolvedValue(makeBox());
  Box.updateMaintenanceDate.mockResolvedValue(undefined);
  User.getUsernamesByCompany.mockResolvedValue(['LAB', 'TSTU']);
  Measurement.findLatestByBox.mockResolvedValue(null);
  Measurement.create.mockResolvedValue(1);
  AlertAck.latestAcks.mockResolvedValue([]);
  AlertAck.insertAck.mockResolvedValue(undefined);
  agent = await loginAgent(app, User, 'user');
});

describe('GET /monitoring/:id', () => {
  test('renders red + yellow alerts from buildAlerts and the red status class', async () => {
    // H2O sensor cleaning overdue (>2000h) + red ppm alert from latest measurement
    Box.findById.mockResolvedValue(makeBox({ last_h2o_cleaning: '2025-01-01T00:00:00Z' }));
    Measurement.findLatestByBox.mockResolvedValue({
      id: 900, box_id: BOX_ID, o2_value: 12, h2o_value: 2, fridge_temp: 4,
      measured_at: new Date().toISOString()
    });

    const res = await agent.get(`/monitoring/${BOX_ID}`);
    expect(res.status).toBe(200);

    // scoped lookup
    expect(Box.findById).toHaveBeenCalledWith(BOX_ID, COMPANY_ID);

    // red ppm alert (>= 10 ppm) with purge instruction
    expect(res.text).toContain('Elevated O2 level (12 ppm)');
    expect(res.text).toContain('must be purged/regenerated');
    // yellow maintenance alert
    expect(res.text).toContain('Clean the H2O sensor');
    // overall traffic light is red (red beats yellow)
    expect(res.text).toContain('status-red');
    expect(res.text).toContain('Immediate service needed');
    // both alerts counted in the badge
    expect(res.text).toContain('<span class="alert-badge">2</span>');
    // abbreviation dropdown filled from the company users
    expect(res.text).toContain('<option value="TSTU">TSTU</option>');
  });

  test('renders green status when nothing is due', async () => {
    const res = await agent.get(`/monitoring/${BOX_ID}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('status-green');
    expect(res.text).toContain('All systems normal');
    expect(res.text).toContain('No active alerts.');
  });

  test('yellow-only alerts give the yellow status', async () => {
    Measurement.findLatestByBox.mockResolvedValue({
      id: 901, box_id: BOX_ID, o2_value: 6, h2o_value: null, fridge_temp: null,
      measured_at: new Date().toISOString()
    });
    const res = await agent.get(`/monitoring/${BOX_ID}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Elevated O2 level (6 ppm)');
    expect(res.text).toContain('status-yellow');
    expect(res.text).toContain('Attention required');
  });

  test('unknown box -> 404', async () => {
    Box.findById.mockResolvedValue(null);
    const res = await agent.get('/monitoring/999');
    expect(res.status).toBe(404);
  });
});

describe('POST /monitoring/:id/submit', () => {
  test('without username -> redirect back with prompt, nothing saved', async () => {
    const res = await agent
      .post(`/monitoring/${BOX_ID}/submit`)
      .type('form')
      .send({ o2Value: '1.0', h2oValue: '', fridgeTemp: '' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/monitoring/${BOX_ID}`);
    expect(Measurement.create).not.toHaveBeenCalled();

    const page = await agent.get(`/monitoring/${BOX_ID}`);
    expect(page.text).toContain('Please select your user abbreviation before submitting.');
  });

  test('valid abbreviation -> Measurement.create with the resolved user id', async () => {
    mockAbbrevRows = [{ id: 99, email: 'lab@example.com' }];
    const res = await agent
      .post(`/monitoring/${BOX_ID}/submit`)
      .type('form')
      .send({ username: 'LAB', o2Value: '1.5', h2oValue: '0.4', fridgeTemp: '4' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/monitoring/${BOX_ID}`);
    expect(Measurement.create).toHaveBeenCalledTimes(1);
    expect(Measurement.create).toHaveBeenCalledWith({
      boxId: BOX_ID,
      userId: 99, // resolved from the abbreviation, not the session
      o2Value: '1.5',
      h2oValue: '0.4',
      fridgeTemp: '4'
    });
  });

  test('unknown abbreviation -> falls back to the session user id', async () => {
    // Documented current behaviour: the dropdown only offers valid Kuerzel, so
    // an unknown one cannot happen via the UI; server-side the measurement is
    // then attributed to the logged-in session user instead of failing.
    mockAbbrevRows = [];
    const res = await agent
      .post(`/monitoring/${BOX_ID}/submit`)
      .type('form')
      .send({ username: 'ZZZZ', o2Value: '2.0', h2oValue: '', fridgeTemp: '' });

    expect(res.status).toBe(302);
    expect(Measurement.create).toHaveBeenCalledWith(
      expect.objectContaining({ boxId: BOX_ID, userId: USER_ID })
    );
  });

  test('unknown box -> 404, nothing saved', async () => {
    Box.findById.mockResolvedValue(null);
    const res = await agent
      .post('/monitoring/999/submit')
      .type('form')
      .send({ username: 'LAB', o2Value: '1' });
    expect(res.status).toBe(404);
    expect(Measurement.create).not.toHaveBeenCalled();
  });
});

describe('POST /monitoring/:id/resolve/:field', () => {
  test('whitelisted field -> Box.updateMaintenanceDate called', async () => {
    const res = await agent.post(`/monitoring/${BOX_ID}/resolve/last_h2o_cleaning`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(Box.updateMaintenanceDate).toHaveBeenCalledWith(BOX_ID, 'last_h2o_cleaning');
  });

  test.each(['last_charcoal_done', 'last_sieve_done', 'last_solvent_test', 'last_oil_done'])(
    'whitelisted field %s is accepted', async (field) => {
      const res = await agent.post(`/monitoring/${BOX_ID}/resolve/${field}`);
      expect(res.status).toBe(200);
      expect(Box.updateMaintenanceDate).toHaveBeenCalledWith(BOX_ID, field);
    }
  );

  test('non-whitelisted field -> 400, no update (SQL injection guard)', async () => {
    const res = await agent.post(`/monitoring/${BOX_ID}/resolve/is_active`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid field' });
    expect(Box.updateMaintenanceDate).not.toHaveBeenCalled();
  });
});

describe('POST /monitoring/:id/ack/:key', () => {
  test('whitelisted key -> AlertAck.insertAck with the session user id', async () => {
    const res = await agent.post(`/monitoring/${BOX_ID}/ack/o2_high`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(AlertAck.insertAck).toHaveBeenCalledWith(BOX_ID, 'o2_high', USER_ID);
  });

  test.each(['o2_elevated', 'h2o_high', 'h2o_elevated'])(
    'whitelisted key %s is accepted', async (key) => {
      const res = await agent.post(`/monitoring/${BOX_ID}/ack/${key}`);
      expect(res.status).toBe(200);
      expect(AlertAck.insertAck).toHaveBeenCalledWith(BOX_ID, key, USER_ID);
    }
  );

  test('bad key -> 400, no ack inserted', async () => {
    const res = await agent.post(`/monitoring/${BOX_ID}/ack/whatever`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid alert key' });
    expect(AlertAck.insertAck).not.toHaveBeenCalled();
  });
});

describe('POST /monitoring/:id/message', () => {
  test('no username -> error flash, no mail sent', async () => {
    const res = await agent
      .post(`/monitoring/${BOX_ID}/message`)
      .type('form')
      .send({ message: 'Pump is noisy', username: '' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/monitoring/${BOX_ID}`);
    expect(emailService.sendContactMessage).not.toHaveBeenCalled();

    const page = await agent.get(`/monitoring/${BOX_ID}`);
    expect(page.text).toContain('Please select your user abbreviation before sending a message.');
  });

  test('empty message -> error flash, no mail sent', async () => {
    const res = await agent
      .post(`/monitoring/${BOX_ID}/message`)
      .type('form')
      .send({ message: '   ', username: 'LAB' });
    expect(res.status).toBe(302);
    expect(emailService.sendContactMessage).not.toHaveBeenCalled();
  });

  test('unknown abbreviation -> error flash, no mail sent', async () => {
    mockAbbrevRows = [];
    const res = await agent
      .post(`/monitoring/${BOX_ID}/message`)
      .type('form')
      .send({ message: 'Pump is noisy', username: 'ZZZZ' });

    expect(res.status).toBe(302);
    expect(emailService.sendContactMessage).not.toHaveBeenCalled();

    const page = await agent.get(`/monitoring/${BOX_ID}`);
    expect(page.text).toContain('Unknown user abbreviation');
  });

  test('valid username -> mail sent with the abbreviation-resolved email', async () => {
    mockAbbrevRows = [{ id: 99, email: 'lab@example.com' }];
    const res = await agent
      .post(`/monitoring/${BOX_ID}/message`)
      .type('form')
      .send({ message: 'Pump is noisy', username: 'LAB' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/monitoring/${BOX_ID}`);
    expect(emailService.sendContactMessage).toHaveBeenCalledTimes(1);
    // project number + email resolved from the Kuerzel (Konzept line 137),
    // NOT the session user's email (user@example.com)
    expect(emailService.sendContactMessage).toHaveBeenCalledWith(
      'P-100', 'lab@example.com', 'Pump is noisy'
    );
  });
});
