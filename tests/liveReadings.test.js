/**
 * In-memory live values of the temperature sensors (services/liveReadings.js).
 * Live values are NOT written to the DB every 5 s; only the history is (per box interval, E-19).
 */
const live = require('../services/liveReadings');

const T0 = 1_800_000_000_000;
const sec = s => T0 + s * 1000;

beforeEach(() => live.reset());

describe('record / get', () => {
  test('a fresh value is returned with its age', () => {
    live.record(5, '740B3B', 4.2, sec(0));
    expect(live.get(5, sec(3))).toEqual({ serial: '740B3B', temp: 4.2, ageSeconds: 3, fresh: true });
  });

  test('after 20 s without a new value it is no longer fresh (missing beats wrong)', () => {
    live.record(5, '740B3B', 4.2, sec(0));
    expect(live.get(5, sec(20)).fresh).toBe(true);
    expect(live.get(5, sec(21)).fresh).toBe(false);
  });

  test('unknown box -> null', () => {
    expect(live.get(99, sec(0))).toBeNull();
  });

  test('boxes are kept apart', () => {
    live.record(5, '740B3B', 4.2, sec(0));
    live.record(6, 'AAAAAA', -18, sec(0));
    expect(live.get(5, sec(1)).temp).toBe(4.2);
    expect(live.get(6, sec(1)).temp).toBe(-18);
  });
});

describe('dueForHistory', () => {
  test('first value is due, the next one only after the interval (minus 5 s tolerance)', () => {
    expect(live.dueForHistory(5, 1, sec(0))).toBe(true);
    expect(live.dueForHistory(5, 1, sec(30))).toBe(false);
    expect(live.dueForHistory(5, 1, sec(54))).toBe(false);
    expect(live.dueForHistory(5, 1, sec(55))).toBe(true);
  });

  test('uses the box interval', () => {
    expect(live.dueForHistory(5, 15, sec(0))).toBe(true);
    expect(live.dueForHistory(5, 15, sec(600))).toBe(false);
    expect(live.dueForHistory(5, 15, sec(895))).toBe(true);
  });
});

