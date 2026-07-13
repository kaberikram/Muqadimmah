const { test, expect } = require('@playwright/test');
const {
  BUTTONS,
  openProjector,
  setAxes,
  setButton,
  tapButton,
  getHook,
  waitForTestHook,
  sampleCurrentX,
  peakToPeak,
  sleep,
} = require('./helpers');

test.beforeEach(async ({ page }) => {
  await openProjector(page);
  await waitForTestHook(page);
});

test('starts centered with canvas visible', async ({ page }) => {
  const hook = await getHook(page);
  expect(hook.canvasVisible).toBe(true);
  expect(hook.gamepadConnected).toBe(true);
  expect(hook.pointerX).toBeCloseTo(0.5, 1);
  expect(hook.pointerY).toBeCloseTo(0.5, 1);
});

test('pushing stick right moves spotlight right', async ({ page }) => {
  await setAxes(page, 1, 0);
  await sleep(400);
  await setAxes(page, 0, 0);

  const hook = await getHook(page);
  expect(hook.pointerX).toBeGreaterThan(0.6);
  expect(hook.currentX).toBeGreaterThan(640 + 50);
  expect(hook.pointerY).toBeCloseTo(0.5, 1);
});

test('pushing stick down moves spotlight down', async ({ page }) => {
  await setAxes(page, 0, 1);
  await sleep(400);
  await setAxes(page, 0, 0);

  const hook = await getHook(page);
  expect(hook.pointerY).toBeGreaterThan(0.6);
  expect(hook.currentY).toBeGreaterThan(360 + 30);
});

test('spotlight holds position when stick is released', async ({ page }) => {
  await setAxes(page, 1, 0);
  await sleep(400);
  await setAxes(page, 0, 0);
  await sleep(300);

  const before = await getHook(page);
  const xs = await sampleCurrentX(page, 1000);
  expect(peakToPeak(xs)).toBeLessThan(3);

  const after = await getHook(page);
  expect(after.pointerX).toBeCloseTo(before.pointerX, 3);
});

test('deflection inside the dead zone causes no movement', async ({ page }) => {
  await setAxes(page, 0.05, 0.05);
  await sleep(600);

  const hook = await getHook(page);
  expect(hook.pointerX).toBeCloseTo(0.5, 2);
  expect(hook.pointerY).toBeCloseTo(0.5, 2);
});

test('pointer clamps at screen edge', async ({ page }) => {
  await setAxes(page, -1, 0);
  await sleep(1500);
  await setAxes(page, 0, 0);

  const hook = await getHook(page);
  expect(hook.pointerX).toBe(0);
  expect(hook.currentX).toBeLessThan(20);
});

test('A button spawns a burst that expires', async ({ page }) => {
  await tapButton(page, BUTTONS.BURST);

  let hook = await getHook(page);
  expect(hook.activeBurstCount).toBeGreaterThan(0);

  await sleep(1300);
  hook = await getHook(page);
  expect(hook.activeBurstCount).toBe(0);
});

test('holding A does not retrigger burst until released', async ({ page }) => {
  await setButton(page, BUTTONS.BURST, true);
  await sleep(300);

  let hook = await getHook(page);
  expect(hook.activeBurstCount).toBe(1);

  await setButton(page, BUTTONS.BURST, false);
  await sleep(80);
  await setButton(page, BUTTONS.BURST, true);
  await sleep(100);

  hook = await getHook(page);
  expect(hook.activeBurstCount).toBe(2);

  await setButton(page, BUTTONS.BURST, false);
});

test('holding X expands spotlight, springs back on release', async ({ page }) => {
  await setButton(page, BUTTONS.EXPAND, true);
  await sleep(350);

  let hook = await getHook(page);
  expect(hook.expandActive).toBe(true);
  expect(hook.radiusScale).toBeGreaterThan(1.5);

  await setButton(page, BUTTONS.EXPAND, false);
  await sleep(500);

  hook = await getHook(page);
  expect(hook.expandActive).toBe(false);
  expect(hook.radiusScale).toBeLessThan(1.4);
});

test('B button toggles aura on and off', async ({ page }) => {
  await tapButton(page, BUTTONS.AURA);
  let hook = await getHook(page);
  expect(hook.auraActive).toBe(true);

  await tapButton(page, BUTTONS.AURA);
  hook = await getHook(page);
  expect(hook.auraActive).toBe(false);
});

test('Y button recenters the spotlight', async ({ page }) => {
  await setAxes(page, 1, 1);
  await sleep(400);
  await setAxes(page, 0, 0);

  let hook = await getHook(page);
  expect(hook.pointerX).toBeGreaterThan(0.6);

  await tapButton(page, BUTTONS.RECENTER);
  await sleep(400);

  hook = await getHook(page);
  expect(hook.pointerX).toBeCloseTo(0.5, 2);
  expect(hook.pointerY).toBeCloseTo(0.5, 2);
  expect(hook.currentX).toBeGreaterThan(600);
  expect(hook.currentX).toBeLessThan(680);
});

test('LB toggles the ghost aura', async ({ page }) => {
  await tapButton(page, BUTTONS.GHOST);
  let hook = await getHook(page);
  expect(hook.ghostActive).toBe(true);

  await tapButton(page, BUTTONS.GHOST);
  hook = await getHook(page);
  expect(hook.ghostActive).toBe(false);
});

test('holding RT charges, releasing detonates a nova', async ({ page }) => {
  await setButton(page, BUTTONS.CHARGE, true);
  await sleep(600);

  let hook = await getHook(page);
  expect(hook.charging).toBe(true);
  expect(hook.chargeLevel).toBeGreaterThan(0.3);

  await setButton(page, BUTTONS.CHARGE, false);
  await sleep(120);

  hook = await getHook(page);
  expect(hook.charging).toBe(false);
  expect(hook.activeBurstCount).toBeGreaterThan(0);

  await sleep(1300);
  hook = await getHook(page);
  expect(hook.chargeLevel).toBeLessThan(0.1);
});

test('a tiny RT tap does not detonate', async ({ page }) => {
  await setButton(page, BUTTONS.CHARGE, true);
  await sleep(60);
  await setButton(page, BUTTONS.CHARGE, false);
  await sleep(120);

  const hook = await getHook(page);
  expect(hook.activeBurstCount).toBe(0);
});

test('holding LT dilates time, releasing restores it', async ({ page }) => {
  await setButton(page, BUTTONS.SLOWMO, true);
  await sleep(150);

  let hook = await getHook(page);
  expect(hook.timeScale).toBeLessThan(0.4);

  await setButton(page, BUTTONS.SLOWMO, false);
  await sleep(150);

  hook = await getHook(page);
  expect(hook.timeScale).toBeCloseTo(1, 2);
});

test('D-pad left/right cycles palettes and wraps', async ({ page }) => {
  await tapButton(page, BUTTONS.DPAD_RIGHT);
  let hook = await getHook(page);
  expect(hook.paletteIndex).toBe(1);

  await tapButton(page, BUTTONS.DPAD_LEFT);
  await tapButton(page, BUTTONS.DPAD_LEFT);
  hook = await getHook(page);
  expect(hook.paletteIndex).toBeGreaterThan(1); // wrapped to the last palette
});

test('D-pad up/down adjusts base spot size', async ({ page }) => {
  const before = (await getHook(page)).radiusBase;

  await tapButton(page, BUTTONS.DPAD_UP);
  let hook = await getHook(page);
  expect(hook.radiusBase).toBeGreaterThan(before);

  await tapButton(page, BUTTONS.DPAD_DOWN);
  await tapButton(page, BUTTONS.DPAD_DOWN);
  hook = await getHook(page);
  expect(hook.radiusBase).toBeLessThan(before);
});

test('L3 toggles blackout', async ({ page }) => {
  await tapButton(page, BUTTONS.BLACKOUT);
  let hook = await getHook(page);
  expect(hook.blackoutActive).toBe(true);

  await tapButton(page, BUTTONS.BLACKOUT);
  hook = await getHook(page);
  expect(hook.blackoutActive).toBe(false);
});

test('R3 toggles strobe', async ({ page }) => {
  await tapButton(page, BUTTONS.STROBE);
  let hook = await getHook(page);
  expect(hook.strobeActive).toBe(true);

  await tapButton(page, BUTTONS.STROBE);
  hook = await getHook(page);
  expect(hook.strobeActive).toBe(false);
});

test('Start toggles the HUD overlay', async ({ page }) => {
  await tapButton(page, BUTTONS.HUD);
  let hook = await getHook(page);
  expect(hook.hudVisible).toBe(true);
  await expect(page.locator('#hud')).toHaveClass(/visible/);

  await tapButton(page, BUTTONS.HUD);
  hook = await getHook(page);
  expect(hook.hudVisible).toBe(false);
});

test('Select toggles audio-reactive mode', async ({ page }) => {
  await tapButton(page, BUTTONS.AUDIO);
  let hook = await getHook(page);
  expect(hook.audioEnabled).toBe(true);

  await tapButton(page, BUTTONS.AUDIO);
  hook = await getHook(page);
  expect(hook.audioEnabled).toBe(false);
});

