/**
 * Gyro Spotlight Tracker — local relay server.
 */

const os = require('os');
const path = require('path');
const https = require('https');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const selfsigned = require('selfsigned');

const PORT = parseInt(process.env.PORT, 10) || 3000;

const SETTINGS_DEFAULTS = {
  pointerSensitivityX: 58,
  pointerSensitivityY: 52,
  invertX: true,
  invertY: true,
  deadZoneX: 0,
  deadZoneY: 0,
  orientationEmaGamma: 0.65,
  orientationEmaBeta: 0.6,
  pointerFollowRate: 28,
  oneEuroMinCutoffX: 3.5,
  oneEuroMinCutoffY: 3.5,
  oneEuroBeta: 2.5,
  oneEuroDCutoff: 1.0,
  useOneEuro: true,
};

const SETTINGS_RANGES = {
  pointerSensitivityX: [1, 200],
  pointerSensitivityY: [1, 200],
  deadZoneX: [0, 2],
  deadZoneY: [0, 2],
  orientationEmaGamma: [0.05, 1],
  orientationEmaBeta: [0.05, 1],
  pointerFollowRate: [8, 60],
  oneEuroMinCutoffX: [0.05, 5],
  oneEuroMinCutoffY: [0.05, 5],
  oneEuroBeta: [0, 10],
  oneEuroDCutoff: [0.1, 5],
};

const state = {
  isPhoneConnected: false,
  isCalibrated: false,
  centerBeta: null,
  centerGamma: null,
  centerAlpha: null,
  settings: { ...SETTINGS_DEFAULTS },
  auraActive: false,
  expandActive: false,
  currentOrientation: {
    beta: 90,
    gamma: 0,
    alpha: 0,
  },
};

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function isValidBeta(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= -180 && v <= 180;
}

function isValidGamma(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= -90 && v <= 90;
}

function isValidOrientation(data) {
  return data && typeof data === 'object' && isValidBeta(data.beta) && isValidGamma(data.gamma);
}

function buildOrientationPayload(data) {
  return {
    beta: data.beta,
    gamma: data.gamma,
    alpha: typeof data.alpha === 'number' && Number.isFinite(data.alpha) ? data.alpha : 0,
    t: typeof data.t === 'number' && Number.isFinite(data.t) && data.t >= 0 ? data.t : null,
  };
}

function clampSetting(key, value) {
  const range = SETTINGS_RANGES[key];
  if (!range) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return clamp(value, range[0], range[1]);
}

function detectLanIp() {
  const candidates = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces || []) {
      if (iface.family === 'IPv4' && !iface.internal) candidates.push(iface.address);
    }
  }
  const isPrivate = (ip) =>
    ip.startsWith('192.168.') ||
    ip.startsWith('10.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
  return candidates.find(isPrivate) || candidates[0] || '127.0.0.1';
}

const lanIp = detectLanIp();
const mobileUrl = `https://${lanIp}:${PORT}/mobile`;

const pems = selfsigned.generate(
  [{ name: 'commonName', value: lanIp }],
  {
    days: 365,
    keySize: 2048,
    extensions: [
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
          { type: 7, ip: lanIp },
        ],
      },
    ],
  }
);

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/mobile', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'mobile.html')));

const httpServer = https.createServer({ key: pems.private, cert: pems.cert }, app);
const io = new Server(httpServer);

let qrDataUrl = null;
let phoneSocketId = null;

function broadcastState() {
  io.emit('state_update', state);
}

io.on('connection', (socket) => {
  socket.emit('init', { state, qrDataUrl, mobileUrl });

  socket.on('phone_connected', () => {
    phoneSocketId = socket.id;
    state.isPhoneConnected = true;
    broadcastState();
    console.log(`[phone] connected (${socket.id})`);
  });

  socket.on('orientation_update', (data) => {
    if (!isValidOrientation(data)) return;
    const payload = buildOrientationPayload(data);
    state.currentOrientation = payload;
    socket.broadcast.emit('orientation_update', payload);
  });

  socket.on('calibrate_center', (data, ack) => {
    if (socket.id !== phoneSocketId) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Phone only.' });
      return;
    }
    if (!isValidOrientation(data)) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Invalid orientation.' });
      return;
    }
    state.centerBeta = data.beta;
    state.centerGamma = data.gamma;
    state.centerAlpha = typeof data.alpha === 'number' && Number.isFinite(data.alpha) ? data.alpha : 0;
    state.isCalibrated = true;
    broadcastState();
    io.emit('recenter');
    if (typeof ack === 'function') ack({ ok: true });
    console.log(
      `[pointer] center α=${state.centerAlpha.toFixed(1)}° β=${data.beta.toFixed(1)}° γ=${data.gamma.toFixed(1)}°`
    );
  });

  socket.on('effect_burst', (_data, ack) => {
    if (socket.id !== phoneSocketId) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Phone only.' });
      return;
    }
    socket.broadcast.emit('effect_burst', { t: Date.now() });
    if (typeof ack === 'function') ack({ ok: true });
    console.log('[effect] burst');
  });

  socket.on('effect_expand', (data, ack) => {
    if (socket.id !== phoneSocketId) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Phone only.' });
      return;
    }
    const active = !!(data && data.active);
    state.expandActive = active;
    socket.broadcast.emit('effect_expand', { active });
    if (typeof ack === 'function') ack({ ok: true });
    console.log(`[effect] expand ${active ? 'on' : 'off'}`);
  });

  socket.on('effect_aura', (data, ack) => {
    if (socket.id !== phoneSocketId) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Phone only.' });
      return;
    }
    const active = !!(data && data.active);
    state.auraActive = active;
    broadcastState();
    socket.broadcast.emit('effect_aura', { active });
    if (typeof ack === 'function') ack({ ok: true });
    console.log(`[effect] aura ${active ? 'on' : 'off'}`);
  });

  socket.on('disconnect', () => {
    if (socket.id === phoneSocketId) {
      phoneSocketId = null;
      state.isPhoneConnected = false;
      state.expandActive = false;
      broadcastState();
      console.log('[phone] disconnected');
    }
  });

  socket.on('update_settings', ({ key, value }, ack) => {
    if (key === 'useOneEuro') {
      state.settings.useOneEuro = !!value;
      broadcastState();
      if (typeof ack === 'function') ack({ ok: true, settings: state.settings });
      return;
    }
    if (key === 'invertX' || key === 'invertY') {
      state.settings[key] = !!value;
      broadcastState();
      if (typeof ack === 'function') ack({ ok: true, settings: state.settings });
      return;
    }
    const clamped = clampSetting(key, value);
    if (clamped === null || !(key in SETTINGS_DEFAULTS)) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Invalid setting.' });
      return;
    }
    state.settings[key] = clamped;
    broadcastState();
    if (typeof ack === 'function') ack({ ok: true, settings: state.settings });
    console.log(`[settings] ${key} = ${clamped}`);
  });
});

if (require.main === module) {
  QRCode.toDataURL(mobileUrl, { margin: 1, width: 512, errorCorrectionLevel: 'M' })
    .then((dataUrl) => {
      qrDataUrl = dataUrl;
      httpServer.listen(PORT, '0.0.0.0', () => {
        console.log('Gyro Spotlight Tracker');
        console.log(`  Desktop (projector): https://${lanIp}:${PORT}/`);
        console.log(`  Mobile  (remote):    ${mobileUrl}`);
        console.log('  Accept the self-signed certificate warning on both devices.');
      });
    })
    .catch((err) => {
      console.error('Failed to generate QR code:', err);
      process.exit(1);
    });
}

module.exports = {
  httpServer,
  io,
  state,
  buildOrientationPayload,
  SETTINGS_DEFAULTS,
  PORT,
};
