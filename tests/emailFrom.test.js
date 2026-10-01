/**
 * Sender address (Fund via KET session 01.10.): with Resend the SMTP user is "resend", not an address.
 * EMAIL_FROM sets the sender; without it EMAIL_USER stays the sender (Strato setup unchanged).
 */
const sent = [];
jest.mock('nodemailer', () => ({ createTransport: () => ({ sendMail: async m => { sent.push(m); } }) }));

function loadWith(env) {
  jest.resetModules();
  sent.length = 0;
  const saved = { EMAIL_FROM: process.env.EMAIL_FROM, EMAIL_USER: process.env.EMAIL_USER };
  Object.assign(process.env, env);
  if (!('EMAIL_FROM' in env)) delete process.env.EMAIL_FROM;
  const email = require('../services/email');
  return { email, restore: () => { process.env.EMAIL_USER = saved.EMAIL_USER; if (saved.EMAIL_FROM === undefined) delete process.env.EMAIL_FROM; else process.env.EMAIL_FROM = saved.EMAIL_FROM; } };
}

test('EMAIL_FROM set -> mails come from that address (Resend: EMAIL_USER is "resend")', async () => {
  const { email, restore } = loadWith({ EMAIL_USER: 'resend', EMAIL_FROM: 'noreply@ketbox.de' });
  await email.sendWelcomeEmail('a@b.de', 'X');
  restore();
  expect(sent[0].from).toBe('"Glovebox-Monitoring by KeT" <noreply@ketbox.de>');
});

test('EMAIL_FROM not set -> EMAIL_USER stays the sender (Strato unchanged)', async () => {
  const { email, restore } = loadWith({ EMAIL_USER: 'software@ketbox.de' });
  await email.sendWelcomeEmail('a@b.de', 'X');
  restore();
  expect(sent[0].from).toBe('"Glovebox-Monitoring by KeT" <software@ketbox.de>');
});

test('REPLY_TO set -> customer mails carry it as Reply-To (replies reach the real mailbox)', async () => {
  const { email, restore } = loadWith({ EMAIL_USER: 'resend', EMAIL_FROM: 'ket@glovebox-monitoring.de', REPLY_TO: 'software@ketbox.de' });
  await email.sendWelcomeEmail('a@b.de', 'X');
  await email.sendPasswordResetEmail('a@b.de', 'f'.repeat(64));
  restore(); delete process.env.REPLY_TO;
  expect(sent.map(m => m.replyTo)).toEqual(['software@ketbox.de', 'software@ketbox.de']);
});

test('REPLY_TO not set -> no Reply-To header', async () => {
  delete process.env.REPLY_TO;
  const { email, restore } = loadWith({ EMAIL_USER: 'software@ketbox.de' });
  await email.sendWelcomeEmail('a@b.de', 'X');
  restore();
  expect(sent[0].replyTo).toBeUndefined();
});
