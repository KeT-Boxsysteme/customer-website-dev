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
    expect(decideSensorUpdate({ hasFridge: true, raw: '740b3b' })).toEqual({ action: 'set', serial: '740B3B' });
  });
  test('fridge on and garbage -> error, nothing to write', () => {
    const r = decideSensorUpdate({ hasFridge: true, raw: 'nonsense' });
    expect(r.action).toBe('error');
    expect(r.serial).toBeUndefined();
  });
});
