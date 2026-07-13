const { test, expect } = require('@playwright/test');
const {
  PAGE_URL,
  installMockGamepad,
  setAxis,
  setButton,
  tapButton,
  getHook,
  waitForTestHook,
  sleep,
} = require('./helpers');

// D-input pads (8BitDo on macOS, generic HID sticks) expose scrambled button
// indices, triggers as axes, and the D-pad as a "hat" axis resting outside
// [-1, 1]. These tests fake such a pad and drive the on-screen calibration.

const HAT_REST = 1.2857142857142856;
const HAT = { up: -1, right: -3 / 7, down: 1 / 7, left: 5 / 7 };

const DINPUT_PAD = {
  id: 'Mock Wireless Controller (DirectInput)',
  mapping: '',
  buttonCount: 15,
  // axes: 0/1 left stick, 2/3 right stick, 4 = analog trigger (rest -1), 9 = hat
  axes: [0, 0, 0, 0, -1, 0, 0, 0, 0, HAT_REST],
};

// The physical layout the test pretends the pad has (deliberately scrambled)
const PHYSICAL = {
  burst: { btn: 3 },
  aura: { btn: 2 },
  expand: { btn: 5 },
  recenter: { btn: 0 },
  ghost: { btn: 1 },
  stand: { btn: 4 },
  slowmo: { axis: 4, pressed: 1, rest: -1 }, // analog trigger on an axis
  charge: { btn: 7 },
  audio: { btn: 8 },
  hud: { btn: 9 },
  blackout: { btn: 10 },
  strobe: { btn: 11 },
  up: { hat: HAT.up },
  down: { hat: HAT.down },
  left: { hat: HAT.left },
  right: { hat: HAT.right },
  lx: { axis: 0, push: 1 },
  ly: { axis: 1, push: 1 },
  rx: { axis: 2, push: 1 },
  ry: { axis: 3, push: 1 },
};

async function actuate(page, key, on) {
  const p = PHYSICAL[key];
  if (p.btn !== undefined) return setButton(page, p.btn, on);
  if (p.hat !== undefined) return setAxis(page, 9, on ? p.hat : HAT_REST);
  if (p.push !== undefined) return setAxis(page, p.axis, on ? p.push : 0);
  return setAxis(page, p.axis, on ? p.pressed : p.rest);
}

async function runCalibration(page) {
  for (let guard = 0; guard < 40; guard++) {
    const hook = await getHook(page);
    if (!hook.calibrationActive) return;
    const key = hook.calibrationStep;
    await actuate(page, key, true);
    // wait until the step advances (capture is edge-triggered after settle)
    await page.waitForFunction(
      (k) => {
        const h = window.__spotlightTestHook;
        return !h.calibrationActive || h.calibrationStep !== k;
      },
      key,
      { timeout: 5000, polling: 30 }
    );
    await actuate(page, key, false);
    await sleep(120); // let the release settle before the next step arms
  }
  throw new Error('calibration did not finish');
}

test('unknown D-input pad auto-launches calibration; remapped controls work', async ({ page }) => {
  await installMockGamepad(page, DINPUT_PAD);
  await page.goto(PAGE_URL);
  await waitForTestHook(page);

  let hook = await getHook(page);
  expect(hook.calibrationActive).toBe(true);

  await runCalibration(page);

  hook = await getHook(page);
  expect(hook.calibrationActive).toBe(false);
  expect(hook.profileName).toBe('CUSTOM');

  // Physical button 3 is now BURST
  await tapButton(page, PHYSICAL.burst.btn);
  hook = await getHook(page);
  expect(hook.activeBurstCount).toBeGreaterThan(0);

  // The axis-trigger is SLOW-MO
  await setAxis(page, PHYSICAL.slowmo.axis, 1);
  await sleep(150);
  hook = await getHook(page);
  expect(hook.timeScale).toBeLessThan(0.4);
  await setAxis(page, PHYSICAL.slowmo.axis, -1);

  // Hat up bumps the spot size
  const before = (await getHook(page)).radiusBase;
  await setAxis(page, 9, HAT.up);
  await sleep(120);
  await setAxis(page, 9, HAT_REST);
  await sleep(120);
  hook = await getHook(page);
  expect(hook.radiusBase).toBeGreaterThan(before);

  // Left stick still moves the spotlight
  await setAxis(page, 0, 1);
  await sleep(400);
  await setAxis(page, 0, 0);
  hook = await getHook(page);
  expect(hook.pointerX).toBeGreaterThan(0.6);
});

test('calibrated profile persists across reloads', async ({ page }) => {
  await installMockGamepad(page, DINPUT_PAD);
  await page.goto(PAGE_URL);
  await waitForTestHook(page);
  await runCalibration(page);

  await page.reload();
  await waitForTestHook(page);

  const hook = await getHook(page);
  expect(hook.calibrationActive).toBe(false);
  expect(hook.profileName).toBe('CUSTOM');

  await tapButton(page, PHYSICAL.burst.btn);
  expect((await getHook(page)).activeBurstCount).toBeGreaterThan(0);
});

test('8BitDo D-input pad gets the built-in profile without calibration', async ({ page }) => {
  await installMockGamepad(page, {
    id: '8BitDo Ultimate Wireless Controller (Vendor: 2dc8)',
    mapping: '',
    buttonCount: 16,
    axes: [0, 0, 0, 0, 0, 0, 0, 0, 0, HAT_REST],
  });
  await page.goto(PAGE_URL);
  await waitForTestHook(page);

  let hook = await getHook(page);
  expect(hook.calibrationActive).toBe(false);
  expect(hook.profileName).toBe('8BITDO D-INPUT');

  // On 8BitDo D-input, physical button 1 is A (burst)
  await tapButton(page, 1);
  hook = await getHook(page);
  expect(hook.activeBurstCount).toBeGreaterThan(0);

  // Hat D-pad cycles the palette
  await setAxis(page, 9, HAT.right);
  await sleep(120);
  await setAxis(page, 9, HAT_REST);
  await sleep(120);
  hook = await getHook(page);
  expect(hook.paletteIndex).toBe(1);
});
