const { test, expect } = require('@playwright/test');
const {
  BUTTONS,
  openPeaceful,
  setAxes,
  setButton,
  tapButton,
  getPeacefulHook,
  waitForPeacefulHook,
  samplePeacefulKey,
  sleep,
} = require('./helpers');

// The /peaceful show: perspective light panels + occluding silhouettes, cut on
// the beat. Runs on the WebGL2 backend like the other specs — headless has no
// working WebGPU device.
test.beforeEach(async ({ page }) => {
  await openPeaceful(page);
  await waitForPeacefulHook(page);
});

test('starts with canvas visible and an opening cut', async ({ page }) => {
  const hook = await getPeacefulHook(page);
  expect(hook.canvasVisible).toBe(true);
  expect(hook.gamepadConnected).toBe(true);
  expect(hook.cutCount).toBeGreaterThan(0);
  expect(hook.panelCount).toBeGreaterThanOrEqual(1);
});

test('A forces a cut and reseeds the figures', async ({ page }) => {
  const before = await getPeacefulHook(page);

  await tapButton(page, BUTTONS.BURST); // A
  await sleep(120);

  const after = await getPeacefulHook(page);
  expect(after.cutCount).toBeGreaterThan(before.cutCount);
  expect(after.figureCount).toBeGreaterThanOrEqual(1);
  expect(after.figureCount).toBeLessThanOrEqual(3);
});

test('D-pad up/down changes panel count within bounds', async ({ page }) => {
  const before = (await getPeacefulHook(page)).panelCount;

  await tapButton(page, BUTTONS.DPAD_UP);
  let hook = await getPeacefulHook(page);
  expect(hook.panelCount).toBe(before + 1);

  await tapButton(page, BUTTONS.DPAD_DOWN);
  hook = await getPeacefulHook(page);
  expect(hook.panelCount).toBe(before);

  // Clamps rather than running away.
  for (let i = 0; i < 8; i++) await tapButton(page, BUTTONS.DPAD_DOWN, 40);
  hook = await getPeacefulHook(page);
  expect(hook.panelCount).toBe(1);
});

test('B toggles the figures off and back on', async ({ page }) => {
  await tapButton(page, BUTTONS.AURA); // B
  let hook = await getPeacefulHook(page);
  expect(hook.figuresOn).toBe(false);
  expect(hook.figureCount).toBe(0);

  await tapButton(page, BUTTONS.AURA);
  hook = await getPeacefulHook(page);
  expect(hook.figuresOn).toBe(true);
  expect(hook.figureCount).toBeGreaterThanOrEqual(1);
});

test('left stick orbits the camera, and it eases rather than snapping', async ({ page }) => {
  const before = await getPeacefulHook(page);
  expect(before.cameraYaw).toBeCloseTo(0, 2);

  await setAxes(page, 1, 0);
  const yaws = await samplePeacefulKey(page, 'cameraYaw', 600);
  await setAxes(page, 0, 0);

  const after = await getPeacefulHook(page);
  expect(after.cameraYaw).toBeGreaterThan(0.05);

  // Intermediate samples prove a glide, not a jump to the target.
  const mid = yaws.filter((v) => v > 0.005 && v < after.cameraYaw - 0.005);
  expect(mid.length).toBeGreaterThan(0);

  // Orbit is clamped so the camera can't swing behind the panels.
  await setAxes(page, 1, 0);
  await sleep(1500);
  await setAxes(page, 0, 0);
  await sleep(400);
  const clamped = await getPeacefulHook(page);
  expect(Math.abs(clamped.cameraYaw)).toBeLessThan(0.7);
});

test('D-pad left/right cycles palettes and wraps', async ({ page }) => {
  await tapButton(page, BUTTONS.DPAD_RIGHT);
  let hook = await getPeacefulHook(page);
  expect(hook.paletteIndex).toBe(1);

  await tapButton(page, BUTTONS.DPAD_LEFT);
  await tapButton(page, BUTTONS.DPAD_LEFT);
  hook = await getPeacefulHook(page);
  expect(hook.paletteIndex).toBeGreaterThan(1); // wrapped to the last palette
});

test('RT charges and releasing forces a cut', async ({ page }) => {
  await setButton(page, BUTTONS.CHARGE, true);
  await sleep(500);

  // The ramp is per-frame with dt clamped to 50ms, so under software GL it
  // accumulates slower than wall time — assert it keeps growing rather than
  // pinning an absolute level to a frame rate.
  let hook = await getPeacefulHook(page);
  expect(hook.charging).toBe(true);
  const early = hook.chargeLevel;
  expect(early).toBeGreaterThan(0);

  await sleep(700);
  hook = await getPeacefulHook(page);
  expect(hook.chargeLevel).toBeGreaterThan(early);
  const cutsBefore = hook.cutCount;

  await setButton(page, BUTTONS.CHARGE, false);
  await sleep(200);

  hook = await getPeacefulHook(page);
  expect(hook.charging).toBe(false);
  expect(hook.chargeLevel).toBe(0);
  expect(hook.cutCount).toBeGreaterThan(cutsBefore);
});

test('LT dilates time, releasing restores it', async ({ page }) => {
  await setButton(page, BUTTONS.SLOWMO, true);
  await sleep(150);
  expect((await getPeacefulHook(page)).timeScale).toBeLessThan(0.4);

  await setButton(page, BUTTONS.SLOWMO, false);
  await sleep(150);
  expect((await getPeacefulHook(page)).timeScale).toBeCloseTo(1, 2);
});

test('the scene keeps cutting on its own with audio off', async ({ page }) => {
  const before = (await getPeacefulHook(page)).cutCount;
  await sleep(4200); // longer than CUT_IDLE_INTERVAL_MS
  const after = (await getPeacefulHook(page)).cutCount;
  expect(after).toBeGreaterThan(before);
});
