/**
 * Password rule (Betreiber 01.10.): at least 10 characters, upper case, lower case, digit, special character.
 * Applies when a person sets a password (register, create user, reset). Existing passwords stay valid.
 */
const { passwordProblem, PASSWORD_HINT } = require('../services/passwordPolicy');

test('a password meeting all rules passes', () => {
  expect(passwordProblem('Admin1234!')).toBeNull();
  expect(passwordProblem('Glovebox#2026')).toBeNull();
});

test('each missing rule is rejected', () => {
  expect(passwordProblem('Ab1!short')).toMatch(/10 characters/);   // 9 Zeichen
  expect(passwordProblem('admin1234!')).toMatch(/upper/);
  expect(passwordProblem('ADMIN1234!')).toMatch(/lower/);
  expect(passwordProblem('Adminabcd!')).toMatch(/digit/);
  expect(passwordProblem('Admin12345')).toMatch(/special/);
});

test('empty / missing -> rejected', () => {
  expect(passwordProblem('')).not.toBeNull();
  expect(passwordProblem(undefined)).not.toBeNull();
});

test('the hint shown in the forms names all rules', () => {
  ['10', 'upper', 'lower', 'digit', 'special'].forEach(w => expect(PASSWORD_HINT).toMatch(new RegExp(w, 'i')));
});
