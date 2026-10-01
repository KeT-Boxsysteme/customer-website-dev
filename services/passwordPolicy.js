// Passwort-Regel (Betreiber 01.10.): mind. 10 Zeichen, Gross- und Kleinbuchstabe, Ziffer, Sonderzeichen.
// Gilt, wo ein MENSCH ein Passwort setzt (Registrierung, Benutzer anlegen, Reset). Bestehende Passwoerter
// bleiben gueltig. Das zufaellige service-Passwort (routes/internal.js) faellt nicht darunter.
const MIN_LENGTH = 10;

const PASSWORD_HINT = 'At least 10 characters, with an upper case letter, a lower case letter, a digit and a special character.';

// null = in Ordnung, sonst die Meldung fuer den Nutzer
function passwordProblem(pw) {
  const s = typeof pw === 'string' ? pw : '';
  if (s.length < MIN_LENGTH) return 'Password must be at least 10 characters long.';
  if (!/[A-Z]/.test(s)) return 'Password must contain an upper case letter.';
  if (!/[a-z]/.test(s)) return 'Password must contain a lower case letter.';
  if (!/[0-9]/.test(s)) return 'Password must contain a digit.';
  if (!/[^A-Za-z0-9]/.test(s)) return 'Password must contain a special character.';
  return null;
}

module.exports = { passwordProblem, PASSWORD_HINT, MIN_LENGTH };
