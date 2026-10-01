const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: parseInt(process.env.EMAIL_PORT) || 587,
  secure: process.env.EMAIL_SECURE === 'true',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

const FROM = `"Glovebox-Monitoring by KeT" <${process.env.EMAIL_USER}>`;
const KET_EMAIL = process.env.KET_EMAIL;
const APP_URL = process.env.APP_URL || 'https://glovebox-monitoring.com';

// Eingaben von Kunden (Firmenname, Nachricht) nie als HTML in Mails (Fund 01.10.: vorher ungeprueft eingesetzt)
function escapeHtml(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function sendWelcomeEmail(toEmail, companyName) {
  await transporter.sendMail({
    from: FROM,
    to: toEmail,
    subject: 'Welcome to Glovebox-Monitoring by KeT',
    html: `
      <h2>Welcome to Glovebox-Monitoring by KeT</h2>
      <p>Thank you for registering <strong>${escapeHtml(companyName)}</strong>.</p>
      <p>KeT will review your registration. Once your access is approved, you will receive a second email
         with your 6-digit access number, which you need together with your email and password to log in.</p>
      <br>
      <p>Best regards,<br>The KeT Team</p>
    `
  });
}

async function sendNewRegistrationToKeT(companyName, companyType, contactEmail) {
  await transporter.sendMail({
    from: FROM,
    to: KET_EMAIL,
    subject: `New Registration: ${companyName}`,
    html: `
      <h2>New Customer Registration</h2>
      <p><strong>Company:</strong> ${escapeHtml(companyName)}</p>
      <p><strong>Type:</strong> ${escapeHtml(companyType)}</p>
      <p><strong>Contact:</strong> ${escapeHtml(contactEmail)}</p>
      <p>Approve or reject the registration in KeT Management.</p>
    `
  });
}

async function sendPasswordResetEmail(toEmail, resetToken) {
  const resetUrl = `${APP_URL}/auth/reset-password/${resetToken}`;
  await transporter.sendMail({
    from: FROM,
    to: toEmail,
    subject: 'Password Reset – Glovebox-Monitoring by KeT',
    html: `
      <h2>Password Reset</h2>
      <p>You requested a password reset. Click the link below to set a new password:</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>
      <p>This link expires in 1 hour. If you did not request a reset, please ignore this email.</p>
    `
  });
}

// 7.3: die Mail an neu angelegte Benutzer enthaelt die Nutz-Nummer der Einrichtung
async function sendUserCreatedEmail(toEmail, companyName, accessCode) {
  const codeLine = accessCode
    ? `<p>Access number of your organization: <strong>${escapeHtml(accessCode)}</strong><br>
       You need it together with your email and password to log in.</p>`
    : '';
  await transporter.sendMail({
    from: FROM,
    to: toEmail,
    subject: 'Your account has been created – Glovebox-Monitoring by KeT',
    html: `
      <h2>Account Created</h2>
      <p>An account has been created for you in the Glovebox-Monitoring system of <strong>${escapeHtml(companyName)}</strong>.</p>
      ${codeLine}
      <p>Please contact your administrator for your password.</p>
    `
  });
}

// 7.2 / 7.6: Zugang freigeschaltet bzw. neue Nutz-Nummer — an die admins der Einrichtung
async function sendAccessCodeEmail(toEmails, companyName, accessCode, { isNewCode = false } = {}) {
  const intro = isNewCode
    ? `A new access number has been issued for <strong>${escapeHtml(companyName)}</strong>. The previous number no longer works.`
    : `Access to Glovebox-Monitoring has been approved for <strong>${escapeHtml(companyName)}</strong>.`;
  await transporter.sendMail({
    from: FROM,
    to: toEmails.join(', '),
    subject: isNewCode
      ? 'Your new access number – Glovebox-Monitoring by KeT'
      : 'Your access has been approved – Glovebox-Monitoring by KeT',
    html: `
      <h2>${isNewCode ? 'New access number' : 'Access approved'}</h2>
      <p>${intro}</p>
      <p>Access number of your organization:
         <strong style="font-size:18px;letter-spacing:2px">${escapeHtml(accessCode)}</strong></p>
      <p>Log in with your email, your password and this number at
         <a href="${APP_URL}/auth/login">Glovebox-Monitoring</a>.
         Please share the number with the colleagues in your organization who use the system.</p>
      <br>
      <p>Best regards,<br>The KeT Team</p>
    `
  });
}

async function sendContactMessage(projectNumber, userEmail, message) {
  await transporter.sendMail({
    from: FROM,
    to: KET_EMAIL,
    replyTo: userEmail,
    subject: `Service Request – Box ${projectNumber}`,
    html: `
      <h2>Service Request from Customer</h2>
      <p><strong>Box Project Number:</strong> ${escapeHtml(projectNumber)}</p>
      <p><strong>Submitted by:</strong> ${escapeHtml(userEmail)}</p>
      <hr>
      <p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>
    `
  });
}

module.exports = {
  escapeHtml,
  sendWelcomeEmail,
  sendNewRegistrationToKeT,
  sendPasswordResetEmail,
  sendUserCreatedEmail,
  sendAccessCodeEmail,
  sendContactMessage
};
