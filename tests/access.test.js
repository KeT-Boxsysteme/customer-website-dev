/**
 * Access rules for the approval + access number (Nutz-Nummer) package — pure functions, no DB.
 * Source: KET\AUFTRAG_Website-Freischaltung.txt (sections 3, 4, 7), Betreiber 2026-09-30.
 */
const access = require('../services/access');
const { createLoginLimiter } = require('../services/loginLimiter');

const user = (o = {}) => ({ is_active: 1, company_status: 'active', company_access_code: '482913', ...o });

describe('normalizeCode', () => {
  test('accepts 6 digits without leading zero, tolerates spaces', () => {
    expect(access.normalizeCode('482913')).toBe('482913');
    expect(access.normalizeCode(' 482 913 ')).toBe('482913');
  });
  test('rejects everything else (7.7: 100000–999999)', () => {
    ['', null, undefined, '012345', '48291', '4829133', 'abcdef', '48291x'].forEach(v =>
      expect(access.normalizeCode(v)).toBeNull());
  });
});

describe('loginDecision', () => {
  test('active company + matching number + correct password -> ok', () => {
    expect(access.loginDecision({ user: user(), passwordOk: true, code: '482913' })).toBe('ok');
  });

  test('wrong number, unknown user, wrong password -> the same "invalid" (no hint what was wrong)', () => {
    expect(access.loginDecision({ user: user(), passwordOk: true, code: '111111' })).toBe('invalid');
    expect(access.loginDecision({ user: null, passwordOk: false, code: '482913' })).toBe('invalid');
    expect(access.loginDecision({ user: user(), passwordOk: false, code: '482913' })).toBe('invalid');
    expect(access.loginDecision({ user: user(), passwordOk: true, code: null })).toBe('invalid');
  });

  test('status is only revealed after a correct password (no account probing)', () => {
    expect(access.loginDecision({ user: user({ company_status: 'pending', company_access_code: null }), passwordOk: true, code: null })).toBe('pending');
    expect(access.loginDecision({ user: user({ company_status: 'rejected', company_access_code: null }), passwordOk: true, code: null })).toBe('rejected');
    expect(access.loginDecision({ user: user({ company_status: 'suspended' }), passwordOk: true, code: '482913' })).toBe('suspended');
    expect(access.loginDecision({ user: user({ company_status: 'pending', company_access_code: null }), passwordOk: false, code: null })).toBe('invalid');
  });

  test('a number of ANOTHER company does not open this one (tenant lock)', () => {
    expect(access.loginDecision({ user: user({ company_access_code: '482913' }), passwordOk: true, code: '777777' })).toBe('invalid');
  });
});

describe('sessionStillValid (running sessions, section 3)', () => {
  const state = (o = {}) => ({ is_active: 1, company_status: 'active', company_access_code: '482913', ...o });
  test('active user, active company, same number -> valid', () => {
    expect(access.sessionStillValid(state(), '482913')).toBe(true);
  });
  test('suspended company, deleted user, new number, no row -> session ends', () => {
    expect(access.sessionStillValid(state({ company_status: 'suspended' }), '482913')).toBe(false);
    expect(access.sessionStillValid(state({ is_active: 0 }), '482913')).toBe(false);
    expect(access.sessionStillValid(state({ company_access_code: '555555' }), '482913')).toBe(false);
    expect(access.sessionStillValid(null, '482913')).toBe(false);
  });
});

describe('roles: service is internal (7.10, 7.13)', () => {
  test('customers can assign the four customer roles, never "service" or unknown values', () => {
    ['admin', 'controller', 'user', 'box_user'].forEach(r => expect(access.canAssignRole('admin', r)).toBe(true));
    expect(access.canAssignRole('admin', 'service')).toBe(false);
    expect(access.canAssignRole('admin', 'superadmin')).toBe(false);
    expect(access.canAssignRole('service', 'service')).toBe(true);
  });
  test('a service user is visible but cannot be changed by customer admins', () => {
    expect(access.canManageUser('admin', { role: 'service' })).toBe(false);
    expect(access.canManageUser('admin', { role: 'user' })).toBe(true);
    expect(access.canManageUser('service', { role: 'service' })).toBe(true);
  });
  test('service has admin rights', () => {
    expect(access.hasAdminRights('service')).toBe(true);
    expect(access.hasAdminRights('admin')).toBe(true);
    expect(access.hasAdminRights('controller')).toBe(false);
  });
  test('service login name uses the internal company id (7.10)', () => {
    expect(access.serviceEmail(17)).toBe('service-17@ketbox.de');
  });
});

describe('login limiter (section 6: number only helps together with a rate limit)', () => {
  const make = () => {
    let t = 0;
    const lim = createLoginLimiter({ now: () => t, maxPerAccount: 5, maxPerIp: 30, windowMs: 15 * 60 * 1000 });
    return { lim, advance: ms => { t += ms; } };
  };

  test('5 failures for one account block that account, not others', () => {
    const { lim } = make();
    for (let i = 0; i < 5; i++) lim.fail({ email: 'a@x.de', ip: '1.1.1.1' });
    expect(lim.blocked({ email: 'a@x.de', ip: '2.2.2.2' })).toBe(true);
    expect(lim.blocked({ email: 'b@x.de', ip: '2.2.2.2' })).toBe(false);
  });

  test('4 failures do not block; success clears the account counter', () => {
    const { lim } = make();
    for (let i = 0; i < 4; i++) lim.fail({ email: 'a@x.de', ip: '1.1.1.1' });
    expect(lim.blocked({ email: 'a@x.de', ip: '1.1.1.1' })).toBe(false);
    lim.succeed({ email: 'a@x.de' });
    lim.fail({ email: 'a@x.de', ip: '1.1.1.1' });
    expect(lim.blocked({ email: 'a@x.de', ip: '1.1.1.1' })).toBe(false);
  });

  test('30 failures from one IP across accounts block that IP', () => {
    const { lim } = make();
    for (let i = 0; i < 30; i++) lim.fail({ email: `u${i}@x.de`, ip: '9.9.9.9' });
    expect(lim.blocked({ email: 'new@x.de', ip: '9.9.9.9' })).toBe(true);
    expect(lim.blocked({ email: 'new@x.de', ip: '8.8.8.8' })).toBe(false);
  });

  test('the block ends after the window', () => {
    const { lim, advance } = make();
    for (let i = 0; i < 5; i++) lim.fail({ email: 'a@x.de', ip: '1.1.1.1' });
    advance(15 * 60 * 1000 + 1);
    expect(lim.blocked({ email: 'a@x.de', ip: '1.1.1.1' })).toBe(false);
  });

  test('email is compared case-insensitively', () => {
    const { lim } = make();
    for (let i = 0; i < 5; i++) lim.fail({ email: 'A@X.de', ip: '1.1.1.1' });
    expect(lim.blocked({ email: 'a@x.DE', ip: '3.3.3.3' })).toBe(true);
  });
});
