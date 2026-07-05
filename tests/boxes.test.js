/**
 * Box management: server-side validation of conditional fields and correct
 * mapping of the form payload onto the model layer (Konzept.txt lines 67–105).
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
const { loginAgent, COMPANY_ID } = require('./helpers/login');

/** Full, valid form payload: everything switched on, custom glove ports. */
const fullPayload = {
  manufacturer: 'MBraun',
  projectNumber: 'P-100',
  buildYear: '2021',
  boxType: 'Alpha 2000',
  boxAlias: 'Lab Box 1',
  filterSystem: 'dual',
  hasSolventFilter: '1',
  solventFilterType: 'charcoal',
  charcoalCycleMonths: '6',
  molecularSieveCycleMonths: '',
  hasSolventSensor: '1',
  solventSensorCalibrated: '2023',
  hasO2Sensor: '1',
  o2SensorCalibrated: '2024',
  hasH2oSensor: '1',
  h2oSensorCalibrated: '2025',
  lastCleaned: '2026-01-15',
  hasFridge: '1',
  fridgeTemp: '4',
  hasOilPump: '1',
  lastOilChange: '2026-02-01',
  glovePorts: 'custom',
  glovePortsCustom: '5',
  usageType: 'underpressure',
  additionalNotes: 'Extra antechamber'
};

/** What parseBoxForm should hand to the model for fullPayload. */
const expectedMappedData = {
  manufacturer: 'MBraun',
  projectNumber: 'P-100',
  boxType: 'Alpha 2000',
  boxAlias: 'Lab Box 1',
  hasDualFilter: true,
  hasSolventFilter: true,
  solventFilterType: 'charcoal',
  charcoalCycleMonths: 6,
  molecularSieveCycleMonths: null,
  hasSolventSensor: true,
  solventSensorCalibrated: '2023',
  hasO2Sensor: true,
  o2SensorCalibrated: '2024',
  hasH2oSensor: true,
  h2oSensorCalibrated: '2025',
  lastCleaned: '2026-01-15',
  hasFridge: true,
  fridgeTemp: 4,
  hasOilPump: true,
  lastOilChange: '2026-02-01',
  glovePorts: 5, // custom number wins over the radio value
  usageType: 'underpressure',
  buildYear: 2021,
  additionalNotes: 'Extra antechamber'
};

let agent;
beforeEach(async () => {
  jest.clearAllMocks();
  Box.findAllByCompany.mockResolvedValue([]);
  Box.create.mockResolvedValue(1);
  Box.update.mockResolvedValue(undefined);
  agent = await loginAgent(app, User, 'admin');
});

describe('POST /boxes validation', () => {
  test('solvent filter on but no filter type -> 400 re-render with error', async () => {
    const res = await agent.post('/boxes').type('form').send({
      ...fullPayload,
      solventFilterType: '',
      charcoalCycleMonths: '',
      molecularSieveCycleMonths: ''
    });
    expect(res.status).toBe(400);
    expect(res.text).toContain('Please choose a solvent filter type.');
    // Re-rendered form keeps the user's input (repopulate)
    expect(res.text).toContain('P-100');
    expect(Box.create).not.toHaveBeenCalled();
  });

  test('H2O sensor on but no last-cleaned date -> 400 (Konzept: nur bei H2O abgefragt)', async () => {
    const res = await agent.post('/boxes').type('form').send({
      ...fullPayload,
      lastCleaned: ''
    });
    expect(res.status).toBe(400);
    expect(res.text).toContain('Last cleaned date is required.');
    expect(Box.create).not.toHaveBeenCalled();
  });

  test('no H2O sensor -> last-cleaned neither required nor persisted', async () => {
    const res = await agent.post('/boxes').type('form').send({
      ...fullPayload,
      hasH2oSensor: '',
      h2oSensorCalibrated: '',
      lastCleaned: ''
    });
    expect(res.status).toBe(302);
    expect(Box.create).toHaveBeenCalledWith(expect.objectContaining({ lastCleaned: null }));
  });

  test('charcoal filter without replacement cycle -> 400', async () => {
    const res = await agent.post('/boxes').type('form').send({
      ...fullPayload,
      charcoalCycleMonths: ''
    });
    expect(res.status).toBe(400);
    expect(res.text).toContain('Carbon replacement cycle (months) is required.');
    expect(Box.create).not.toHaveBeenCalled();
  });

  test('molecular sieve without regeneration cycle -> 400', async () => {
    const res = await agent.post('/boxes').type('form').send({
      ...fullPayload,
      solventFilterType: 'molecular_sieve',
      molecularSieveCycleMonths: ''
    });
    expect(res.status).toBe(400);
    expect(res.text).toContain('Sieve regeneration cycle (months) is required.');
    expect(Box.create).not.toHaveBeenCalled();
  });

  test('fridge yes but no temperature -> 400', async () => {
    const res = await agent.post('/boxes').type('form').send({
      ...fullPayload,
      fridgeTemp: ''
    });
    expect(res.status).toBe(400);
    expect(res.text).toContain('Refrigerator temperature is required.');
    expect(Box.create).not.toHaveBeenCalled();
  });

  test('oil pump yes but no last oil change date -> 400', async () => {
    const res = await agent.post('/boxes').type('form').send({
      ...fullPayload,
      lastOilChange: ''
    });
    expect(res.status).toBe(400);
    expect(res.text).toContain('Last oil change date is required.');
    expect(Box.create).not.toHaveBeenCalled();
  });

  test('sensor present but no calibration year -> 400', async () => {
    const res = await agent.post('/boxes').type('form').send({
      ...fullPayload,
      o2SensorCalibrated: ''
    });
    expect(res.status).toBe(400);
    expect(res.text).toContain('O2 sensor: calibration year (4 digits) is required.');
    expect(Box.create).not.toHaveBeenCalled();
  });

  test('invalid custom glove port count -> 400', async () => {
    const res = await agent.post('/boxes').type('form').send({
      ...fullPayload,
      glovePortsCustom: '0'
    });
    expect(res.status).toBe(400);
    expect(res.text).toContain('Please enter a valid number of glove ports.');
    expect(Box.create).not.toHaveBeenCalled();
  });
});

describe('POST /boxes happy path', () => {
  test('valid full payload -> Box.create with correctly mapped values', async () => {
    const res = await agent.post('/boxes').type('form').send(fullPayload);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/boxes');
    expect(Box.create).toHaveBeenCalledTimes(1);
    expect(Box.create).toHaveBeenCalledWith({
      companyId: COMPANY_ID, // scoped to the session's company
      ...expectedMappedData
    });
  });

  test('single-filter system + standard glove ports map correctly', async () => {
    const res = await agent.post('/boxes').type('form').send({
      ...fullPayload,
      filterSystem: 'single',
      glovePorts: '4',
      glovePortsCustom: ''
    });
    expect(res.status).toBe(302);
    expect(Box.create).toHaveBeenCalledWith(expect.objectContaining({
      hasDualFilter: false,
      glovePorts: 4
    }));
  });

  test('switched-off features are stored as null even if values were sent', async () => {
    const res = await agent.post('/boxes').type('form').send({
      ...fullPayload,
      hasSolventFilter: '0',
      hasFridge: '0',
      hasOilPump: '0',
      hasSolventSensor: '0'
    });
    expect(res.status).toBe(302);
    expect(Box.create).toHaveBeenCalledWith(expect.objectContaining({
      hasSolventFilter: false,
      solventFilterType: null,
      charcoalCycleMonths: null,
      molecularSieveCycleMonths: null,
      hasSolventSensor: false,
      solventSensorCalibrated: null,
      hasFridge: false,
      fridgeTemp: null,
      hasOilPump: false,
      lastOilChange: null
    }));
  });
});

describe('PUT /boxes/:id', () => {
  test('persists the full field set via Box.update', async () => {
    const res = await agent.put('/boxes/11').type('form').send(fullPayload);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/boxes');
    expect(Box.update).toHaveBeenCalledTimes(1);
    expect(Box.update).toHaveBeenCalledWith(11, COMPANY_ID, expectedMappedData);
  });

  test('validation applies on update too: fridge without temp -> 400', async () => {
    const res = await agent.put('/boxes/11').type('form').send({
      ...fullPayload,
      fridgeTemp: ''
    });
    expect(res.status).toBe(400);
    expect(res.text).toContain('Refrigerator temperature is required.');
    expect(Box.update).not.toHaveBeenCalled();
  });
});

describe('DELETE /boxes/:id', () => {
  test('soft-deletes scoped to the company', async () => {
    const res = await agent.delete('/boxes/11');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/boxes');
    expect(Box.softDelete).toHaveBeenCalledWith(11, COMPANY_ID);
  });
});
