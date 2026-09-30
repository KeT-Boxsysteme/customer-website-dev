/**
 * Diagram pages: time-range radio selection (6/9/12 months), dataset table,
 * fridge dataset only when the box has a fridge (Konzept.txt lines 145–154).
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
jest.mock('../models/sensorReading');

const app = require('../server');
const User = require('../models/user');
const Box = require('../models/box');
const Measurement = require('../models/measurement');
const SensorReading = require('../models/sensorReading');
const { loginAgent, COMPANY_ID } = require('./helpers/login');

const BOX_ID = 5;

function makeBox(overrides = {}) {
  return {
    id: BOX_ID,
    company_id: COMPANY_ID,
    manufacturer: 'MBraun',
    project_number: 'P-100',
    box_alias: 'Lab Box 1',
    has_o2_sensor: 1,
    has_h2o_sensor: 1,
    has_fridge: 1,
    ...overrides
  };
}

const measurementRows = [
  { id: 2, measured_at: '2026-06-20T10:00:00Z', username: 'TSTU', o2_value: 1.2, h2o_value: 0.6, fridge_temp: 4.5 },
  { id: 1, measured_at: '2026-05-01T08:00:00Z', username: 'LAB', o2_value: 2, h2o_value: 1.1, fridge_temp: 5 }
];

let agent;
beforeEach(async () => {
  jest.clearAllMocks();
  Box.findAllByCompany.mockResolvedValue([]);
  Box.findById.mockResolvedValue(makeBox());
  Measurement.findByBox.mockResolvedValue(measurementRows);
  SensorReading.historyByBox.mockResolvedValue([]);
  agent = await loginAgent(app, User, 'user');
});

describe('GET /diagrams/:id – time ranges (24 h · 7 days · 30 days · 6/9/12 months)', () => {
  const since = () => Measurement.findByBox.mock.calls[0][1].getTime();
  const DAY = 24 * 3600 * 1000;

  test('?range=9m -> 9-month link is current, queries start about 9 months back', async () => {
    const res = await agent.get(`/diagrams/${BOX_ID}?range=9m`);
    expect(res.status).toBe(200);
    expect(Box.findById).toHaveBeenCalledWith(BOX_ID, COMPANY_ID);
    expect(res.text).toMatch(/href="\/diagrams\/5\?range=9m"[^>]*aria-current="page"/);
    expect(res.text).not.toMatch(/href="\/diagrams\/5\?range=6m"[^>]*aria-current="page"/);
    const days = (Date.now() - since()) / DAY;
    expect(days).toBeGreaterThan(260);
    expect(days).toBeLessThan(280);
  });

  test('?range=24h -> sensor history in 5-minute steps for the last 24 hours', async () => {
    const res = await agent.get(`/diagrams/${BOX_ID}?range=24h`);
    expect(res.status).toBe(200);
    const [boxId, from, bucket] = SensorReading.historyByBox.mock.calls[0];
    expect(boxId).toBe(BOX_ID);
    expect(bucket).toBe(5);
    expect(Math.round((Date.now() - from.getTime()) / 3600000)).toBe(24);
  });

  test('old links ?months=9 still work (mapped to 9m)', async () => {
    const res = await agent.get(`/diagrams/${BOX_ID}?months=9`);
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/href="\/diagrams\/5\?range=9m"[^>]*aria-current="page"/);
  });

  test('default: 7 days for a box with sensor, 6 months without', async () => {
    Box.findById.mockResolvedValue(makeBox({ sensor_serial: '740B3B' }));
    let res = await agent.get(`/diagrams/${BOX_ID}`);
    expect(res.text).toMatch(/href="\/diagrams\/5\?range=7d"[^>]*aria-current="page"/);
    Box.findById.mockResolvedValue(makeBox({ sensor_serial: null }));
    res = await agent.get(`/diagrams/${BOX_ID}`);
    expect(res.text).toMatch(/href="\/diagrams\/5\?range=6m"[^>]*aria-current="page"/);
  });

  test('unknown range -> redirect to the default, nothing queried', async () => {
    const res = await agent.get(`/diagrams/${BOX_ID}?range=5y`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/diagrams/${BOX_ID}`);
    expect(Measurement.findByBox).not.toHaveBeenCalled();
  });

  test('values as time series (oldest first) and the manual-entry table', async () => {
    const res = await agent.get(`/diagrams/${BOX_ID}?range=12m`);
    const may = new Date('2026-05-01T08:00:00Z').getTime();
    const june = new Date('2026-06-20T10:00:00Z').getTime();
    expect(res.text).toContain(`"o2":[{"x":${may},"y":2},{"x":${june},"y":1.2}]`);
    expect(res.text).toContain(`"h2o":[{"x":${may},"y":1.1},{"x":${june},"y":0.6}]`);
    expect(res.text).toContain(`"manual":[{"x":${may},"y":5},{"x":${june},"y":4.5}]`);
    expect(res.text).toContain('TSTU');
    expect(res.text).toContain('LAB');
  });

  test('fridge column only with a fridge; O2/H2O chart still there', async () => {
    let res = await agent.get(`/diagrams/${BOX_ID}?range=6m`);
    expect(res.text).toContain('Fridge (°C)');
    Box.findById.mockResolvedValue(makeBox({ has_fridge: 0 }));
    res = await agent.get(`/diagrams/${BOX_ID}?range=6m`);
    expect(res.text).not.toContain('Fridge (°C)');
    expect(res.text).toContain('id="ppmChart"');
  });

  test('unknown box -> 404', async () => {
    Box.findById.mockResolvedValue(null);
    const res = await agent.get('/diagrams/999');
    expect(res.status).toBe(404);
  });

  test('empty period renders the empty states', async () => {
    Measurement.findByBox.mockResolvedValue([]);
    const res = await agent.get(`/diagrams/${BOX_ID}?range=12m`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('No data available for this period.');
    expect(res.text).toContain('No temperature values in this period.');
  });
});

describe('GET /diagrams/:id – sensor history (Fund 01.10.: sensor box showed no diagram)', () => {
  test('fridge box -> sensor history for the chosen range is loaded and drawn', async () => {
    SensorReading.historyByBox.mockResolvedValue([
      { bucket: '2026-09-30T18:00:00Z', avg_temp: 24.9, min_temp: 24.5, max_temp: 25.3 }
    ]);
    const res = await agent.get(`/diagrams/${BOX_ID}?range=30d`);
    expect(res.status).toBe(200);
    expect(SensorReading.historyByBox.mock.calls[0][2]).toBe(120);
    expect(res.text).toContain('id="tempChart"');
    expect(res.text).toContain('24.9');
  });

  test('box without fridge -> no sensor query, no temperature chart', async () => {
    Box.findById.mockResolvedValue(makeBox({ has_fridge: 0 }));
    const res = await agent.get(`/diagrams/${BOX_ID}`);
    expect(SensorReading.historyByBox).not.toHaveBeenCalled();
    expect(res.text).not.toContain('id="tempChart"');
  });
});
