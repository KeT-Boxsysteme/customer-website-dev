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

const app = require('../server');
const User = require('../models/user');
const Box = require('../models/box');
const Measurement = require('../models/measurement');
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
  agent = await loginAgent(app, User, 'user');
});

describe('GET /diagrams/:id', () => {
  test('?months=9 renders the 9-month radio as selected and the datasets', async () => {
    const res = await agent.get(`/diagrams/${BOX_ID}?months=9`);
    expect(res.status).toBe(200);

    // scoped queries
    expect(Box.findById).toHaveBeenCalledWith(BOX_ID, COMPANY_ID);
    expect(Measurement.findByBox).toHaveBeenCalledWith(BOX_ID, 9);

    // radio selection: 9 months checked, the others not
    expect(res.text).toMatch(/value="9"\s+checked/);
    expect(res.text).not.toMatch(/value="6"\s+checked/);
    expect(res.text).not.toMatch(/value="12"\s+checked/);

    // chart datasets (chronologically reversed: oldest first)
    expect(res.text).toContain('const o2Data = [2,1.2];');
    expect(res.text).toContain('const h2oData = [1.1,0.6];');
    expect(res.text).toContain('const fridgeData = [5,4.5];');

    // table shows the measurement rows incl. the user abbreviation
    expect(res.text).toContain('TSTU');
    expect(res.text).toContain('LAB');
  });

  test('defaults to 6 months without a query parameter', async () => {
    const res = await agent.get(`/diagrams/${BOX_ID}`);
    expect(res.status).toBe(200);
    expect(Measurement.findByBox).toHaveBeenCalledWith(BOX_ID, 6);
    expect(res.text).toMatch(/value="6"\s+checked/);
  });

  test('invalid months value redirects to the 6-month default', async () => {
    const res = await agent.get(`/diagrams/${BOX_ID}?months=7`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/diagrams/${BOX_ID}?months=6`);
    expect(Measurement.findByBox).not.toHaveBeenCalled();
  });

  test('non-numeric months value falls back to 6 months', async () => {
    const res = await agent.get(`/diagrams/${BOX_ID}?months=abc`);
    expect(res.status).toBe(200);
    expect(Measurement.findByBox).toHaveBeenCalledWith(BOX_ID, 6);
  });

  test('fridge dataset and column are present when the box has a fridge', async () => {
    const res = await agent.get(`/diagrams/${BOX_ID}?months=6`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Fridge (°C)');
  });

  test('fridge dataset and column are absent when the box has no fridge', async () => {
    Box.findById.mockResolvedValue(makeBox({ has_fridge: 0 }));
    const res = await agent.get(`/diagrams/${BOX_ID}?months=6`);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('Fridge (°C)');
    // O2/H2O datasets still rendered
    expect(res.text).toContain('O₂ (ppm)');
    expect(res.text).toContain('H₂O (ppm)');
  });

  test('unknown box -> 404', async () => {
    Box.findById.mockResolvedValue(null);
    const res = await agent.get('/diagrams/999');
    expect(res.status).toBe(404);
  });

  test('empty measurement period renders the empty state', async () => {
    Measurement.findByBox.mockResolvedValue([]);
    const res = await agent.get(`/diagrams/${BOX_ID}?months=12`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('No data available for this period.');
  });
});
