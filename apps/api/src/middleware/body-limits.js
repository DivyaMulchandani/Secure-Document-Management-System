'use strict';

const express = require('express');
const config = require('../config');

const json = express.json({ limit: config.server.bodyLimit });
const urlencoded = express.urlencoded({ extended: true, limit: config.server.bodyLimit });

module.exports = [json, urlencoded];
