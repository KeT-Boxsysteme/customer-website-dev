/**
 * Data script for existing companies (KET\AUFTRAG 7.8) — dry run is the default, target and cutoff are mandatory.
 */
const { run, parseArgs } = require('../scripts/activate-existing');

function fakePool({ todo }) {
  const calls = [];
  let remaining = todo;
  return {
    calls,
    request() {
      const inputs = {};
      const r = {
        input(n, _t, v) { inputs[n] = v; return r; },
        async query(text) {
          calls.push({ text, inputs });
          if (/^\s*SELECT COUNT/.test(text)) return { recordset: [{ n: remaining }] };
          remaining -= 1;
          return { rowsAffected: [1] };
        }
      };
      return r;
    }
  };
}
const sql = { DateTime2: 'dt2', Char: () => 'char' };
const env = { DB_SERVER: 'srv', DB_DATABASE: 'KeT-Dev-Website' };
const args = (o = {}) => ({ db: 'KeT-Dev-Website', bis: '2026-10-01T12:00:00Z', apply: false, ...o });

test('dry run writes nothing and reports the count', async () => {
  const pool = fakePool({ todo: 2 });
  const out = await run({ pool, sql, args: args(), env, log: () => {} });
  expect(out).toEqual({ todo: 2, done: 0 });
  expect(pool.calls.some(c => /UPDATE/.test(c.text))).toBe(false);
});

test('--apply activates each company once, with a 6-digit number, no mail (notified_code), only before the cutoff', async () => {
  const pool = fakePool({ todo: 2 });
  const out = await run({ pool, sql, args: args({ apply: true }), env, log: () => {} });
  expect(out).toEqual({ todo: 2, done: 2 });
  const updates = pool.calls.filter(c => /UPDATE/.test(c.text));
  expect(updates).toHaveLength(2);
  updates.forEach(u => {
    expect(u.inputs.code).toMatch(/^[1-9][0-9]{5}$/);
    expect(u.inputs.bis.toISOString()).toBe('2026-10-01T12:00:00.000Z');
    expect(u.text).toMatch(/notified_code = @code/);
    expect(u.text).toMatch(/created_at < @bis/);
  });
});

test('wrong or missing target, missing cutoff -> refuses before any query', async () => {
  for (const a of [args({ db: 'Other' }), args({ db: null }), args({ bis: null }), args({ bis: 'kein-datum' })]) {
    const pool = fakePool({ todo: 1 });
    await expect(run({ pool, sql, args: a, env, log: () => {} })).rejects.toThrow();
    expect(pool.calls).toHaveLength(0);
  }
});

test('parseArgs', () => {
  expect(parseArgs(['--db=X', '--bis=2026-10-01', '--apply'])).toEqual({ db: 'X', bis: '2026-10-01', apply: true });
});
