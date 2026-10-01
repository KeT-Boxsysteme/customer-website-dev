/**
 * Deleting a company "as if it never existed" (Betreiber 01.10.2026 via KET; only website data — nothing in KET).
 * services/companyDeletion.js holds the plan as data; these tests check it against database/schema.sql so a new
 * table with a foreign key to companies/users/boxes cannot be forgotten.
 */
const fs = require('fs');
const path = require('path');
const { PLAN, buildDeletionSql } = require('../services/companyDeletion');

const schema = fs.readFileSync(path.join(__dirname, '../database/schema.sql'), 'utf8');
// table -> referenced parents, from "CREATE TABLE x ( ... REFERENCES y(id) ... )"
const fks = {};
for (const m of schema.matchAll(/CREATE TABLE (\w+)\s*\(([\s\S]*?)\n\s*\);?/g)) {
  fks[m[1]] = [...m[2].matchAll(/REFERENCES (\w+)\(/g)].map(r => r[1]);
}
const COMPANY_TREE = ['companies', 'users', 'boxes'];
const stepOf = table => PLAN.findIndex(s => s.table === table);

test('every table that points at companies/users/boxes is in the plan', () => {
  const needed = Object.entries(fks).filter(([, parents]) => parents.some(p => COMPANY_TREE.includes(p))).map(([t]) => t);
  expect(needed.length).toBeGreaterThan(3);   // Probe: der Parser findet die Fremdschluessel wirklich
  for (const t of [...needed, ...COMPANY_TREE]) expect(stepOf(t)).toBeGreaterThanOrEqual(0);
});

test('children are handled before their parents (FK-safe order), companies last', () => {
  for (const [table, parents] of Object.entries(fks)) {
    if (stepOf(table) < 0) continue;
    for (const p of parents) if (stepOf(p) >= 0) expect(stepOf(table)).toBeLessThan(stepOf(p));
  }
  expect(PLAN[PLAN.length - 1].table).toBe('companies');
});

test('login sessions of the company are removed (session store has no foreign key)', () => {
  expect(stepOf('sessions')).toBeGreaterThanOrEqual(0);
  expect(PLAN[stepOf('sessions')].sql).toMatch(/JSON_VALUE\(session, '\$\.user\.companyId'\)/);
});

test('rows of OTHER companies are never deleted: user references there are only detached', () => {
  const detach = PLAN.filter(s => /^UPDATE/.test(s.sql));
  expect(detach.map(s => s.table).sort()).toEqual(['alert_acks', 'measurements']);
  for (const s of PLAN.filter(s => /^DELETE/.test(s.sql) && ['measurements', 'alert_acks'].includes(s.table))) {
    expect(s.sql).not.toMatch(/user_id|acked_by/);   // geloescht wird nur ueber die eigenen Boxen
  }
});

test('one transaction, row lock, status gate and counts in the generated SQL', () => {
  const q = buildDeletionSql();
  expect(q).toMatch(/SET XACT_ABORT ON;\s*BEGIN TRANSACTION;/);
  expect(q).toMatch(/WITH \(UPDLOCK, HOLDLOCK\)/);
  expect(q).toMatch(/@status = 'active'/);
  expect(q).toMatch(/COMMIT TRANSACTION;/);
  for (const s of PLAN) expect(q).toContain(s.sql);
  expect((q.match(/@@ROWCOUNT/g) || []).length).toBe(PLAN.length);
});
