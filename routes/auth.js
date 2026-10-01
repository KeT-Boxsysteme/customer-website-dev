const express = require('express');
const router = express.Router();
const User = require('../models/user');
const Company = require('../models/company');
const emailService = require('../services/email');
const PasswordReset = require('../models/passwordReset');
const { RESET_VALID_MS, newToken, hashToken } = require('../services/resetToken');
const { loginDecision } = require('../services/access');
const { createLoginLimiter } = require('../services/loginLimiter');

// Sperre gegen Durchprobieren: 5 Fehlversuche je Konto bzw. 30 je IP in 15 Minuten (AUFTRAG Abschnitt 6)
const loginLimiter = createLoginLimiter();


// GET /auth/login
router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.render('auth/login', { title: 'Login' });
});

// Login-Meldungen je Entscheidung (services/access.js). 'invalid' verraet nicht, was falsch war.
const LOGIN_MESSAGES = {
  invalid: 'Invalid email, password or access number.',
  pending: 'Your registration is awaiting approval by KeT. You will receive your access number by email.',
  rejected: 'Your registration was not approved. Please contact KeT.',
  suspended: 'Access for your organization is suspended. Please contact KeT.'
};

// POST /auth/login — E-Mail + Passwort + Nutz-Nummer der eigenen Einrichtung (Freischaltung)
router.post('/login', async (req, res) => {
  try {
    const { email, password, accessCode } = req.body;
    if (!email || !password) {
      req.flash('error', 'Please enter email and password.');
      return res.redirect('/auth/login');
    }
    const who = { email, ip: req.ip };
    if (loginLimiter.blocked(who)) {
      req.flash('error', 'Too many failed attempts. Please wait 15 minutes and try again.');
      return res.redirect('/auth/login');
    }

    const user = await User.findByEmail(email.trim().toLowerCase());
    const passwordOk = user ? await User.verifyPassword(password, user.password_hash) : false;
    const decision = loginDecision({ user, passwordOk, code: accessCode });
    if (decision !== 'ok') {
      if (decision === 'invalid') loginLimiter.fail(who);
      req.flash('error', LOGIN_MESSAGES[decision] || LOGIN_MESSAGES.invalid);
      return res.redirect('/auth/login');
    }
    loginLimiter.succeed(who);

    req.session.user = {
      accessCode: user.company_access_code,   // neue Nummer beendet alte Sitzungen (middleware/auth.js)
      id: user.id,
      companyId: user.company_id,
      firstname: user.firstname,
      lastname: user.lastname,
      email: user.email,
      phone: user.phone || null,
      username: user.username,
      department: user.department || null,
      role: user.role
    };

    res.redirect('/dashboard');
  } catch (err) {
    console.error('[Login Error]', err.message);
    const msg = (err.message || '').toLowerCase().includes('not currently available')
      ? 'Database is temporarily unavailable. Please try again in a moment.'
      : 'Login failed. Please try again.';
    req.flash('error', msg);
    res.redirect('/auth/login');
  }
});

// GET /auth/register
router.get('/register', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.render('auth/register', { title: 'Register' });
});

// POST /auth/register
router.post('/register', async (req, res) => {
  try {
    const {
      companyType, companyName, city, street, housenumber, zip,
      firstname, lastname, email, phone, username, department, departmentOther,
      password, passwordConfirm, agb
    } = req.body;

    if (!agb) {
      req.flash('error', 'You must accept the Terms and Conditions.');
      return res.redirect('/auth/register');
    }
    // Serverseitige Pflichtfeld-Pruefung (Client-Validierung kann umgangen werden)
    const requiredFields = { companyType, companyName, city, street, housenumber, zip, firstname, lastname, email, username, department, password };
    if (Object.values(requiredFields).some(v => !v || !String(v).trim())) {
      req.flash('error', 'Please fill in all required fields.');
      return res.redirect('/auth/register');
    }
    if (password !== passwordConfirm) {
      req.flash('error', 'Passwords do not match.');
      return res.redirect('/auth/register');
    }
    if (username.trim().length > 4) {
      req.flash('error', 'Username must be max. 4 characters.');
      return res.redirect('/auth/register');
    }
    if (department === 'other' && (!departmentOther || !departmentOther.trim())) {
      req.flash('error', 'Please specify your position when selecting "Other" as department.');
      return res.redirect('/auth/register');
    }

    const existingUser = await User.findByEmail(email.trim().toLowerCase());
    if (existingUser) {
      req.flash('error', 'An account with this email already exists.');
      return res.redirect('/auth/register');
    }

    const finalDepartment = department === 'other' ? departmentOther.trim() : department;

    const companyId = await Company.create({
      name: companyName, type: companyType,
      city, street, housenumber, zip
    });

    await User.create({
      companyId,
      firstname, lastname,
      email: email.trim().toLowerCase(),
      phone: phone ? phone.trim() : null,
      username: username.toUpperCase(),
      department: finalDepartment,
      role: 'admin',
      password
    });

    await emailService.sendWelcomeEmail(email, companyName).catch(console.error);
    await emailService.sendNewRegistrationToKeT(companyName, companyType, email).catch(console.error);

    // Neue Einrichtungen warten auf Freischaltung durch KeT (status pending, DB-Vorgabe)
    req.flash('success', 'Thank you for registering. KeT will review your registration and send your access number by email once your access is approved.');
    res.redirect('/auth/login');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Registration failed. Please try again.');
    res.redirect('/auth/register');
  }
});

// GET /auth/forgot-password
router.get('/forgot-password', (req, res) => {
  res.render('auth/forgot-password', { title: 'Forgot Password' });
});

// POST /auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findByEmail(email.trim().toLowerCase());

    if (user) {
      // Link ueberlebt Deploys/Neustarts: in der DB, nur als Hash (models/passwordReset.js)
      const token = newToken();
      await PasswordReset.create(user.id, hashToken(token), new Date(Date.now() + RESET_VALID_MS));
      await emailService.sendPasswordResetEmail(user.email, token).catch(console.error);
    }

    // Always show success to prevent email enumeration
    req.flash('success', 'If an account exists for that email, a reset link has been sent.');
    res.redirect('/auth/login');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Something went wrong. Please try again.');
    res.redirect('/auth/forgot-password');
  }
});

// GET /auth/reset-password/:token
router.get('/reset-password/:token', async (req, res) => {
  try {
    if (!(await PasswordReset.findValidUserId(hashToken(req.params.token), new Date()))) {
      req.flash('error', 'This reset link is invalid or has expired.');
      return res.redirect('/auth/forgot-password');
    }
    res.render('auth/reset-password', { title: 'Set New Password', token: req.params.token });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Something went wrong. Please try again.');
    res.redirect('/auth/forgot-password');
  }
});

// POST /auth/reset-password/:token
router.post('/reset-password/:token', async (req, res) => {
  try {
    const tokenHash = hashToken(req.params.token);
    const { password, passwordConfirm } = req.body;
    if (!password || password !== passwordConfirm) {
      // Link NICHT verbrauchen — nur zurueck zum Formular, solange er gueltig ist
      if (!(await PasswordReset.findValidUserId(tokenHash, new Date()))) {
        req.flash('error', 'This reset link is invalid or has expired.');
        return res.redirect('/auth/forgot-password');
      }
      req.flash('error', 'Passwords do not match.');
      return res.redirect(`/auth/reset-password/${req.params.token}`);
    }

    // genau einmal einloesbar (ein bedingtes UPDATE in der DB)
    const userId = await PasswordReset.consume(tokenHash, new Date());
    if (!userId) {
      req.flash('error', 'This reset link is invalid or has expired.');
      return res.redirect('/auth/forgot-password');
    }
    await User.updatePassword(userId, password);

    req.flash('success', 'Password updated successfully. Please log in.');
    res.redirect('/auth/login');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Password reset failed. Please try again.');
    res.redirect('/auth/forgot-password');
  }
});

// GET /auth/logout
router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/auth/login');
  });
});

module.exports = router;
