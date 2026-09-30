/**
 * State key of the monitoring page (services/boxState.js). Fund 01.10.: the page reloaded every
 * 15 minutes because of a time window in the key — now the key only changes when the state does.
 */
const boxState = require('../services/boxState');
const a = (key, severity = 'yellow') => ({ key, severity });

beforeEach(() => boxState.reset());

describe('stateKey', () => {
  test('same alerts -> same key, no matter how much time passes', () => {
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(Date.UTC(2026, 9, 1, 10, 0));
    const k1 = boxState.stateKey(1, [a('oil_change')]);
    now.mockReturnValue(Date.UTC(2026, 9, 1, 11, 30));
    const k2 = boxState.stateKey(1, [a('oil_change')]);
    now.mockRestore();
    expect(k2).toBe(k1);
  });

  test('a maintenance alert becoming due changes the key (no write needed)', () => {
    expect(boxState.stateKey(1, [a('oil_change')])).not.toBe(boxState.stateKey(1, []));
  });

  test('fridge level changes the key', () => {
    expect(boxState.stateKey(1, [a('fridge_temp', 'red')])).not.toBe(boxState.stateKey(1, [a('fridge_temp', 'yellow')]));
  });

  test('ppm alerts are ignored (they only change through a write, which bumps the version)', () => {
    expect(boxState.stateKey(1, [a('o2_high', 'red'), a('h2o_elevated')])).toBe(boxState.stateKey(1, []));
  });

  test('order of alerts does not matter; a write (bump) changes the key', () => {
    const k = boxState.stateKey(1, [a('oil_change'), a('fridge_temp', 'red')]);
    expect(boxState.stateKey(1, [a('fridge_temp', 'red'), a('oil_change')])).toBe(k);
    boxState.bump(1);
    expect(boxState.stateKey(1, [a('oil_change'), a('fridge_temp', 'red')])).not.toBe(k);
  });
});
