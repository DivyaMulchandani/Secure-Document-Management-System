'use strict';

const express = require('express');
const { getHealth } = require('./permissions.controller');

const router = express.Router();

router.get('/health', getHealth);

module.exports = router;
