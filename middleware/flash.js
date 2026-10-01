// Meldungen nach einer Aktion (Flash) — eine Stelle fuer Lesen und Weiterleiten (Betreiber 01.10.2026).
// Gemessen im echten Chrome (Monitoring, "Send Message to KeT"):
//  1. Die Weiterleitung ging raus, bevor die Meldung in der Sitzung (DB) gespeichert war — das sofortige
//     Neuladen sah sie noch nicht. -> Bei offener Meldung erst speichern, dann weiterleiten.
//  2. Jede Anfrage hat die Meldung verbraucht, auch Hintergrund-Abfragen (/live, /sensors alle 5 s), die
//     nichts anzeigen. -> Verbraucht wird sie nur von einer Seite, die gerendert wird.
// Braucht connect-flash davor (req.flash).

function hasPending(req) {
  const f = req.session && req.session.flash;
  return !!f && Object.keys(f).some(k => Array.isArray(f[k]) && f[k].length > 0);
}

function flashMiddleware(req, res, next) {
  const render = res.render;
  res.render = function (...args) {
    // Fehler, die eine Route selbst gesetzt hat (Formularpruefung), bleiben und stehen vorne
    res.locals.success = [...(res.locals.success || []), ...req.flash('success')];
    res.locals.error = [...(res.locals.error || []), ...req.flash('error')];
    return render.apply(this, args);
  };

  const redirect = res.redirect;
  res.redirect = function (...args) {
    if (!hasPending(req) || typeof req.session.save !== 'function') return redirect.apply(this, args);
    // Speichern scheitert: trotzdem weiterleiten (Meldung evtl. verloren, Seite darf nicht haengen)
    req.session.save(() => redirect.apply(this, args));
  };
  next();
}

module.exports = { flashMiddleware };
