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
jest.mock('../models/sensorReading');

const app = require('../server');
const User = require('../models/user');
const Box = require('../models/box');
const Measurement = require('../models/measurement');
const AlertAck = require('../models/alertAck');
const emailService = require('../services/email');
const SensorReading = require('../models/sensorReading');
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
    lmf_replacement_months: null,
    has_solvent_sensor: 0,
    solvent_sensor_calibrated: null,
    has_o2_sensor: 1,
    o2_sensor_calibrated: '2024',
    has_h2o_sensor: 1,
    h2o_sensor_calibrated: '2025',
    has_pressure_sensor: 0,
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


  test('pressure input only rendered when the box has a pressure sensor', async () => {
    const without = await agent.get(`/monitoring/${BOX_ID}`);
    expect(without.text).not.toContain('name="pressureValue"');

    Box.findById.mockResolvedValue(makeBox({ has_pressure_sensor: 1 }));
    const with_ = await agent.get(`/monitoring/${BOX_ID}`);
    expect(with_.text).toContain('name="pressureValue"');
    expect(with_.text).toContain('Pressure');
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

  test('pressure value is forwarded when the box has a pressure sensor', async () => {
    Box.findById.mockResolvedValue(makeBox({ has_pressure_sensor: 1 }));
    mockAbbrevRows = [{ id: 99, email: 'lab@example.com' }];
    const res = await agent
      .post(`/monitoring/${BOX_ID}/submit`)
      .type('form')
      .send({ username: 'LAB', o2Value: '1.5', h2oValue: '0.4', fridgeTemp: '4', pressureValue: '0.005' });

    expect(res.status).toBe(302);
    expect(Measurement.create).toHaveBeenCalledWith(
      expect.objectContaining({ pressureValue: '0.005' })
    );
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

  test.each(['last_charcoal_done', 'last_sieve_done', 'last_solvent_test', 'last_oil_done',
             'last_lmf_replacement'])(
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

describe('temperature sensor in monitoring (display only – pairing is done in Box Management)', () => {
  test('assigned sensor is shown, but there is no connect button, even for admins', async () => {
    Box.findById.mockResolvedValue(makeBox({ sensor_serial: '740B3B' }));
    const admin = await loginAgent(app, User, 'admin');
    const page = await admin.get(`/monitoring/${BOX_ID}`);
    expect(page.status).toBe(200);
    expect(page.text).toContain('Sensor 740B3B');
    expect(page.text).not.toContain('data-sensor-connect');
  });

  test('there is no pairing endpoint in monitoring', async () => {
    const admin = await loginAgent(app, User, 'admin');
    const res = await admin.post(`/monitoring/${BOX_ID}/sensor`).send({ serial: '740B3B' });
    expect(res.status).toBe(404);
    expect(Box.setSensor).not.toHaveBeenCalled();
  });
});

describe('POST /monitoring/:id/readings (live sensor values, E-16/E-19)', () => {
  const sensorBox = (o = {}) => makeBox({ sensor_serial: '740B3B', sensor_store_minutes: 5, ...o });
  beforeEach(() => {
    require('../services/liveReadings').reset();
    Box.findById.mockResolvedValue(sensorBox());
    SensorReading.createIfDue.mockResolvedValue(true);
  });

  test.each(['admin', 'controller', 'user', 'box_user'])('%s may send a reading -> stored with the box interval', async role => {
    const a = await loginAgent(app, User, role);
    const res = await a.post(`/monitoring/${BOX_ID}/readings`).send({ serial: '740b3b', temp: 4.23 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ stored: true });
    // 5-minute interval -> 295 s window, value rounded to 0.1
    expect(SensorReading.createIfDue).toHaveBeenCalledWith(BOX_ID, '740B3B', 4.2, 295);
  });

  test('server refuses a second reading inside the interval (reports stored: false)', async () => {
    SensorReading.createIfDue.mockResolvedValue(false);
    const res = await agent.post(`/monitoring/${BOX_ID}/readings`).send({ serial: '740B3B', temp: 4 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ stored: false });
  });

  test('reading from a sensor that is not assigned to this box -> 409, nothing stored', async () => {
    const res = await agent.post(`/monitoring/${BOX_ID}/readings`).send({ serial: 'AAAAAA', temp: 4 });
    expect(res.status).toBe(409);
    expect(SensorReading.createIfDue).not.toHaveBeenCalled();
  });

  test('box without sensor -> 409, nothing stored', async () => {
    Box.findById.mockResolvedValue(makeBox({ sensor_serial: null }));
    const res = await agent.post(`/monitoring/${BOX_ID}/readings`).send({ serial: '740B3B', temp: 4 });
    expect(res.status).toBe(409);
    expect(SensorReading.createIfDue).not.toHaveBeenCalled();
  });

  test('implausible temperature -> 400, nothing stored', async () => {
    const res = await agent.post(`/monitoring/${BOX_ID}/readings`).send({ serial: '740B3B', temp: 999 });
    expect(res.status).toBe(400);
    expect(SensorReading.createIfDue).not.toHaveBeenCalled();
  });

  test('unknown box -> 404, nothing stored', async () => {
    Box.findById.mockResolvedValue(null);
    const res = await agent.post(`/monitoring/${BOX_ID}/readings`).send({ serial: '740B3B', temp: 4 });
    expect(res.status).toBe(404);
    expect(SensorReading.createIfDue).not.toHaveBeenCalled();
  });
});

describe('GET /monitoring/:id – live sensor block', () => {
  test('box with sensor -> live block with serial and live URL for the browser', async () => {
    Box.findById.mockResolvedValue(makeBox({ sensor_serial: '740B3B', sensor_store_minutes: 15 }));
    const page = await agent.get(`/monitoring/${BOX_ID}`);
    expect(page.text).toContain('data-live-sensor');
    expect(page.text).toContain('data-serial="740B3B"');
    expect(page.text).toContain(`data-live-url="/monitoring/${BOX_ID}/live"`);
  });

  test('box without sensor -> no live block, fridge field stays a normal input', async () => {
    const page = await agent.get(`/monitoring/${BOX_ID}`);
    expect(page.text).not.toContain('data-live-sensor');
  });
});

describe('GET /monitoring/:id – no pairing button at all (Betreiber 30.09.)', () => {
  test('box with sensor: live status line, but no connect / start button that could break the pairing', async () => {
    Box.findById.mockResolvedValue(makeBox({ sensor_serial: '740B3B', sensor_store_minutes: 1 }));
    const admin = await loginAgent(app, User, 'admin');
    const page = await admin.get(`/monitoring/${BOX_ID}`);
    expect(page.text).toContain('data-live-status');
    expect(page.text).not.toContain('data-live-connect');
    expect(page.text).not.toContain('Start live reading');
    expect(page.text).not.toContain('data-sensor-connect');
  });

  test('box name is shown under the brand', async () => {
    const page = await agent.get(`/monitoring/${BOX_ID}`);
    expect(page.text).toContain('class="monitoring-box-name"');
  });
});

describe('server-held live values (connection lives in the background hub, not in the page)', () => {
  const sensorBox = (o = {}) => makeBox({ sensor_serial: '740B3B', sensor_store_minutes: 1, ...o });
  beforeEach(() => {
    require('../services/liveReadings').reset();
    Box.findById.mockResolvedValue(sensorBox());
    SensorReading.createIfDue.mockResolvedValue(true);
  });

  test('every value updates the live value, but the DB is only asked once per interval', async () => {
    await agent.post(`/monitoring/${BOX_ID}/readings`).send({ serial: '740B3B', temp: 4.0 });
    const second = await agent.post(`/monitoring/${BOX_ID}/readings`).send({ serial: '740B3B', temp: 4.5 });
    expect(second.body).toEqual({ stored: false });
    expect(SensorReading.createIfDue).toHaveBeenCalledTimes(1);

    const liveRes = await agent.get(`/monitoring/${BOX_ID}/live`);
    expect(liveRes.status).toBe(200);
    expect(liveRes.body).toMatchObject({ serial: '740B3B', temp: 4.5, fresh: true });
  });

  test('no value yet -> live says nothing (no invented value)', async () => {
    const res = await agent.get(`/monitoring/${BOX_ID}/live`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ serial: '740B3B', temp: null, fresh: false });
    expect(res.body).not.toHaveProperty('ageSeconds');
  });

  test('live of an unknown / other company box -> 404', async () => {
    Box.findById.mockResolvedValue(null);
    const res = await agent.get(`/monitoring/${BOX_ID}/live`);
    expect(res.status).toBe(404);
  });

  test('sensor list for the background hub: only fridge boxes with a sensor, own company', async () => {
    Box.findAllByCompany.mockResolvedValue([
      sensorBox({ id: 5, sensor_store_minutes: 15 }),
      makeBox({ id: 6, has_fridge: 1, sensor_serial: null }),
      makeBox({ id: 7, has_fridge: 0, sensor_serial: 'AAAAAA' })
    ]);
    const res = await agent.get('/monitoring/sensors');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ boxId: 5, serial: '740B3B', storeMinutes: 15, url: '/monitoring/5/readings' }]);
    expect(Box.findAllByCompany).toHaveBeenCalledWith(COMPANY_ID);
  });
});

describe('logged-in pages carry the background sensor hub (kept alive by Turbo)', () => {
  test('monitoring page head loads Turbo and the hub', async () => {
    const page = await agent.get(`/monitoring/${BOX_ID}`);
    expect(page.text).toContain('/js/vendor/turbo.umd.js');
    expect(page.text).toContain('/js/sensor-hub.js');
  });
});

describe('fridge temperature in the traffic light, live (E-21 rev.)', () => {
  const live = require('../services/liveReadings');
  const fridgeBox = (o = {}) => makeBox({ has_fridge: 1, fridge_temp: -30, sensor_serial: '740B3B', sensor_store_minutes: 1, ...o });
  beforeEach(() => {
    live.reset();
    Box.findById.mockResolvedValue(fridgeBox());
    SensorReading.createIfDue.mockResolvedValue(true);
  });

  test('sensor 20 °C at target -30 °C -> box red immediately, alert without Done button', async () => {
    await agent.post(`/monitoring/${BOX_ID}/readings`).send({ serial: '740B3B', temp: 20 });
    const page = await agent.get(`/monitoring/${BOX_ID}`);
    expect(page.text).toContain('status-red');
    expect(page.text).toContain('Fridge temperature 20.0 °C deviates from the target of -30 °C');
    expect(page.text).not.toContain('data-target="fridge_temp"');
    const liveRes = await agent.get(`/monitoring/${BOX_ID}/live`);
    expect(liveRes.body).toMatchObject({ temp: 20, fresh: true, fridgeAlert: 'red' });
  });

  test('sensor assigned but no value -> yellow, never “All systems normal”', async () => {
    const page = await agent.get(`/monitoring/${BOX_ID}`);
    expect(page.text).toContain('status-yellow');
    expect(page.text).toContain('Temperature sensor not delivering values');
    expect(page.text).not.toContain('All systems normal');
    expect((await agent.get(`/monitoring/${BOX_ID}/live`)).body.fridgeAlert).toBe('yellow');
  });

  test('value in range -> green', async () => {
    await agent.post(`/monitoring/${BOX_ID}/readings`).send({ serial: '740B3B', temp: -29.5 });
    expect((await agent.get(`/monitoring/${BOX_ID}`)).text).toContain('status-green');
  });
});

describe('the monitoring page stays live: state key changes on every relevant change', () => {
  const live = require('../services/liveReadings');
  const stateKey = async () => (await agent.get(`/monitoring/${BOX_ID}/live`)).body.stateKey;
  beforeEach(() => {
    live.reset();
    Box.findById.mockResolvedValue(makeBox({ has_fridge: 1, fridge_temp: -30, sensor_serial: '740B3B', sensor_store_minutes: 1 }));
    SensorReading.createIfDue.mockResolvedValue(true);
  });

  test('page and live endpoint carry the same state key; it stays the same while nothing changes', async () => {
    await agent.post(`/monitoring/${BOX_ID}/readings`).send({ serial: '740B3B', temp: -30 });
    const page = await agent.get(`/monitoring/${BOX_ID}`);
    const key = await stateKey();
    expect(key).toEqual(expect.any(String));
    expect(page.text).toContain(`data-state-key="${key}"`);
    await agent.post(`/monitoring/${BOX_ID}/readings`).send({ serial: '740B3B', temp: -29.8 });
    expect(await stateKey()).toBe(key);
  });

  test('temperature leaves the range -> key changes', async () => {
    await agent.post(`/monitoring/${BOX_ID}/readings`).send({ serial: '740B3B', temp: -30 });
    const before = await stateKey();
    await agent.post(`/monitoring/${BOX_ID}/readings`).send({ serial: '740B3B', temp: 20 });
    expect(await stateKey()).not.toBe(before);
  });

  test('values submitted on another device -> key changes', async () => {
    const before = await stateKey();
    mockAbbrevRows = [{ id: 99, email: 'lab@example.com' }];
    await agent.post(`/monitoring/${BOX_ID}/submit`).type('form').send({ username: 'AB', o2Value: '12' });
    expect(await stateKey()).not.toBe(before);
  });

  test('Done on an alert (ack / maintenance) -> key changes', async () => {
    const a = await stateKey();
    await agent.post(`/monitoring/${BOX_ID}/ack/o2_high`);
    const b = await stateKey();
    expect(b).not.toBe(a);
    await agent.post(`/monitoring/${BOX_ID}/resolve/last_h2o_cleaning`);
    expect(await stateKey()).not.toBe(b);
  });

  test('without username nothing is saved -> key unchanged', async () => {
    const before = await stateKey();
    await agent.post(`/monitoring/${BOX_ID}/submit`).type('form').send({ o2Value: '12' });
    expect(await stateKey()).toBe(before);
  });
});

describe('value fields show which point causes the traffic light (Betreiber 01.10.)', () => {
  const live = require('../services/liveReadings');
  beforeEach(() => {
    live.reset();
    SensorReading.createIfDue.mockResolvedValue(true);
  });
  const fieldClass = (html, id) => {
    const m = html.match(new RegExp('<div class="([^"]*)"[^>]*>\\s*<label for="' + id + '"'));
    return m ? m[1] : null;
  };

  test('fridge 10 °C off -> fridge field red, O2/H2O fine -> not coloured', async () => {
    Box.findById.mockResolvedValue(makeBox({ has_o2_sensor: 1, has_h2o_sensor: 1, has_fridge: 1, fridge_temp: -30,
      sensor_serial: '740B3B', sensor_store_minutes: 1 }));
    Measurement.findLatestByBox.mockResolvedValue({ o2_value: 1, h2o_value: 1, measured_at: new Date() });
    await agent.post(`/monitoring/${BOX_ID}/readings`).send({ serial: '740B3B', temp: -20 });
    const page = (await agent.get(`/monitoring/${BOX_ID}`)).text;
    expect(fieldClass(page, 'fridgeTemp')).toContain('sensor-field--red');
    expect(fieldClass(page, 'o2Value')).not.toMatch(/sensor-field--/);
    expect(fieldClass(page, 'h2oValue')).not.toMatch(/sensor-field--/);
  });

  test('O2 12 ppm -> O2 field red; fridge in range -> fridge field not red', async () => {
    Box.findById.mockResolvedValue(makeBox({ has_o2_sensor: 1, has_fridge: 1, fridge_temp: -30,
      sensor_serial: '740B3B', sensor_store_minutes: 1 }));
    Measurement.findLatestByBox.mockResolvedValue({ o2_value: 12, h2o_value: null, measured_at: new Date() });
    await agent.post(`/monitoring/${BOX_ID}/readings`).send({ serial: '740B3B', temp: -30 });
    const page = (await agent.get(`/monitoring/${BOX_ID}`)).text;
    expect(fieldClass(page, 'o2Value')).toContain('sensor-field--red');
    expect(fieldClass(page, 'fridgeTemp')).not.toMatch(/sensor-field--(red|yellow)/);
  });
});

describe('hub diagnostics travel with the reading and are visible in /live (01.10.)', () => {
  const live = require('../services/liveReadings');
  beforeEach(() => {
    live.reset();
    Box.findById.mockResolvedValue(makeBox({ has_fridge: 1, fridge_temp: -30, sensor_serial: '740B3B', sensor_store_minutes: 1 }));
    SensorReading.createIfDue.mockResolvedValue(true);
  });
  test('drops / attempts / last error of the sending device appear in the live answer', async () => {
    await agent.post(`/monitoring/${BOX_ID}/readings`).send({ serial: '740B3B', temp: -30, diag: { drops: 2, attempts: 5, lastError: 'timeout after 20 s' } });
    const res = await agent.get(`/monitoring/${BOX_ID}/live`);
    expect(res.body.hub).toEqual({ drops: 2, attempts: 5, lastError: 'timeout after 20 s' });
  });
});
