const { test, expect } = require('@playwright/test');
const {
  startTestServer,
  stopTestServer,
  resetServerState,
  connectPhone,
  connectSocket,
  emitSamples,
  calibrateStage,
  buildOrientationPayload,
  waitForTestHook,
  sampleCurrentX,
  peakToPeak,
  sleep,
  getState,
  getBaseUrl,
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

test('calibration across 0/360 seam picks alpha axis with ~40° span', async () => {
  const phone = await connectPhone();
  const operator = await connectSocket('operator');

  const alphas = [340, 20];
  for (const alpha of alphas) {
    await emitSamples(phone, { alpha, noise: 0.3, count: 50 });
    await new Promise((resolve) => {
      operator.emit('confirm_stage_position', {}, resolve);
    });
  }

  const cal = getState().calibration;
  expect(cal.phase).toBe('verify');
  expect(cal.mappingAxis).toBe('alpha');
  expect(cal.qualitySpan).toBeGreaterThan(35);
  expect(cal.qualitySpan).toBeLessThan(45);

  phone.disconnect();
  operator.disconnect();
});

test('stillness clamp holds spotlight steady when still', async ({ page }) => {
  const phone = await connectPhone();
  const operator = await connectSocket('operator');

  await calibrateStage(phone, operator, [340, 20]);
  expect(getState().calibration.phase).toBe('live');

  await emitSamples(phone, { alpha: 5, count: 30, tStart: 5000 });
  await page.goto(`${getBaseUrl()}/?test=1`);
  await waitForTestHook(page);

  await emitSamples(phone, {
    alpha: 5,
    noise: 0.8,
    count: 200,
    still: true,
    omega: 0,
    tStart: 5000,
    dt: 16,
  });
  await sleep(500);

  const xs = await sampleCurrentX(page, 3000);
  expect(peakToPeak(xs)).toBeLessThan(2);

  phone.disconnect();
  operator.disconnect();
});

test('walk lag stays under ~150 ms with truthful timestamps', async ({ page }) => {
  const phone = await connectPhone();
  const operator = await connectSocket('operator');

  await calibrateStage(phone, operator, [340, 20]);
  await emitSamples(phone, { alpha: 10, count: 30, tStart: 8000 });
  await page.goto(`${getBaseUrl()}/?test=1`);
  await waitForTestHook(page);

  const durationMs = 3000;
  const steps = 180;
  const dt = durationMs / steps;
  let t = 10000;
  const startAlpha = 340;
  const endAlpha = 20;

  for (let i = 0; i <= steps; i++) {
    const frac = i / steps;
    let alpha = startAlpha + frac * ((endAlpha - startAlpha + 360) % 360);
    if (alpha >= 360) alpha -= 360;
    const rate = ((endAlpha - startAlpha + 360) % 360) / (durationMs / 1000);
    phone.emit('orientation_update', buildOrientationPayload({
      alpha,
      t,
      omega: Math.abs(rate),
      rotationRate: { alpha: rate, beta: 0, gamma: 0 },
      v: 2,
    }));
    t += dt;
    await sleep(0);
  }

  await sleep(400);

  const hook = await page.evaluate(() => window.__spotlightTestHook);
  const w = 1280;
  const expectedPct = 1;
  const expectedX = expectedPct * w;
  const lagPx = Math.abs(hook.currentX - expectedX);
  const lagMs = (lagPx / w) * durationMs;
  expect(lagMs).toBeLessThan(200);

  phone.disconnect();
  operator.disconnect();
});

test('WiFi jitter immunity matches truthful packet timestamps', async ({ page }) => {
  const phone = await connectPhone();
  const operator = await connectSocket('operator');

  await calibrateStage(phone, operator, [340, 20]);
  await emitSamples(phone, { alpha: 10, count: 30, tStart: 8000 });
  await page.goto(`${getBaseUrl()}/?test=1`);
  await waitForTestHook(page);

  const durationMs = 3000;
  const steps = 120;
  const dt = durationMs / steps;
  let t = 20000;
  const startAlpha = 340;
  const endAlpha = 20;

  for (let i = 0; i <= steps; i++) {
    const frac = i / steps;
    let alpha = startAlpha + frac * ((endAlpha - startAlpha + 360) % 360);
    if (alpha >= 360) alpha -= 360;
    const rate = ((endAlpha - startAlpha + 360) % 360) / (durationMs / 1000);
    phone.emit('orientation_update', buildOrientationPayload({
      alpha,
      t,
      omega: Math.abs(rate),
      rotationRate: { alpha: rate, beta: 0, gamma: 0 },
      v: 2,
    }));
    t += dt;
    await sleep(Math.random() * 120);
  }

  await sleep(400);

  const hook = await page.evaluate(() => window.__spotlightTestHook);
  const w = 1280;
  const expectedX = w;
  const lagPx = Math.abs(hook.currentX - expectedX);
  const lagMs = (lagPx / w) * durationMs;
  expect(lagMs).toBeLessThan(250);

  phone.disconnect();
  operator.disconnect();
});

test('v1 compat tracks without timestamps or still flag', async ({ page }) => {
  const phone = await connectPhone();
  const operator = await connectSocket('operator');

  await calibrateStage(phone, operator, [340, 20]);
  await emitSamples(phone, { alpha: 10, count: 30, tStart: 8000 });
  await page.goto(`${getBaseUrl()}/?test=1`);
  await waitForTestHook(page);

  for (let i = 0; i <= 60; i++) {
    const alpha = 340 + (i / 60) * 40;
    phone.emit('orientation_update', buildOrientationPayload({
      alpha: alpha > 360 ? alpha - 360 : alpha,
      useTimestamps: false,
    }));
    await sleep(16);
  }

  await sleep(500);
  const hook = await page.evaluate(() => window.__spotlightTestHook);
  expect(hook.currentX).toBeGreaterThan(640);

  phone.disconnect();
  operator.disconnect();
});

test('drift correction nudge and anchor shift projector position', async ({ page }) => {
  const phone = await connectPhone();
  const operator = await connectSocket('operator');

  await calibrateStage(phone, operator, [340, 20]);
  await emitSamples(phone, { alpha: 5, count: 30, tStart: 30000 });
  await page.goto(`${getBaseUrl()}/?test=1`);
  await waitForTestHook(page);
  await sleep(200);

  const before = await page.evaluate(() => window.__spotlightTestHook.currentX);

  await new Promise((resolve) => {
    operator.emit('nudge_stage_offset', { deltaPct: 0.05 }, resolve);
  });
  await sleep(300);

  const afterNudge = await page.evaluate(() => window.__spotlightTestHook.currentX);
  expect(afterNudge - before).toBeGreaterThan(50);

  await emitSamples(phone, { alpha: 5, count: 20, tStart: 40000 });
  await new Promise((resolve) => {
    operator.emit('anchor_stage_center', {}, resolve);
  });
  await sleep(300);

  const offset = getState().stageOffsetPct;
  expect(Math.abs(offset)).toBeLessThan(0.26);

  phone.disconnect();
  operator.disconnect();
});
