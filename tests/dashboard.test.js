/**
 * Dashboard: welcome block stays, below it the status of every box of the company
 * (Betreiber 01.10.: "Beides: Willkommen + Box-Status"). Same traffic-light rule as the
 * monitoring page (services/boxStatus.js → services/alerts.js).
 */
jest.mock('../config/database', () => ({
  getPool: jest.fn(), closePool: jest.fn().mockResolvedValue(undefined), sql: {}
}));
jest.mock('../services/email', () => ({}));
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
const live = require('../services/liveReadings');
const { loginAgent, COMPANY_ID } = require('./helpers/login');

const recent = () => new Date(Date.now() - 3600 * 1000);
const box = (o = {}) => ({
  id: 1, company_id: COMPANY_ID, box_alias: 'Lab Box', project_number: 'P-1', created_at: recent(),
  has_o2_sensor: 1, has_h2o_sensor: 1, has_fridge: 0, fridge_temp: null, sensor_serial: null,
  last_h2o_cleaning: recent(), ...o
});

let agent;
beforeEach(async () => {
  jest.clearAllMocks();
  live.reset();
  Measurement.findLatestByBox.mockResolvedValue(null);
  AlertAck.latestAcks.mockResolvedValue([]);
  agent = await loginAgent(app, User, 'user');
});

describe('GET /dashboard – box status', () => {
  test('welcome block stays; every box of the own company appears with its traffic light and a link to its monitoring', async () => {
    Box.findAllByCompany.mockResolvedValue([
      box({ id: 1, box_alias: 'Box Fine' }),
      box({ id: 2, box_alias: 'Box Cold', has_fridge: 1, fridge_temp: -30, sensor_serial: '740B3B' })
    ]);
    live.record(2, '740B3B', 20);   // 50 °C off target -> red

    const res = await agent.get('/dashboard');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Welcome to');
    expect(Box.findAllByCompany).toHaveBeenCalledWith(COMPANY_ID);

    const tile = id => (res.text.match(new RegExp('<a href="/monitoring/' + id + '"[^>]*class="box-tile[^"]*"[\\s\\S]*?</a>')) || [''])[0];
    expect(tile(1)).toContain('box-tile--green');
    expect(tile(2)).toContain('box-tile--red');
    expect(tile(2)).toContain('20.0 °C');
    expect(tile(2)).toContain('Fridge temperature 20.0 °C deviates from the target of -30 °C');
  });

  test('ppm alert from the latest manual entry turns the tile red and counts the alerts', async () => {
    Box.findAllByCompany.mockResolvedValue([box({ id: 3 })]);
    Measurement.findLatestByBox.mockResolvedValue({ o2_value: 12, h2o_value: 6, measured_at: recent() });
    const res = await agent.get('/dashboard');
    expect(res.text).toMatch(/class="box-tile box-tile--red"/);
    expect(res.text).toContain('2 alerts');
  });

  test('no boxes -> hint instead of an empty area', async () => {
    Box.findAllByCompany.mockResolvedValue([]);
    const res = await agent.get('/dashboard');
    expect(res.text).toContain('No gloveboxes yet');
  });

  test('database not reachable -> dashboard still opens with a hint (no crash, no false green)', async () => {
    Box.findAllByCompany.mockRejectedValue(new Error('not currently available'));
    const res = await agent.get('/dashboard');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Box status could not be loaded');
    expect(res.text).not.toContain('box-tile--green');
  });
});

describe('GET /dashboard/live — tiles stay live (Betreiber 01.10.)', () => {
  const live = require('../services/liveReadings');
  test('per box: live temperature and a state key (one DB query, no measurements)', async () => {
    live.reset();
    Box.findAllByCompany.mockResolvedValue([{ id: 3, has_fridge: 1, fridge_temp: -30, sensor_serial: '740B3B', fridge_alarm_level: null, created_at: '2026-01-01' }]);
    live.record(3, '740B3B', -29.5);
    const res = await agent.get('/dashboard/live');
    expect(res.status).toBe(200);
    expect(res.body.boxes).toEqual([expect.objectContaining({ id: 3, temp: -29.5, stateKey: expect.any(String) })]);
    expect(Box.findAllByCompany).toHaveBeenCalledWith(COMPANY_ID);
  });
});

describe('dashboard tile text follows the held fridge alarm (Fund 01.10.)', () => {
  const live = require('../services/liveReadings');
  const heldBox = { id: 3, has_fridge: 1, fridge_temp: 18, sensor_serial: '740B3B', created_at: '2026-01-01',
    fridge_alarm_level: 'red', fridge_alarm_since: '2026-10-01T20:00:00Z', fridge_alarm_temp: 43, fridge_alarm_source: 'sensor' };
  const keyAt = async temp => {
    live.reset();
    Box.findAllByCompany.mockResolvedValue([heldBox]);
    live.record(3, '740B3B', temp);
    return (await agent.get('/dashboard/live')).body.boxes[0].stateKey;
  };
  test('temperature back on target while the alarm is held -> state changes once (tile rebuilds, says "deviated")', async () => {
    expect(await keyAt(18)).not.toBe(await keyAt(43));
  });
  test('temperature moves but stays off target -> state stays (no reload every 5 s)', async () => {
    expect(await keyAt(44)).toBe(await keyAt(43));
    expect(await keyAt(18.5)).toBe(await keyAt(18));
  });
});

describe('dashboard tile shows the box temperature (E-34)', () => {
  const live = require('../services/liveReadings');
  test('live endpoint and tile carry the box temperature', async () => {
    live.reset();
    Box.findAllByCompany.mockResolvedValue([{ id: 3, box_alias: 'Mia', has_fridge: 0, sensor_serial: null, box_sensor_serial: 'A1B2C3', created_at: '2026-01-01' }]);
    live.record(3, 'A1B2C3', 23.4, Date.now(), null, 'box');
    const res = await agent.get('/dashboard/live');
    expect(res.body.boxes[0]).toMatchObject({ id: 3, boxTemp: 23.4 });
    const page = await agent.get('/dashboard');
    expect(page.text).toMatch(/data-live-box-temp[^>]*>\s*23\.4 °C/);
  });
});

describe('logged-in pages: sidebar shows the full logo on a white plate, headings the small logo (Betreiber 03.10.)', () => {
  test('dashboard: sidebar logo + "by" logo in the welcome line', async () => {
    Box.findAllByCompany.mockResolvedValue([]);
    const html = (await agent.get('/dashboard')).text;
    expect(html).toMatch(/class="sidebar-logo__plate"[\s\S]*?<img[^>]*src="\/img\/ket-logo-full\.webp[^"]*"[^>]*alt="Glovebox-Monitoring by KeT"/);
    expect(html).toMatch(/Welcome to <span class="dash-hero__brand">Glovebox-Monitoring by <img[^>]*class="brand-logo"/);
  });
});
