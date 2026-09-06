'use strict';

const cors = require('cors');
const config = require('../config');

module.exports = cors({
  origin: config.server.corsOrigin,
  credentials: true,
});
