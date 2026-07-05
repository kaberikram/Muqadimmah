const { test, expect } = require('@playwright/test');
const {
  startTestServer,
  stopTestServer,
  resetServerState,
  connectPhone,
  connectSocket,
  calibrateCenter,
  emitOrientation,
  emitEffectBurst,
  emitEffectExpand,
  emitEffectAura,
  waitForTestHook,
  sampleCurrentX,
  peakToPeak,
  sleep,
  getBaseUrl,
  getState,
  SETTINGS_DEFAULTS,
} = require('./helpers');

test.beforeAll(async () => {
  await startTestServer();
});

test.afterAll(async () => {
  await stopTestServer();
});

test.beforeEach(() => {
  resetServerState();
});

test('absolute aim moves spotlight when gamma changes after calibration', async ({ page }) => {
  const phone = await connectPhone();
  await calibrateCenter(phone, { beta: 90, gamma: 0 });
  await page.goto(`${getBaseUrl()}/?test=1`);
  await waitForTestHook(page);

  await emitOrientation(phone, { beta: 90, gamma: 8, count: 30 });
  await sleep(200);

  const hook = await page.evaluate(() => window.__spotlightTestHook);
  const expectedOffset = 8 * SETTINGS_DEFAULTS.pointerSensitivityX;
  expect(hook.currentX).toBeLessThan(640 - expectedOffset * 0.7);

  phone.disconnect();
});

test('calibrate center snaps spotlight to screen center', async ({ page }) => {
  const phone = await connectPhone();
  await emitOrientation(phone, { beta: 90, gamma: 10, count: 20 });
  await calibrateCenter(phone, { beta: 90, gamma: 10 });
  await page.goto(`${getBaseUrl()}/?test=1`);
  await waitForTestHook(page);
  await emitOrientation(phone, { beta: 90, gamma: 10, count: 30 });
  await sleep(200);

  const hook = await page.evaluate(() => window.__spotlightTestHook);
  expect(hook.pointerX).toBeCloseTo(0.5, 1);
  expect(hook.currentX).toBeGreaterThan(600);
  expect(hook.currentX).toBeLessThan(680);

  phone.disconnect();
});

test('steady aim keeps spotlight stable', async ({ page }) => {
  const phone = await connectPhone();
  await calibrateCenter(phone, { beta: 90, gamma: 0 });
  await page.goto(`${getBaseUrl()}/?test=1`);
  await waitForTestHook(page);

  await emitOrientation(phone, { beta: 90, gamma: 0, count: 120 });
  await sleep(200);

  const xs = await sampleCurrentX(page, 1500);
  expect(peakToPeak(xs)).toBeLessThan(5);

  phone.disconnect();
});

test('higher horizontal sensitivity increases movement', async ({ page }) => {
  const phone = await connectPhone();
  const client = await connectSocket('client');

  await new Promise((resolve) => {
    client.emit('update_settings', { key: 'pointerSensitivityX', value: 100 }, resolve);
  });
  await calibrateCenter(phone, { beta: 90, gamma: 0 });
  await page.goto(`${getBaseUrl()}/?test=1`);
  await waitForTestHook(page);

  await emitOrientation(phone, { beta: 90, gamma: 5, count: 30 });
  await sleep(200);

  const hook = await page.evaluate(() => window.__spotlightTestHook);
  const defaultOffset = 5 * SETTINGS_DEFAULTS.pointerSensitivityX;
  const highOffset = 5 * 100;
  expect(640 - hook.currentX).toBeGreaterThan(defaultOffset * 1.5);
  expect(640 - hook.currentX).toBeGreaterThan(highOffset * 0.7);

  phone.disconnect();
  client.disconnect();
});

test('vertical tilt moves spotlight vertically', async ({ page }) => {
  const phone = await connectPhone();
  await calibrateCenter(phone, { beta: 90, gamma: 0 });
  await page.goto(`${getBaseUrl()}/?test=1`);
  await waitForTestHook(page);

  await emitOrientation(phone, { beta: 95, gamma: 0, count: 30 });
  await sleep(200);

  const hook = await page.evaluate(() => window.__spotlightTestHook);
  expect(hook.currentY).toBeLessThan(360 - 5 * SETTINGS_DEFAULTS.pointerSensitivityY * 0.5);

  phone.disconnect();
});

test('vertical pitch does not drift horizontally when euler axes couple', async ({ page }) => {
  const phone = await connectPhone();
  await calibrateCenter(phone, { beta: 75, gamma: 2, alpha: 30 });
  await page.goto(`${getBaseUrl()}/?test=1`);
  await waitForTestHook(page);

  // Pure pitch up (+5°): beta rises, gamma barely changes — old code treated gamma drift as pan
  await emitOrientation(phone, { beta: 80, gamma: 0.5, alpha: 32, count: 40 });
  await sleep(400);

  const hook = await page.evaluate(() => window.__spotlightTestHook);
  expect(hook.currentY).toBeLessThan(360 - 20);
  expect(hook.currentX).toBeGreaterThan(600);
  expect(hook.currentX).toBeLessThan(680);

  phone.disconnect();
});

test('burst spawns and expires on projector', async ({ page }) => {
  const phone = await connectPhone();
  await calibrateCenter(phone, { beta: 90, gamma: 0 });
  await page.goto(`${getBaseUrl()}/?test=1`);
  await waitForTestHook(page);
  await emitOrientation(phone, { beta: 90, gamma: 0, count: 10 });

  await emitEffectBurst(phone);
  await sleep(100);

  let hook = await page.evaluate(() => window.__spotlightTestHook);
  expect(hook.activeBurstCount).toBeGreaterThan(0);

  await sleep(1300);
  hook = await page.evaluate(() => window.__spotlightTestHook);
  expect(hook.activeBurstCount).toBe(0);

  phone.disconnect();
});

test('expand hold increases radius scale then releases', async ({ page }) => {
  const phone = await connectPhone();
  await calibrateCenter(phone, { beta: 90, gamma: 0 });
  await page.goto(`${getBaseUrl()}/?test=1`);
  await waitForTestHook(page);
  await emitOrientation(phone, { beta: 90, gamma: 0, count: 10 });

  await emitEffectExpand(phone, true);
  await sleep(350);

  let hook = await page.evaluate(() => window.__spotlightTestHook);
  expect(hook.radiusScale).toBeGreaterThan(1.5);
  expect(hook.expandActive).toBe(true);

  await emitEffectExpand(phone, false);
  await sleep(500);

  hook = await page.evaluate(() => window.__spotlightTestHook);
  expect(hook.radiusScale).toBeLessThan(1.4);
  expect(hook.expandActive).toBe(false);

  phone.disconnect();
});

test('aura toggle updates projector and server state', async ({ page }) => {
  const phone = await connectPhone();
  await calibrateCenter(phone, { beta: 90, gamma: 0 });
  await page.goto(`${getBaseUrl()}/?test=1`);
  await waitForTestHook(page);

  await emitEffectAura(phone, true);
  await sleep(100);

  let hook = await page.evaluate(() => window.__spotlightTestHook);
  expect(hook.auraActive).toBe(true);
  expect(getState().auraActive).toBe(true);

  await emitEffectAura(phone, false);
  await sleep(100);

  hook = await page.evaluate(() => window.__spotlightTestHook);
  expect(hook.auraActive).toBe(false);
  expect(getState().auraActive).toBe(false);

  phone.disconnect();
});
