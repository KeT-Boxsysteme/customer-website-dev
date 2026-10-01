/**
 * Login sessions in the database (Betreiber 01.10.): measured that every server restart (deploy,
 * Render waking up) logged everybody out → the background hub dropped the sensor. services/sessionStore.js
 * keeps sessions in dbo.sessions on the shared, self-healing pool (config/database.js).
 */
let mockCalls = [];
let mockRows = [];
let mockFail = false;
jest.mock('../config/database', () => ({
  getPool: jest.fn(async () => {
    if (mockFail) throw new Error('db down');
    return {
      request() {
        const inputs = {};
        const r = {
          input(name, _type, value) { inputs[name] = value; return r; },
          async query(text) { mockCalls.push({ text, inputs }); return { recordset: mockRows, rowsAffected: [mockRows.length] }; }
        };
        return r;
      }
    };
  }),
  sql: { NVarChar: () => 'nvarchar', MAX: 'max', DateTime2: 'datetime2' }
}));

const { DbSessionStore, sessionStoreFor } = require('../services/sessionStore');
const call = (store, method, ...args) => new Promise((resolve, reject) =>
  store[method](...args, (err, val) => (err ? reject(err) : resolve(val))));

beforeEach(() => { mockCalls = []; mockRows = []; mockFail = false; });

describe('DbSessionStore', () => {
  test('get: stored session comes back as object; unknown sid -> null', async () => {
    const store = new DbSessionStore();
    mockRows = [{ session: JSON.stringify({ user: { id: 1 }, cookie: { maxAge: 1 } }) }];
    expect(await call(store, 'get', 'abc')).toEqual({ user: { id: 1 }, cookie: { maxAge: 1 } });
    expect(mockCalls[0].inputs.sid).toBe('abc');
    mockRows = [];
    expect(await call(store, 'get', 'nope')).toBeNull();
  });

  test('get only returns sessions that have not expired (now is passed in, not the DB clock)', async () => {
    const now = new Date('2026-10-01T10:00:00Z');
    const store = new DbSessionStore({ now: () => now });
    await call(store, 'get', 'abc');
    expect(mockCalls[0].inputs.now).toEqual(now);
    expect(mockCalls[0].text).toMatch(/expires\s*>\s*@now/);
  });

  test('set: writes the session with the cookie expiry', async () => {
    const store = new DbSessionStore();
    const expires = new Date('2026-10-02T10:00:00Z');
    await call(store, 'set', 'abc', { user: { id: 1 }, cookie: { expires } });
    const write = mockCalls.find(c => c.inputs.sid === 'abc' && c.inputs.session);
    expect(JSON.parse(write.inputs.session).user).toEqual({ id: 1 });
    expect(write.inputs.expires).toEqual(expires);
  });

  test('destroy: removes exactly this sid (logout)', async () => {
    const store = new DbSessionStore();
    await call(store, 'destroy', 'abc');
    expect(mockCalls).toHaveLength(1);
    expect(mockCalls[0].inputs.sid).toBe('abc');
    expect(mockCalls[0].text).toMatch(/DELETE/i);
  });

  test('touch without a later expiry writes nothing (DB may rest; tablet polls every 5 s)', async () => {
    const store = new DbSessionStore();
    const expires = new Date('2026-10-02T10:00:00Z');
    mockRows = [{ session: JSON.stringify({ cookie: { expires } }) }];
    await call(store, 'get', 'abc');
    mockCalls = [];
    await call(store, 'touch', 'abc', { cookie: { expires } });
    expect(mockCalls).toHaveLength(0);
  });

  test('touch with a later expiry (e.g. rolling sessions) does write', async () => {
    const store = new DbSessionStore();
    await call(store, 'touch', 'abc', { cookie: { expires: new Date('2026-10-03T10:00:00Z') } });
    expect(mockCalls).toHaveLength(1);
    expect(mockCalls[0].text).toMatch(/UPDATE/i);
  });

  test('expired sessions are cleaned up at most once per hour, on a write (no timer that wakes the DB)', async () => {
    let t = new Date('2026-10-01T10:00:00Z').getTime();
    const store = new DbSessionStore({ now: () => new Date(t) });
    const cookie = { expires: new Date(t + 86400000) };
    const cleanups = () => mockCalls.filter(c => /DELETE/i.test(c.text) && !c.inputs.sid).length;
    await call(store, 'set', 'a', { cookie });
    expect(cleanups()).toBe(1);
    t += 30 * 60 * 1000;
    await call(store, 'set', 'b', { cookie });
    expect(cleanups()).toBe(1);
    t += 31 * 60 * 1000;
    await call(store, 'set', 'c', { cookie });
    expect(cleanups()).toBe(2);
  });

  test('DB error is passed to the callback, never thrown (server must not crash)', async () => {
    const store = new DbSessionStore();
    mockFail = true;
    await expect(call(store, 'get', 'abc')).rejects.toThrow('db down');
    await expect(call(store, 'set', 'abc', { cookie: {} })).rejects.toThrow('db down');
  });
});

describe('sessionStoreFor', () => {
  test('production and development use the DB store; tests keep the memory store', () => {
    expect(sessionStoreFor('production')).toBeInstanceOf(DbSessionStore);
    expect(sessionStoreFor('development')).toBeInstanceOf(DbSessionStore);
    expect(sessionStoreFor(undefined)).toBeInstanceOf(DbSessionStore);
    expect(sessionStoreFor('test')).toBeUndefined();
  });
});
