// Vercel serverless entry point: the static portal is served by Vercel's CDN and every
// /api/* and /uploads/* request is routed here to the shared Express app.
module.exports = require('../backend/server.js');
