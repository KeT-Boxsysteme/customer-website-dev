/**
 * Meldungen (Flash) nach einer Aktion (Betreiber 01.10.2026: Bestaetigung verschwand nicht / kam nicht an).
 * Gemessen im echten Chrome: (1) die Weiterleitung ging raus, bevor die Meldung in der Sitzung gespeichert war,
 * (2) die naechste Hintergrund-Abfrage (/sensors, /live alle 5 s) hat die Meldung verbraucht.
 */
const { flashMiddleware } = require('../middleware/flash');
const ejs = require('ejs');
const path = require('path');

// Kleine Attrappe: Sitzung mit connect-flash-artigem req.flash
function fakeReq(flash = {}) {
  const session = { flash: { ...flash } };
  return {
    session,
    flash(type, msg) {
      if (msg !== undefined) { (session.flash[type] = session.flash[type] || []).push(msg); return; }
      const out = session.flash[type] || [];
      delete session.flash[type];
      return out;
    }
  };
}
function fakeRes() {
  const calls = [];
  return {
    calls, locals: {},
    render(view, opts) { calls.push(['render', view, { success: this.locals.success, error: this.locals.error }]); },
    redirect(url) { calls.push(['redirect', url]); }
  };
}
const run = (req, res) => { let ok = false; flashMiddleware(req, res, () => { ok = true; }); expect(ok).toBe(true); };

describe('a message is only used up by a page that shows it', () => {
  test('a JSON/poll request (no render) leaves the message in the session', () => {
    const req = fakeReq({ success: ['Your message has been sent to KeT.'] });
    run(req, fakeRes());
    expect(req.session.flash.success).toEqual(['Your message has been sent to KeT.']);
  });

  test('rendering a page hands the message to the view and removes it from the session', () => {
    const req = fakeReq({ success: ['Saved.'], error: ['Oops.'] });
    const res = fakeRes();
    run(req, res);
    res.render('monitoring/detail', {});
    expect(res.calls[0][2]).toEqual({ success: ['Saved.'], error: ['Oops.'] });
    expect(req.session.flash.success).toBeUndefined();
    expect(req.session.flash.error).toBeUndefined();
  });

  test('errors a route set itself (form validation) are kept and come first', () => {
    const req = fakeReq({ error: ['From flash.'] });
    const res = fakeRes();
    run(req, res);
    res.locals.error = ['Box alias is required.'];
    res.render('boxes/form', {});
    expect(res.calls[0][2].error).toEqual(['Box alias is required.', 'From flash.']);
  });

  test('page without messages: empty lists (views can rely on them)', () => {
    const res = fakeRes();
    run(fakeReq(), res);
    res.render('x', {});
    expect(res.calls[0][2]).toEqual({ success: [], error: [] });
  });
});

describe('redirect waits until the message is stored', () => {
  test('pending message: session is saved BEFORE the redirect goes out', () => {
    const req = fakeReq();
    let saved = null;
    req.session.save = cb => { saved = cb; };
    const res = fakeRes();
    run(req, res);
    req.flash('error', 'Message cannot be empty.');
    res.redirect('/monitoring/2');
    expect(res.calls).toEqual([]);            // noch nicht weitergeleitet
    saved();                                  // Speichern fertig
    expect(res.calls).toEqual([['redirect', '/monitoring/2']]);
  });

  test('no pending message: redirect directly, no extra save', () => {
    const req = fakeReq();
    req.session.save = jest.fn();
    const res = fakeRes();
    run(req, res);
    res.redirect('/dashboard');
    expect(req.session.save).not.toHaveBeenCalled();
    expect(res.calls).toEqual([['redirect', '/dashboard']]);
  });

  test('save fails: still redirect (message may be lost, page must not hang)', () => {
    const req = fakeReq();
    req.session.save = cb => cb(new Error('db down'));
    const res = fakeRes();
    run(req, res);
    req.flash('success', 'Saved.');
    res.redirect('/boxes');
    expect(res.calls).toEqual([['redirect', '/boxes']]);
  });
});

describe('notification pill markup', () => {
  const render = locals => ejs.renderFile(path.join(__dirname, '../views/partials/flash.ejs'), locals);

  test('confirmation: polite status pill that closes itself, no close button needed', async () => {
    const html = await render({ success: ['Your message has been sent to KeT.'], error: [] });
    expect(html).toMatch(/class="toast toast--success"[^>]*role="status"[^>]*data-autoclose/);
    expect(html).toContain('Your message has been sent to KeT.');
    expect(html).not.toMatch(/toast--success[\s\S]*toast__close/);
  });

  test('error: alert pill that stays and has a close button', async () => {
    const html = await render({ success: [], error: ['Could not send message.'] });
    expect(html).toMatch(/class="toast toast--error"[^>]*role="alert"/);
    expect(html).not.toMatch(/toast--error"[^>]*data-autoclose/);
    expect(html).toMatch(/<button[^>]*class="toast__close"[^>]*aria-label="Dismiss"/);
  });

  test('every message is shown, not only the first; nothing rendered without messages', async () => {
    const html = await render({ success: [], error: ['A.', 'B.'] });
    expect((html.match(/toast--error/g) || []).length).toBe(2);
    expect((await render({ success: [], error: [] })).trim()).not.toMatch(/toast--/);
  });
});
