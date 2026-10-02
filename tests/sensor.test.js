/**
 * Pure rule: what happens to a box's temperature sensor when the box form is saved.
 * (Vault: Entscheidungen E-16/E-17, Bluetooth-Fuehler)
 */
const { decideSensorUpdate } = require('../services/sensor');
const { normalizeSerial } = require('../public/js/bluedan');

describe('normalizeSerial', () => {
  test('accepts 6 hex digits in any case and returns upper case', () => {
    expect(normalizeSerial('740b3b')).toBe('740B3B');
    expect(normalizeSerial(' 740B3B ')).toBe('740B3B');
  });
  test('rejects everything else', () => {
    ['', '740B3', '740B3BA', '74XB3B', null, undefined, 740].forEach(v => expect(normalizeSerial(v)).toBeNull());
  });
});

describe('decideSensorUpdate', () => {
  test('fridge switched off -> sensor is removed, even if a serial was sent', () => {
    expect(decideSensorUpdate({ hasFridge: false, raw: '740B3B' })).toEqual({ action: 'clear' });
    expect(decideSensorUpdate({ hasFridge: false, raw: undefined })).toEqual({ action: 'clear' });
  });
  test('fridge on and field not sent -> sensor untouched (missing is not "remove")', () => {
    expect(decideSensorUpdate({ hasFridge: true, raw: undefined })).toEqual({ action: 'keep' });
  });
  test('fridge on and field emptied -> sensor removed', () => {
    expect(decideSensorUpdate({ hasFridge: true, raw: '' })).toEqual({ action: 'clear' });
  });
  test('fridge on and valid serial -> set, normalised', () => {
    expect(decideSensorUpdate({ hasFridge: true, raw: '740b3b' })).toEqual({ action: 'set', serial: '740B3B', storeMinutes: 1 });
  });
  test('fridge on and garbage -> error, nothing to write', () => {
    const r = decideSensorUpdate({ hasFridge: true, raw: 'nonsense' });
    expect(r.action).toBe('error');
    expect(r.serial).toBeUndefined();
  });
});

const { STORE_MINUTES, storeWindowSeconds, validateReading } = require('../services/sensor');

describe('storage interval (E-19)', () => {
  test('offered intervals are exactly 1, 5, 10, 15, 30, 60 minutes', () => {
    expect(STORE_MINUTES).toEqual([1, 5, 10, 15, 30, 60]);
  });

  test('set: chosen interval is stored with the sensor', () => {
    expect(decideSensorUpdate({ hasFridge: true, raw: '740B3B', rawMinutes: '5' }))
      .toEqual({ action: 'set', serial: '740B3B', storeMinutes: 5 });
  });

  test('set without a chosen interval -> default 1 minute', () => {
    expect(decideSensorUpdate({ hasFridge: true, raw: '740B3B', rawMinutes: undefined }))
      .toEqual({ action: 'set', serial: '740B3B', storeMinutes: 1 });
    expect(decideSensorUpdate({ hasFridge: true, raw: '740B3B', rawMinutes: '' }))
      .toEqual({ action: 'set', serial: '740B3B', storeMinutes: 1 });
  });

  test('interval outside the offered list -> error, nothing to write', () => {
    expect(decideSensorUpdate({ hasFridge: true, raw: '740B3B', rawMinutes: '7' }).action).toBe('error');
    expect(decideSensorUpdate({ hasFridge: true, raw: '740B3B', rawMinutes: 'abc' }).action).toBe('error');
  });

  test('a stored reading blocks the next one for the interval minus 5 s tolerance', () => {
    expect(storeWindowSeconds(1)).toBe(55);
    expect(storeWindowSeconds(5)).toBe(295);
    expect(storeWindowSeconds(null)).toBe(55);   // no interval stored yet -> default 1 min
    expect(storeWindowSeconds(7)).toBe(55);      // unknown value never widens the gap
  });
});

describe('validateReading', () => {
  test('plausible fridge/freezer/room temperatures pass, rounded to 0.1', () => {
    expect(validateReading(26.8)).toBe(26.8);
    expect(validateReading('-18.54')).toBe(-18.5);
    expect(validateReading(-100)).toBe(-100);
    expect(validateReading(150)).toBe(150);
  });
  test('implausible or missing values are rejected (missing beats wrong)', () => {
    [-100.1, 150.1, 'abc', '', null, undefined, NaN, Infinity].forEach(v => expect(validateReading(v)).toBeNull());
  });
});

describe('sanitizeHubDiag – connection counters sent along with each value (measuring instrument, 01.10.)', () => {
  const { sanitizeHubDiag } = require('../services/sensor');
  test('keeps whole non-negative counters and a short error text', () => {
    expect(sanitizeHubDiag({ drops: 3, attempts: 7, lastError: 'NetworkError: GATT Server is disconnected.' }))
      .toEqual({ drops: 3, attempts: 7, lastError: 'NetworkError: GATT Server is disconnected.' });
  });
  test('garbage is dropped, long text cut, missing -> null', () => {
    expect(sanitizeHubDiag({ drops: -1, attempts: 'x', lastError: 'e'.repeat(500), evil: 1 }))
      .toEqual({ drops: null, attempts: null, lastError: 'e'.repeat(120) });
    expect(sanitizeHubDiag(undefined)).toBeNull();
    expect(sanitizeHubDiag('x')).toBeNull();
  });
});

describe('sanitizeHubReport – state report of the background hub, sent every 15 s (measuring instrument, 01.10.)', () => {
  const { sanitizeHubReport } = require('../services/sensor');
  const full = {
    supported: true, role: 'owner', devicesKnown: 2, listVerdict: 'list',
    sensors: [{ serial: '740b3b', adopted: true, connected: false, attempts: 12, drops: 1, renewals: 2,
                adverts: 0, watch: 'on', lastError: 'NetworkError: Connection attempt failed.', lastValueAgeS: null }]
  };
  test('positive list of fields, serial normalised', () => {
    expect(sanitizeHubReport(full)).toEqual({
      supported: true, role: 'owner', devicesKnown: 2, listVerdict: 'list',
      sensors: [{ serial: '740B3B', adopted: true, connected: false, attempts: 12, drops: 1, renewals: 2,
                  adverts: 0, watch: 'on', lastError: 'NetworkError: Connection attempt failed.', lastValueAgeS: null }]
    });
  });
  test('unknown fields dropped, bad values null, at most 10 sensors, long texts cut', () => {
    const r = sanitizeHubReport({ ...full, evil: 1, role: 'x'.repeat(50),
      sensors: Array.from({ length: 20 }, () => ({ serial: 'zzz', attempts: -3, watch: 'w'.repeat(200) })) });
    expect(r.evil).toBeUndefined();
    expect(r.role).toHaveLength(20);
    expect(r.sensors).toHaveLength(10);
    expect(r.sensors[0]).toMatchObject({ serial: null, attempts: null });
    expect(r.sensors[0].watch).toHaveLength(60);
  });
  test('no object -> null', () => {
    expect(sanitizeHubReport(null)).toBeNull();
    expect(sanitizeHubReport('x')).toBeNull();
    expect(sanitizeHubReport({ x: '' })).toBeNull();   // Formular-Muell ohne Fuehlerliste
  });
});

describe('which sensor is this? fridge or box temperature (E-34)', () => {
  const { sensorKindFor, sensorConflict } = require('../services/sensor');
  const box = { has_fridge: 1, sensor_serial: '740B3B', box_sensor_serial: 'A1B2C3' };
  test('fridge sensor -> fridge, box sensor -> box, anything else -> not this box', () => {
    expect(sensorKindFor(box, '740B3B')).toBe('fridge');
    expect(sensorKindFor(box, 'A1B2C3')).toBe('box');
    expect(sensorKindFor(box, 'FFFFFF')).toBeNull();
  });
  test('fridge sensor on a box without fridge does not count; box sensor needs no fridge', () => {
    expect(sensorKindFor({ ...box, has_fridge: 0 }, '740B3B')).toBeNull();
    expect(sensorKindFor({ ...box, has_fridge: 0 }, 'A1B2C3')).toBe('box');
  });
  test('one sensor cannot be fridge AND box sensor of the same box', () => {
    expect(sensorConflict({ action: 'set', serial: '740B3B' }, { action: 'set', serial: '740B3B' })).toBe(true);
    expect(sensorConflict({ action: 'set', serial: '740B3B' }, { action: 'set', serial: 'A1B2C3' })).toBe(false);
    expect(sensorConflict({ action: 'clear' }, { action: 'set', serial: '740B3B' })).toBe(false);
  });
});
