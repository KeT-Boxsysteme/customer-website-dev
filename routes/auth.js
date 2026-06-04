const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const User = require('../models/user');
const Company = require('../models/company');
const emailService = require('../services/email');

// Einfacher In-Memory Token Store – später in DB auslagern
const resetTokens = new Map();

// GET /auth/login
router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.render('auth/login', { title: 'Login' });
});

// POST /auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      req.flash('error', 'Please enter email and password.');
      return res.redirect('/auth/login');
    }

    const user = await User.findByEmail(email.trim().toLowerCase());
    if (!user) {
      req.flash('error', 'Invalid email or password.');
      return res.redirect('/auth/login');
    }

    const valid = await User.verifyPassword(password, user.password_hash);
    if (!valid) {
      req.flash('error', 'Invalid email or password.');
      return res.redirect('/auth/login');
    }

    req.session.user = {
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
    console.error(err);
    req.flash('error', 'Login failed. Please try again.');
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
    if (password !== passwordConfirm) {
      req.flash('error', 'Passwords do not match.');
      return res.redirect('/auth/register');
    }
    if (username && username.length > 4) {
      req.flash('error', 'Username must be max. 4 characters.');
      return res.redirect('/auth/register');
    }

    const existingUser = await User.findByEmail(email.trim().toLowerCase());
    if (existingUser) {
      req.flash('error', 'An account with this email already exists.');
      return res.redirect('/auth/register');
    }

    const finalDepartment = department === 'other' ? departmentOther : department;

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

    req.flash('success', 'Registration successful! Please log in.');
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
      const token = crypto.randomBytes(32).toString('hex');
      resetTokens.set(token, { userId: user.id, expires: Date.now() + 3600000 });
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
router.get('/reset-password/:token', (req, res) => {
  const entry = resetTokens.get(req.params.token);
  if (!entry || entry.expires < Date.now()) {
    req.flash('error', 'This reset link is invalid or has expired.');
    return res.redirect('/auth/forgot-password');
  }
  res.render('auth/reset-password', { title: 'Set New Password', token: req.params.token });
});

// POST /auth/reset-password/:token
router.post('/reset-password/:token', async (req, res) => {
  try {
    const entry = resetTokens.get(req.params.token);
    if (!entry || entry.expires < Date.now()) {
      req.flash('error', 'This reset link is invalid or has expired.');
      return res.redirect('/auth/forgot-password');
    }

    const { password, passwordConfirm } = req.body;
    if (password !== passwordConfirm) {
      req.flash('error', 'Passwords do not match.');
      return res.redirect(`/auth/reset-password/${req.params.token}`);
    }

    await User.updatePassword(entry.userId, password);
    resetTokens.delete(req.params.token);

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
