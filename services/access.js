// Zugangsregeln fuer Freischaltung + Nutz-Nummer (KET\AUFTRAG_Website-Freischaltung.txt, Abschnitte 3/4/7).
// Reine Funktionen — Login-Route, Sitzungspruefung und Benutzerverwaltung rufen sie nur auf.
const crypto = require('crypto');

const CODE_PATTERN = /^[1-9][0-9]{5}$/;   // 7.7: 100000–999999, wie der CHECK in database/schema.sql

const ROLE = { ADMIN: 'admin', CONTROLLER: 'controller', USER: 'user', BOX_USER: 'box_user', SERVICE: 'service' };
// Rollen, die Kunden vergeben duerfen; "service" ist intern (7.10)
const CUSTOMER_ROLES = [ROLE.ADMIN, ROLE.CONTROLLER, ROLE.USER, ROLE.BOX_USER];

function normalizeCode(input) {
  if (input === null || input === undefined) return null;
  const s = String(input).replace(/\s+/g, '');
  return CODE_PATTERN.test(s) ? s : null;
}

function sameCode(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// 'ok' | 'invalid' | 'pending' | 'rejected' | 'suspended'.
// Der Status wird erst NACH richtigem Passwort verraten (sonst liesse sich abfragen, wer registriert ist).
function loginDecision({ user, passwordOk, code }) {
  if (!user || !passwordOk || !user.is_active) return 'invalid';
  if (user.company_status === 'pending') return 'pending';
  if (user.company_status === 'rejected') return 'rejected';
  if (user.company_status === 'suspended') return 'suspended';
  if (user.company_status !== 'active') return 'invalid';
  return sameCode(normalizeCode(code), user.company_access_code) ? 'ok' : 'invalid';
}

// Laufende Sitzung: Benutzer aktiv, Einrichtung aktiv, Nummer unveraendert (neue Nummer = alte Sitzungen enden)
function sessionStillValid(state, sessionCode) {
  return !!state && !!state.is_active && state.company_status === 'active'
    && sameCode(sessionCode, state.company_access_code);
}

function hasAdminRights(role) {
  return role === ROLE.ADMIN || role === ROLE.SERVICE;   // 7.10: service = gleiche Rechte wie admin
}

function canAssignRole(actorRole, role) {
  if (role === ROLE.SERVICE) return actorRole === ROLE.SERVICE;
  return CUSTOMER_ROLES.includes(role);
}

// 7.13: service-Benutzer fuer Kunden sichtbar, aber nicht aenderbar
function canManageUser(actorRole, target) {
  return target.role !== ROLE.SERVICE || actorRole === ROLE.SERVICE;
}

function serviceEmail(companyId) {
  return `service-${companyId}@ketbox.de`;
}

module.exports = {
  ROLE, CUSTOMER_ROLES, CODE_PATTERN,
  normalizeCode, sameCode, loginDecision, sessionStillValid,
  hasAdminRights, canAssignRole, canManageUser, serviceEmail
};
