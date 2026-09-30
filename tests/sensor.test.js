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
