/**
 * Gyro Spotlight Tracker — local relay server.
 *
 * Serves the desktop renderer at / and the mobile transmitter at /mobile,
 * relays phone orientation data to desktops over Socket.IO, and holds the
 * single shared state object both clients sync against.
 *
 * Runs HTTPS with a boot-time self-signed certificate: iOS only exposes
 * DeviceOrientationEvent.requestPermission() and the Wake Lock API in a
 * secure context, so plain http on a LAN IP would never show the motion
 * permission prompt. Everything still works fully offline.
 */

const os = require('os');
const path = require('path');
const https = require('https');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const selfsigned = require('selfsigned');

const PORT = parseInt(process.env.PORT, 10) || 3000;

// Boundaries closer together than this (shortest arc) are rejected: the
// lerp denominator would be ~0 and the spotlight would jump wildly.
const MIN_CALIBRATION_ARC_DEG = 5;

// ---------------------------------------------------------------------------
// Shared state (single source of truth, mirrored to clients on every change)
// ---------------------------------------------------------------------------
const state = {
  isPhoneConnected: false,
  calibration: {
    isCalibrated: false,
    leftAngle: null,
    rightAngle: null,
  },
  settings: {
    screenWidth: 1920,
    smoothingFactor: 0.1,
  },
  currentAngle: 0,
};

/** Signed shortest-arc difference a - b, normalized to [-180, 180). */
function angleDiff(a, b) {
  return ((a - b + 540) % 360) - 180;
}

function isValidAngle(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 360;
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

// ---------------------------------------------------------------------------
// HTTPS server + static routes
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Socket relay
// ---------------------------------------------------------------------------
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

  socket.on('gyro_update', (angle) => {
    if (!isValidAngle(angle)) return;
    state.currentAngle = angle;
    // Volatile: under congestion, dropping a stale orientation frame is
    // better than queueing it — the next frame supersedes it anyway.
    socket.broadcast.volatile.emit('gyro_update', angle);
  });

  const handleCalibrate = (side) => (angle, ack) => {
    if (!isValidAngle(angle)) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Invalid angle value.' });
      return;
    }
    const cal = state.calibration;
    if (side === 'left') cal.leftAngle = angle;
    else cal.rightAngle = angle;

    let error = null;
    if (cal.leftAngle !== null && cal.rightAngle !== null) {
      const arc = Math.abs(angleDiff(cal.rightAngle, cal.leftAngle));
      if (arc < MIN_CALIBRATION_ARC_DEG) {
        cal.isCalibrated = false;
        error = `Boundaries are only ${arc.toFixed(1)}° apart — move further and try again.`;
      } else {
        cal.isCalibrated = true;
      }
    }
    broadcastState();
    if (typeof ack === 'function') ack({ ok: !error, error, calibration: cal });
    console.log(`[calibrate] ${side} = ${angle.toFixed(1)}°`, cal.isCalibrated ? '(calibrated)' : '');
  };

  socket.on('calibrate_left', handleCalibrate('left'));
  socket.on('calibrate_right', handleCalibrate('right'));

  socket.on('reset_calibration', () => {
    state.calibration = { isCalibrated: false, leftAngle: null, rightAngle: null };
    broadcastState();
    console.log('[calibrate] reset');
  });

  socket.on('disconnect', () => {
    // Calibration is intentionally kept: a phone that drops mid-show can
    // rejoin without forcing the performer to recalibrate.
    if (socket.id === phoneSocketId) {
      phoneSocketId = null;
      state.isPhoneConnected = false;
      broadcastState();
      console.log('[phone] disconnected');
    }
  });
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
QRCode.toDataURL(mobileUrl, { margin: 1, width: 512, errorCorrectionLevel: 'M' })
  .then((dataUrl) => {
    qrDataUrl = dataUrl;
    httpServer.listen(PORT, '0.0.0.0', () => {
      console.log('Gyro Spotlight Tracker');
      console.log(`  Desktop (projector): https://${lanIp}:${PORT}/`);
      console.log(`  Mobile  (performer): ${mobileUrl}`);
      console.log('  Accept the self-signed certificate warning on both devices.');
    });
  })
  .catch((err) => {
    console.error('Failed to generate QR code:', err);
    process.exit(1);
  });
