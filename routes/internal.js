// Adressen fuer KeT Management (KET\AUFTRAG 7.9/7.10, mit der KET-Sitzung abgestimmt am 2026-10-01).
// Kein Login/keine Sitzung: Schutz ist der gemeinsame Schluessel im Header X-KeT-Secret (Render-Umgebung
// KET_API_SECRET, in KET in settings.json). Ohne gesetzten Schluessel sind die Adressen ZU (503).
// Die Nutz-Nummer reist nie im Aufruf: die Website liest sie selbst aus der DB.
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const Company = require('../models/company');
const User = require('../models/user');
const emailService = require('../services/email');
const { serviceEmail } = require('../services/access');
const { createLoginLimiter } = require('../services/loginLimiter');

const MIN_SECRET_LENGTH = 32;
const wrongSecret = createLoginLimiter({ maxPerAccount: Infinity, maxPerIp: 20 });   // Durchprobieren bremsen

const randomPassword = () => crypto.randomBytes(18).toString('base64url');   // 24 Zeichen

function checkSecret(req, res, next) {
  const secret = process.env.KET_API_SECRET || '';
  if (secret.length < MIN_SECRET_LENGTH) return res.status(503).json({ ok: false, error: 'not_configured' });
  const who = { ip: req.ip };
  if (wrongSecret.blocked(who)) return res.status(429).json({ ok: false, error: 'too_many_attempts' });
  const given = Buffer.from(String(req.get('X-KeT-Secret') || ''));
  const expected = Buffer.from(secret);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    wrongSecret.fail(who);
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  next();
}

// Einrichtung laden; nur aktive mit Nummer. Antwortet selbst bei Fehlern, gibt sonst die Einrichtung zurueck.
async function loadActiveCompany(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ ok: false, error: 'invalid_id' }); return null; }
  const company = await Company.findById(id);
  if (!company) { res.status(404).json({ ok: false, error: 'not_found' }); return null; }
  if (company.status !== 'active') { res.status(409).json({ ok: false, error: 'not_active' }); return null; }
  if (!company.access_code) { res.status(409).json({ ok: false, error: 'no_access_code' }); return null; }
  return company;
}

// Freigeschaltet bzw. neue Nummer: service-Benutzer sicherstellen, Mail mit der aktuellen Nummer an die
// admins — je Nummer hoechstens einmal (Company.claimNotification), wiederholbar ohne Doppel.
function notifyHandler({ isNewCode }) {
  return async (req, res) => {
    try {
      const company = await loadActiveCompany(req, res);
      if (!company) return;
      const code = company.access_code;
      const serviceUser = await User.ensureServiceUser(company.id, serviceEmail(company.id), randomPassword());

      if (!(await Company.claimNotification(company.id, code))) {
        return res.json({ ok: true, mailSent: false, alreadyNotified: true, serviceUser });
      }
      const admins = await User.findAdminEmailsByCompany(company.id);
      if (!admins.length) {
        await Company.releaseNotification(company.id, code);
        return res.json({ ok: true, mailSent: false, reason: 'no_admin_user', serviceUser });
      }
      try {
        await emailService.sendAccessCodeEmail(admins, company.name, code, { isNewCode });
      } catch (err) {
        console.error('[KET-Adresse] Mail fehlgeschlagen:', err.message);
        await Company.releaseNotification(company.id, code);
        return res.status(502).json({ ok: false, error: 'mail_failed', serviceUser });
      }
      res.json({ ok: true, mailSent: true, serviceUser });
    } catch (err) {
      console.error('[KET-Adresse] Fehler:', err.message);
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  };
}

router.use(checkSecret);

// POST /internal/companies/:id/activated
router.post('/companies/:id/activated', notifyHandler({ isNewCode: false }));

// POST /internal/companies/:id/code-changed
router.post('/companies/:id/code-changed', notifyHandler({ isNewCode: true }));

// POST /internal/companies/:id/service-password — neues Passwort, einmal zurueck, gespeichert nur als Hash
router.post('/companies/:id/service-password', async (req, res) => {
  try {
    const company = await loadActiveCompany(req, res);
    if (!company) return;
    const login = serviceEmail(company.id);
    await User.ensureServiceUser(company.id, login, randomPassword());
    const serviceUser = await User.findServiceUser(company.id);
    if (!serviceUser) return res.status(500).json({ ok: false, error: 'server_error' });
    const password = randomPassword();
    await User.updatePassword(serviceUser.id, password);
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, login, password });
  } catch (err) {
    console.error('[KET-Adresse] Fehler:', err.message);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// Einrichtung löschen "als hätte es sie nie gegeben" (Betreiber 01.10.2026): nur Website-Daten, in KET bleibt alles.
// Nur pending/rejected/suspended — aktive zuerst sperren (409 is_active). Zweiter Aufruf: 404 not_found.
// Keine Mails, keine anderen Nebenwirkungen. Antwort: {ok:true, deleted:{tabelle: anzahl, ...}}
router.post('/companies/:id/delete', checkSecret, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, error: 'invalid_id' });
  try {
    const out = await Company.deleteCompletely(id);
    if (out.result === 'not_found') return res.status(404).json({ ok: false, error: 'not_found' });
    if (out.result === 'is_active') return res.status(409).json({ ok: false, error: 'is_active' });
    console.log('[KET] Einrichtung geloescht', id, JSON.stringify(out.counts));
    res.json({ ok: true, deleted: out.counts });
  } catch (err) {
    console.error('[KET] Loeschen fehlgeschlagen', id, err.message);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

module.exports = router;
