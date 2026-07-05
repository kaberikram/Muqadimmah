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

const MIN_CALIBRATION_ARC_DEG = 5;
const MIN_POCKET_QUALITY_SPAN = 4;
const ORIENTATION_BUFFER_SIZE = 50;
const MIN_CONFIRM_SAMPLES = 5;

/** Stage marks confirmed from the laptop while the artist stands in place. */
const STAGE_MARKERS = [
  { id: 'left', label: 'Left edge', pct: 0 },
  { id: 'left-center', label: 'Left of center', pct: 0.33 },
  { id: 'right-center', label: 'Right of center', pct: 0.67 },
  { id: 'right', label: 'Right edge', pct: 1 },
];

function createEmptyCalibration() {
  return {
    phase: 'marks',
    isCalibrated: false,
    mappingAxis: 'alpha',
    qualitySpan: null,
    currentStep: 0,
    error: null,
    points: STAGE_MARKERS.map((m) => ({ ...m, snapshot: null })),
    centerAlpha: null,
    centerBeta: null,
  };
}

const state = {
  isPhoneConnected: false,
  trackingMode: 'stage',
  calibration: createEmptyCalibration(),
  settings: {
    screenWidth: 1920,
    stageSmoothingFactor: 0.1,
    pointerSmoothingFactor: 0.15,
    pointerSensitivityX: 50,
    pointerSensitivityY: 40,
    gyroCorrectionGain: 0.03,
  },
  currentOrientation: { alpha: 0, beta: 90, gamma: 0, rotationRate: null },
};

const orientationBuffer = [];

function angleDiff(a, b) {
  return ((a - b + 540) % 360) - 180;
}

function isValidAngle(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 360;
}

function isValidBeta(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= -180 && v <= 180;
}

function isValidGamma(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= -90 && v <= 90;
}

function parseRotationRate(data) {
  const rr = data && data.rotationRate;
  if (!rr || typeof rr !== 'object') return null;
  if (
    typeof rr.alpha !== 'number' ||
    typeof rr.beta !== 'number' ||
    typeof rr.gamma !== 'number' ||
    !Number.isFinite(rr.alpha) ||
    !Number.isFinite(rr.beta) ||
    !Number.isFinite(rr.gamma)
  ) {
    return null;
  }
  return { alpha: rr.alpha, beta: rr.beta, gamma: rr.gamma };
}

function isValidOrientation(data) {
  return (
    data &&
    typeof data === 'object' &&
    isValidAngle(data.alpha) &&
    isValidBeta(data.beta) &&
    isValidGamma(data.gamma)
  );
}

function pushOrientationSample(sample) {
  orientationBuffer.push(sample);
  if (orientationBuffer.length > ORIENTATION_BUFFER_SIZE) {
    orientationBuffer.shift();
  }
}

function circularMeanAlpha(samples) {
  let sinSum = 0;
  let cosSum = 0;
  for (const s of samples) {
    const rad = (s.alpha * Math.PI) / 180;
    sinSum += Math.sin(rad);
    cosSum += Math.cos(rad);
  }
  return ((Math.atan2(sinSum, cosSum) * 180) / Math.PI + 360) % 360;
}

function averageLinear(samples, key) {
  let sum = 0;
  for (const s of samples) sum += s[key];
  return sum / samples.length;
}

function averageOrientationFromBuffer() {
  if (orientationBuffer.length < MIN_CONFIRM_SAMPLES) return null;
  const samples = orientationBuffer.slice();
  return {
    alpha: circularMeanAlpha(samples),
    beta: averageLinear(samples, 'beta'),
    gamma: averageLinear(samples, 'gamma'),
  };
}

function axisDelta(axis, a, b) {
  return axis === 'alpha' ? angleDiff(a, b) : a - b;
}

function axisValuesMonotonic(axis, points) {
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].snapshot[axis];
    const curr = points[i].snapshot[axis];
    const delta = axisDelta(axis, curr, prev);
    if (Math.abs(delta) < 0.3) return false;
    if (i > 1) {
      const prevDelta = axisDelta(axis, prev, points[i - 2].snapshot[axis]);
      if (Math.sign(delta) !== Math.sign(prevDelta)) return false;
    }
  }
  return true;
}

function axisTotalSpan(axis, points) {
  const first = points[0].snapshot;
  const last = points[points.length - 1].snapshot;
  return Math.abs(axisDelta(axis, last[axis], first[axis]));
}

function pickMappingAxis(points) {
  let best = { axis: 'alpha', span: 0 };
  for (const axis of ['alpha', 'beta', 'gamma']) {
    if (!axisValuesMonotonic(axis, points)) continue;
    const span = axisTotalSpan(axis, points);
    if (span > best.span) best = { axis, span };
  }
  return best;
}

function validateStageCalibration(cal) {
  const points = cal.points.filter((p) => p.snapshot);
  if (points.length < cal.points.length) {
    cal.isCalibrated = false;
    return { ok: true, calibrated: false };
  }

  const { axis, span } = pickMappingAxis(points);
  const minSpan = axis === 'alpha' ? MIN_CALIBRATION_ARC_DEG : MIN_POCKET_QUALITY_SPAN;

  if (span < minSpan) {
    cal.isCalibrated = false;
    cal.phase = 'marks';
    cal.mappingAxis = axis;
    cal.qualitySpan = span;
    cal.error =
      span === 0
        ? 'No usable pocket signal — same pocket, face audience center at each mark, then retry.'
        : `Pocket signal too weak (${span.toFixed(1)}° on ${axis}) — use the full stage width.`;
    return { ok: false, calibrated: false, error: cal.error };
  }

  cal.mappingAxis = axis;
  cal.qualitySpan = span;
  cal.error = null;
  cal.phase = 'verify';
  cal.isCalibrated = false;
  return { ok: true, calibrated: false, phase: 'verify', mappingAxis: axis, qualitySpan: span };
}

function resetStageCapture(cal) {
  cal.phase = 'marks';
  cal.currentStep = 0;
  cal.error = null;
  cal.isCalibrated = false;
  cal.mappingAxis = 'alpha';
  cal.qualitySpan = null;
  for (const point of cal.points) point.snapshot = null;
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
const operatorUrl = `https://${lanIp}:${PORT}/operator`;

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
app.get('/operator', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'operator.html')));
app.get('/mobile', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'mobile.html')));

const httpServer = https.createServer({ key: pems.private, cert: pems.cert }, app);
const io = new Server(httpServer);

let qrDataUrl = null;
let phoneSocketId = null;

function broadcastState() {
  io.emit('state_update', state);
}

io.on('connection', (socket) => {
  socket.emit('init', { state, qrDataUrl, mobileUrl, operatorUrl });

  socket.on('phone_connected', () => {
    phoneSocketId = socket.id;
    state.isPhoneConnected = true;
    broadcastState();
    console.log(`[phone] connected (${socket.id})`);
  });

  socket.on('orientation_update', (data) => {
    if (!isValidOrientation(data)) return;
    const sample = {
      alpha: data.alpha,
      beta: data.beta,
      gamma: data.gamma,
    };
    pushOrientationSample(sample);
    state.currentOrientation = {
      ...sample,
      rotationRate: parseRotationRate(data),
    };
    socket.broadcast.volatile.emit('orientation_update', state.currentOrientation);
  });

  socket.on('set_tracking_mode', (mode) => {
    if (mode !== 'pointer' && mode !== 'stage') return;
    state.trackingMode = mode;
    state.calibration = createEmptyCalibration();
    broadcastState();
    console.log(`[mode] ${mode}`);
  });

  socket.on('calibrate_center', (data, ack) => {
    if (!isValidOrientation(data)) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Invalid orientation.' });
      return;
    }
    state.calibration.centerAlpha = data.alpha;
    state.calibration.centerBeta = data.beta;
    state.calibration.phase = 'live';
    state.calibration.isCalibrated = true;
    broadcastState();
    if (typeof ack === 'function') ack({ ok: true, calibration: state.calibration });
    console.log(`[calibrate] pointer center α=${data.alpha.toFixed(1)}° β=${data.beta.toFixed(1)}°`);
  });

  socket.on('confirm_stage_position', (_payload, ack) => {
    const cal = state.calibration;
    if (state.trackingMode !== 'stage') {
      if (typeof ack === 'function') ack({ ok: false, error: 'Not in stage mode.' });
      return;
    }
    if (cal.phase !== 'marks') {
      if (typeof ack === 'function') ack({ ok: false, error: 'Not in calibration marks phase.' });
      return;
    }

    const averaged = averageOrientationFromBuffer();
    if (!averaged) {
      if (typeof ack === 'function') {
        ack({
          ok: false,
          error: `Not enough readings (${orientationBuffer.length}/${MIN_CONFIRM_SAMPLES}) — wait a moment and retry.`,
        });
      }
      return;
    }

    if (cal.currentStep >= cal.points.length) {
      if (typeof ack === 'function') ack({ ok: false, error: 'All positions already captured.' });
      return;
    }

    const point = cal.points[cal.currentStep];
    const sampleCount = orientationBuffer.length;
    point.snapshot = averaged;
    cal.currentStep += 1;
    cal.error = null;

    console.log(
      `[calibrate] ${point.label} (averaged ${sampleCount} samples) α=${averaged.alpha.toFixed(1)}° β=${averaged.beta.toFixed(1)}° γ=${averaged.gamma.toFixed(1)}°`
    );

    if (cal.currentStep >= cal.points.length) {
      const result = validateStageCalibration(cal);
      if (!result.ok) {
        resetStageCapture(cal);
        broadcastState();
        if (typeof ack === 'function') ack({ ok: false, error: result.error, calibration: cal });
        return;
      }
      broadcastState();
      if (typeof ack === 'function') {
        ack({
          ok: true,
          phase: 'verify',
          mappingAxis: result.mappingAxis,
          qualitySpan: result.qualitySpan,
          calibration: cal,
        });
      }
      console.log(`[calibrate] verify via ${cal.mappingAxis}, ${cal.qualitySpan.toFixed(1)}° span`);
      return;
    }

    broadcastState();
    if (typeof ack === 'function') {
      ack({ ok: true, step: cal.currentStep, calibration: cal });
    }
  });

  socket.on('confirm_verification', (_payload, ack) => {
    const cal = state.calibration;
    if (state.trackingMode !== 'stage' || cal.phase !== 'verify') {
      if (typeof ack === 'function') ack({ ok: false, error: 'Not in verification phase.' });
      return;
    }
    cal.phase = 'live';
    cal.isCalibrated = true;
    broadcastState();
    if (typeof ack === 'function') ack({ ok: true, calibration: cal });
    console.log('[calibrate] live — show started');
  });

  socket.on('undo_stage_position', (_payload, ack) => {
    const cal = state.calibration;
    if (cal.phase !== 'marks' || cal.currentStep === 0) {
      if (typeof ack === 'function') ack({ ok: false });
      return;
    }
    cal.currentStep -= 1;
    cal.points[cal.currentStep].snapshot = null;
    cal.error = null;
    broadcastState();
    if (typeof ack === 'function') ack({ ok: true, step: cal.currentStep, calibration: cal });
    console.log(`[calibrate] undo → step ${cal.currentStep + 1}`);
  });

  socket.on('reset_calibration', () => {
    state.calibration = createEmptyCalibration();
    broadcastState();
    console.log('[calibrate] reset');
  });

  socket.on('disconnect', () => {
    if (socket.id === phoneSocketId) {
      phoneSocketId = null;
      state.isPhoneConnected = false;
      broadcastState();
      console.log('[phone] disconnected');
    }
  });
});

QRCode.toDataURL(mobileUrl, { margin: 1, width: 512, errorCorrectionLevel: 'M' })
  .then((dataUrl) => {
    qrDataUrl = dataUrl;
    httpServer.listen(PORT, '0.0.0.0', () => {
      console.log('Gyro Spotlight Tracker');
      console.log(`  Desktop (projector): https://${lanIp}:${PORT}/`);
      console.log(`  Operator (laptop):   ${operatorUrl}`);
      console.log(`  Mobile  (performer): ${mobileUrl}`);
      console.log('  Accept the self-signed certificate warning on both devices.');
    });
  })
  .catch((err) => {
    console.error('Failed to generate QR code:', err);
    process.exit(1);
  });
