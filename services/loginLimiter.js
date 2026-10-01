// Sperre gegen Durchprobieren beim Login (AUFTRAG Abschnitt 6: die 6-stellige Nutz-Nummer schuetzt nur
// zusammen mit einer Sperre). Zaehlt Fehlversuche je Konto UND je IP in einem gleitenden Fenster.
// Im Arbeitsspeicher: ein Server-Neustart setzt die Zaehler zurueck (bewusst einfach, ein Server).
function createLoginLimiter({ now = () => Date.now(), maxPerAccount = 5, maxPerIp = 30, windowMs = 15 * 60 * 1000 } = {}) {
  const fails = new Map();   // key -> [Zeitpunkte]

  const keysFor = ({ email, ip }) => [
    email ? ['acct:' + String(email).trim().toLowerCase(), maxPerAccount] : null,
    ip ? ['ip:' + ip, maxPerIp] : null
  ].filter(Boolean);

  function recent(key) {
    const t = now();
    const list = (fails.get(key) || []).filter(ts => t - ts <= windowMs);
    if (list.length) fails.set(key, list); else fails.delete(key);
    return list;
  }

  return {
    blocked(who) { return keysFor(who).some(([key, max]) => recent(key).length >= max); },
    fail(who) { keysFor(who).forEach(([key]) => fails.set(key, [...recent(key), now()])); },
    succeed({ email }) { if (email) fails.delete('acct:' + String(email).trim().toLowerCase()); }
  };
}

module.exports = { createLoginLimiter };
