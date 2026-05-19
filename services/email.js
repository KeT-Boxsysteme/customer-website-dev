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

async function sendWelcomeEmail(toEmail, companyName) {
  await transporter.sendMail({
    from: FROM,
    to: toEmail,
    subject: 'Welcome to Glovebox-Monitoring by KeT',
    html: `
      <h2>Welcome to Glovebox-Monitoring by KeT</h2>
      <p>Your account for <strong>${companyName}</strong> has been successfully created.</p>
      <p>You can now log in at <a href="${process.env.APP_URL || 'https://glovebox-monitoring.com'}/auth/login">Glovebox-Monitoring</a>.</p>
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
      <p><strong>Company:</strong> ${companyName}</p>
      <p><strong>Type:</strong> ${companyType}</p>
      <p><strong>Contact:</strong> ${contactEmail}</p>
    `
  });
}

async function sendPasswordResetEmail(toEmail, resetToken) {
  const resetUrl = `${process.env.APP_URL || 'https://glovebox-monitoring.com'}/auth/reset-password/${resetToken}`;
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

async function sendUserCreatedEmail(toEmail, companyName) {
  await transporter.sendMail({
    from: FROM,
    to: toEmail,
    subject: 'Your account has been created – Glovebox-Monitoring by KeT',
    html: `
      <h2>Account Created</h2>
      <p>An account has been created for you in the Glovebox-Monitoring system of <strong>${companyName}</strong>.</p>
      <p>Please contact your administrator for your login credentials.</p>
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
      <p><strong>Box Project Number:</strong> ${projectNumber}</p>
      <p><strong>Submitted by:</strong> ${userEmail}</p>
      <hr>
      <p>${message.replace(/\n/g, '<br>')}</p>
    `
  });
}

module.exports = {
  sendWelcomeEmail,
  sendNewRegistrationToKeT,
  sendPasswordResetEmail,
  sendUserCreatedEmail,
  sendContactMessage
};
