'use strict';
// Vercel serverless entry — tüm HTTP istekleri bu express app'e düşer.
const app = require('../server');

module.exports = app;