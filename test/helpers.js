const { io: clientIo } = require('socket.io-client');
const {
  httpServer,
  io: serverIo,
  state,
  resetCalibrationState,
  clearOrientationBuffer,
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
  await new Promise((resolve) => httpServer.close(resolve));
  baseUrl = null;
}

function resetServerState() {
  serverIo.disconnectSockets(true);
  resetCalibrationState();
  clearOrientationBuffer();
  state.isPhoneConnected = false;
  state.trackingMode = 'stage';
  state.stageOffsetPct = 0;
  state.currentOrientation = {
    alpha: 0,
    beta: 90,
    gamma: 0,
    rotationRate: null,
    t: null,
    still: false,
    omega: 0,
    v: 1,
  };
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

function buildOrientationPayload({
  alpha,
  beta = 90,
  gamma = 0,
  t,
  still,
  omega = 0,
  rotationRate = null,
  v,
  useTimestamps = true,
}) {
  const payload = {
    alpha: ((alpha % 360) + 360) % 360,
    beta,
    gamma,
  };
  if (useTimestamps && typeof t === 'number') {
    payload.t = t;
    payload.v = 2;
  }
  if (still === true) payload.still = true;
  if (typeof omega === 'number') payload.omega = omega;
  if (rotationRate) payload.rotationRate = rotationRate;
  if (v === 2 && !payload.v) payload.v = 2;
  return payload;
}

async function emitSamples(phone, {
  alpha,
  beta = 90,
  gamma = 0,
  count = 50,
  noise = 0,
  tStart = 1000,
  dt = 16,
  still,
  omega = 0,
  rotationRate = null,
  useTimestamps = true,
  delayMs = 0,
}) {
  clearOrientationBuffer();
  let t = tStart;
  for (let i = 0; i < count; i++) {
    const sampleAlpha = alpha + (Math.random() - 0.5) * 2 * noise;
    phone.emit('orientation_update', buildOrientationPayload({
      alpha: sampleAlpha,
      beta,
      gamma,
      t: useTimestamps ? t : undefined,
      still,
      omega,
      rotationRate,
      v: useTimestamps ? 2 : 1,
    }));
    t += dt;
    if (delayMs > 0) await sleep(delayMs);
  }
  await sleep(200);
  return t;
}

async function connectPhone() {
  const phone = await connectSocket('phone');
  phone.emit('phone_connected');
  await sleep(50);
  return phone;
}

async function confirmMark(operator) {
  return new Promise((resolve) => {
    operator.emit('confirm_stage_position', {}, (res) => resolve(res));
  });
}

async function calibrateStage(phone, operator, alphas) {
  for (const alpha of alphas) {
    await emitSamples(phone, { alpha, noise: 0.3, count: 50 });
    const res = await confirmMark(operator);
    if (!res || !res.ok) throw new Error(`confirm failed: ${res && res.error}`);
  }
  return new Promise((resolve) => {
    operator.emit('confirm_verification', {}, (res) => resolve(res));
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
      return hook.canvasVisible === true && typeof hook.currentX === 'number';
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
  emitSamples,
  confirmMark,
  calibrateStage,
  buildOrientationPayload,
  waitForTestHook,
  sampleCurrentX,
  peakToPeak,
  getState: () => state,
  getBaseUrl: () => baseUrl,
};
