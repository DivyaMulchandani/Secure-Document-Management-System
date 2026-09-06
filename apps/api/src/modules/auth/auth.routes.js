'use strict';

const express = require('express');
const { getHealth } = require('./auth.controller');

const router = express.Router();

router.get('/health', getHealth);

module.exports = router;
