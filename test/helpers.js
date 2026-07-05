const { io: clientIo } = require('socket.io-client');
const {
  httpServer,
  io: serverIo,
  state,
  SETTINGS_DEFAULTS,
} = require('../server');

let baseUrl = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startTestServer() {
  if (baseUrl) return baseUrl;

  await new Promise((resolve, reject) => {
    if (httpServer.listening) {
      resolve();
      return;
    }
    httpServer.listen(0, '127.0.0.1', resolve);
    httpServer.on('error', reject);
  });

  const port = httpServer.address().port;
  baseUrl = `https://127.0.0.1:${port}`;
  return baseUrl;
}

async function stopTestServer() {
  if (!httpServer.listening) return;
  serverIo.disconnectSockets(true);
  await new Promise((resolve) => httpServer.close(resolve));
  baseUrl = null;
}

function resetServerState() {
  serverIo.disconnectSockets(true);
  state.isPhoneConnected = false;
  state.isCalibrated = false;
  state.centerBeta = null;
  state.centerGamma = null;
  state.centerAlpha = null;
  state.auraActive = false;
  state.expandActive = false;
  state.settings = { ...SETTINGS_DEFAULTS };
  state.currentOrientation = { beta: 90, gamma: 0, alpha: 0 };
}

function connectSocket(role = 'client') {
  return new Promise((resolve, reject) => {
    const socket = clientIo(baseUrl, {
      transports: ['websocket'],
      rejectUnauthorized: false,
      reconnection: false,
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
    setTimeout(() => reject(new Error(`${role} socket connect timeout`)), 5000);
  });
}

function buildOrientationPayload({ beta = 90, gamma = 0, alpha = 0, t }) {
  return { beta, gamma, alpha, t: t ?? performance.now() };
}

async function connectPhone() {
  const phone = await connectSocket('phone');
  phone.emit('phone_connected');
  await sleep(50);
  return phone;
}

async function calibrateCenter(phone, { beta = 90, gamma = 0, alpha = 0 } = {}) {
  return new Promise((resolve) => {
    phone.emit('calibrate_center', { beta, gamma, alpha }, resolve);
  });
}

async function emitOrientation(phone, { beta, gamma, alpha = 0, count = 1, tStart = 1000 }) {
  let t = tStart;
  for (let i = 0; i < count; i++) {
    phone.emit('orientation_update', buildOrientationPayload({ beta, gamma, alpha, t }));
    t += 16;
  }
  await sleep(50);
}

function emitEffectBurst(phone) {
  return new Promise((resolve) => {
    phone.emit('effect_burst', {}, resolve);
  });
}

function emitEffectExpand(phone, active) {
  return new Promise((resolve) => {
    phone.emit('effect_expand', { active }, resolve);
  });
}

function emitEffectAura(phone, active) {
  return new Promise((resolve) => {
    phone.emit('effect_aura', { active }, resolve);
  });
}

async function waitForTestHook(page, timeoutMs = 15000) {
  await page.waitForFunction(
    () => window.__spotlightTestHook != null,
    null,
    { timeout: timeoutMs }
  );
  await page.waitForFunction(
    () => {
      const hook = window.__spotlightTestHook;
      return hook.canvasVisible === true && hook.isCalibrated && typeof hook.currentX === 'number';
    },
    null,
    { timeout: timeoutMs, polling: 50 }
  );
}

async function sampleCurrentX(page, durationMs, intervalMs = 16) {
  const samples = [];
  const end = Date.now() + durationMs;
  while (Date.now() < end) {
    const x = await page.evaluate(() => window.__spotlightTestHook?.currentX);
    if (typeof x === 'number') samples.push(x);
    await sleep(intervalMs);
  }
  return samples;
}

function peakToPeak(values) {
  if (!values.length) return Infinity;
  return Math.max(...values) - Math.min(...values);
}

module.exports = {
  sleep,
  startTestServer,
  stopTestServer,
  resetServerState,
  connectSocket,
  connectPhone,
  calibrateCenter,
  emitOrientation,
  emitEffectBurst,
  emitEffectExpand,
  emitEffectAura,
  buildOrientationPayload,
  waitForTestHook,
  sampleCurrentX,
  peakToPeak,
  getState: () => state,
  getBaseUrl: () => baseUrl,
  SETTINGS_DEFAULTS,
};
