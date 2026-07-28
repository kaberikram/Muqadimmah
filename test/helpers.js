const path = require('path');

// All tests force the renderer's WebGL2 backend (?webgl=1): headless
// Chromium's software WebGPU device is flaky — it can drop mid-run, which
// freezes requestAnimationFrame and with it the gamepad polling loop.
const PAGE_URL =
  'file://' + path.resolve(__dirname, '..', 'public', 'index.html') + '?test=1&webgl=1&lowres=1';

const PAGE_URL_WEBGL = PAGE_URL;

// The /peaceful show — same query flags, own page.
const PAGE_URL_PEACEFUL =
  'file://' +
  path.resolve(__dirname, '..', 'public', 'peaceful', 'index.html') +
  '?test=1&webgl=1&lowres=1';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Install a fake standard-mapping gamepad before any page script runs.
 * Tests mutate it via setAxes / setButton below.
 */
async function installMockGamepad(page) {
  await page.addInitScript(() => {
    const pad = {
      id: 'Mock Gamepad (STANDARD GAMEPAD)',
      index: 0,
      connected: true,
      mapping: 'standard',
      timestamp: 0,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({
        pressed: false,
        touched: false,
        value: 0,
      })),
    };
    window.__mockGamepad = pad;
    navigator.getGamepads = () => [pad];
  });
}

async function openProjector(page) {
  await installMockGamepad(page);
  await page.goto(PAGE_URL);
}

async function openPeaceful(page) {
  await installMockGamepad(page);
  await page.goto(PAGE_URL_PEACEFUL);
}

function setAxes(page, x, y) {
  return page.evaluate(
    ([ax, ay]) => {
      window.__mockGamepad.axes[0] = ax;
      window.__mockGamepad.axes[1] = ay;
    },
    [x, y]
  );
}

function setRightStick(page, x, y) {
  return page.evaluate(
    ([ax, ay]) => {
      window.__mockGamepad.axes[2] = ax;
      window.__mockGamepad.axes[3] = ay;
    },
    [x, y]
  );
}

function setButton(page, index, down) {
  return page.evaluate(
    ([i, pressed]) => {
      const b = window.__mockGamepad.buttons[i];
      b.pressed = pressed;
      b.value = pressed ? 1 : 0;
    },
    [index, down]
  );
}

async function tapButton(page, index, holdMs = 80) {
  await setButton(page, index, true);
  await sleep(holdMs);
  await setButton(page, index, false);
  await sleep(80);
}

function getHook(page) {
  return page.evaluate(() => window.__spotlightTestHook);
}

function getPeacefulHook(page) {
  return page.evaluate(() => window.__peacefulTestHook);
}

async function waitForTestHook(page, timeoutMs = 15000) {
  await page.waitForFunction(() => window.__spotlightTestHook != null, null, {
    timeout: timeoutMs,
  });
  await page.waitForFunction(
    () => {
      const hook = window.__spotlightTestHook;
      return (
        hook.canvasVisible === true &&
        hook.gamepadConnected === true &&
        typeof hook.currentX === 'number'
      );
    },
    null,
    { timeout: timeoutMs, polling: 50 }
  );
}

async function waitForPeacefulHook(page, timeoutMs = 30000) {
  await page.waitForFunction(() => window.__peacefulTestHook != null, null, {
    timeout: timeoutMs,
  });
  await page.waitForFunction(
    () => {
      const hook = window.__peacefulTestHook;
      return (
        hook.canvasVisible === true &&
        hook.gamepadConnected === true &&
        hook.cutCount > 0
      );
    },
    null,
    { timeout: timeoutMs, polling: 50 }
  );
}

async function sampleHookKey(page, key, durationMs, intervalMs = 16, hookName = '__spotlightTestHook') {
  const samples = [];
  const end = Date.now() + durationMs;
  while (Date.now() < end) {
    const v = await page.evaluate(
      ([k, h]) => window[h]?.[k],
      [key, hookName]
    );
    if (typeof v === 'number') samples.push(v);
    await sleep(intervalMs);
  }
  return samples;
}

function samplePeacefulKey(page, key, durationMs, intervalMs = 16) {
  return sampleHookKey(page, key, durationMs, intervalMs, '__peacefulTestHook');
}

function sampleCurrentX(page, durationMs, intervalMs = 16) {
  return sampleHookKey(page, 'currentX', durationMs, intervalMs);
}

function peakToPeak(values) {
  if (!values.length) return Infinity;
  return Math.max(...values) - Math.min(...values);
}

// Standard-mapping button indices (Xbox layout), mirrors index.html.
const BUTTONS = {
  BURST: 0, // A
  AURA: 1, // B
  EXPAND: 2, // X
  AURA_SHAPE: 3, // Y
  GHOST: 4, // LB
  SPOT_SHAPE: 5, // RB
  SLOWMO: 6, // LT (analog)
  CHARGE: 7, // RT (analog)
  AUDIO: 8, // Select
  HUD: 9, // Start
  BLACKOUT: 10, // L3
  STROBE: 11, // R3
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
};

module.exports = {
  PAGE_URL,
  PAGE_URL_WEBGL,
  PAGE_URL_PEACEFUL,
  BUTTONS,
  sleep,
  installMockGamepad,
  openProjector,
  openPeaceful,
  getPeacefulHook,
  waitForPeacefulHook,
  setAxes,
  setRightStick,
  setButton,
  tapButton,
  getHook,
  waitForTestHook,
  sampleCurrentX,
  sampleHookKey,
  samplePeacefulKey,
  peakToPeak,
};
