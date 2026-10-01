// Anmeldung pruefen — und ob sie noch gilt (KET\AUFTRAG Abschnitt 3: Sperre wirkt auch auf laufende Sitzungen).
// Je Benutzer hoechstens alle 30 s ein DB-Blick (das Tablet fragt alle 5 s). Ist die DB gerade nicht
// erreichbar, endet die Sitzung NICHT: eine Stoerung ist kein Befund (Azure pausiert; sonst flöge das
// Tablet raus und der Fuehler wuerde getrennt).
const User = require('../models/user');
const { sessionStillValid } = require('../services/access');

const CHECK_EVERY_MS = 30 * 1000;
const checked = new Map();   // userId -> { at, valid }

function clearCache() { checked.clear(); }

async function stillValid(sessionUser) {
  const hit = checked.get(sessionUser.id);
  if (hit && Date.now() - hit.at < CHECK_EVERY_MS) return hit.valid;
  try {
    const valid = sessionStillValid(await User.sessionState(sessionUser.id), sessionUser.accessCode);
    checked.set(sessionUser.id, { at: Date.now(), valid });
    return valid;
  } catch (err) {
    console.error('[Sitzungspruefung] DB nicht erreichbar, Sitzung bleibt:', err.message);
    return true;
  }
}

async function requireAuth(req, res, next) {
  if (!req.session.user) {
    req.flash('error', 'Please log in to continue.');
    return res.redirect('/auth/login');
  }
  if (!(await stillValid(req.session.user))) {
    checked.delete(req.session.user.id);
    req.session.user = null;
    req.flash('error', 'Your access has ended. Please log in again or contact KeT.');
    return res.redirect('/auth/login');
  }
  next();
}

module.exports = { requireAuth, clearCache };
