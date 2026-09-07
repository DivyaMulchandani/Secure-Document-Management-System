'use strict';

const nodemailer = require('nodemailer');
const config = require('../../config');
const logger = require('../../logger');

/**
 * config.mail.host === '' is the signal to run in disabled/log-only
 * mode — no transporter is even constructed, so there's no ambiguity
 * about whether a connection was attempted.
 */
let transporter = null;
if (config.mail.host) {
  transporter = nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    secure: config.mail.secure,
    auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
  });
}

/**
 * @param {{to: string, subject: string, text: string, html?: string}} message
 * @returns {Promise<{sent: boolean}>} NEVER throws — disabled mode and
 *   any send error both resolve to `{sent: false}` after logging, so
 *   callers (e.g. the invite flow) are always safe to call this even
 *   with no SMTP server reachable (CI, offline dev).
 */
async function sendMail({ to, subject, text, html }) {
  if (!transporter) {
    logger.warn({ to, subject }, '[mail] disabled — skipping send (SMTP_HOST not set)');
    return { sent: false };
  }
  try {
    await transporter.sendMail({ from: config.mail.from, to, subject, text, html });
    return { sent: true };
  } catch (err) {
    logger.warn({ err, to, subject }, '[mail] send failed — continuing without email');
    return { sent: false };
  }
}

/**
 * @param {{to: string, activationUrl: string}} params
 */
async function sendInvitationEmail({ to, activationUrl }) {
  return sendMail({
    to,
    subject: 'You have been invited to Secure DMS',
    text: `You've been invited to Secure DMS. Activate your account: ${activationUrl}`,
    html: `<p>You've been invited to Secure DMS.</p><p><a href="${activationUrl}">Activate your account</a></p>`,
  });
}

module.exports = { sendMail, sendInvitationEmail };
