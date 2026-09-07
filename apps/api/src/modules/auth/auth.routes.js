'use strict';

const express = require('express');
const controller = require('./auth.controller');
const validate = require('../../middleware/validate');
const requireAuth = require('../../middleware/require-auth');
const schemas = require('./auth.validation');

const router = express.Router();

router.get('/health', controller.getHealth);

router.post('/login', validate({ body: schemas.loginBodySchema }), controller.login);
router.post('/refresh', controller.refresh);
router.post('/logout', requireAuth, controller.logout);

router.post('/mfa/enroll', requireAuth, controller.enrollMfa);
router.post(
  '/mfa/verify',
  requireAuth,
  validate({ body: schemas.mfaVerifyBodySchema }),
  controller.verifyMfa,
);

router.get('/me', requireAuth, controller.getMe);

module.exports = router;
