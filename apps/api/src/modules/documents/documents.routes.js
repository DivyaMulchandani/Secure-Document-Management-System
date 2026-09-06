'use strict';

const express = require('express');
const { getHealth } = require('./documents.controller');

const router = express.Router();

router.get('/health', getHealth);

module.exports = router;
