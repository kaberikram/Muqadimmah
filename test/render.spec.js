const { test, expect } = require('@playwright/test');
const {
  PAGE_URL_WEBGL,
  BUTTONS,
  installMockGamepad,
  tapButton,
  setButton,
  getHook,
  waitForTestHook,
  sleep,
} = require('./helpers');

// Pixel-level regression tests: the page must put actual light on screen,
// not just keep its JS state consistent. (A WebGPU quirk once made every
// particle render as an invisible 1px point while all state tests passed.)
//
// Runs on the WebGL2 backend (?webgl=1): headless has no working WebGPU
// device, and WebGL renders synchronously so the in-page probe can read the
// back buffer. Software GL is slow, so keep the viewport tiny and the
// assertions few.
test.use({ viewport: { width: 320, height: 200 } });

test('spotlight puts visible pixels on screen; blackout kills them', async ({ page }) => {
  await installMockGamepad(page);
  await page.goto(PAGE_URL_WEBGL);
  await waitForTestHook(page, 30000);
  await sleep(400);

  const lit = await page.evaluate(() => window.__probeFrame());
  expect(lit).toBeGreaterThan(30);

  await tapButton(page, BUTTONS.BLACKOUT);
  await sleep(500); // let the blackout fade finish
  const dark = await page.evaluate(() => window.__probeFrame());
  expect(dark).toBeLessThan(lit * 0.2);
});

test('the instanced sprite particles themselves emit light', async ({ page }) => {
  await installMockGamepad(page);
  await page.goto(PAGE_URL_WEBGL);
  await waitForTestHook(page, 30000);
  await sleep(400);

  // Probe with the disc/halo meshes hidden: whatever remains at the spot is
  // the spotlight grain — pure instanced-sprite output. This is the probe
  // that catches "all particles render as invisible 1px points".
  const lum = await page.evaluate(() => window.__probeFrame(true));
  expect(lum).toBeGreaterThan(30);
});

test('RT charge filaments emit visible light without the spotlight grain', async ({ page }) => {
  await installMockGamepad(page);
  await page.goto(PAGE_URL_WEBGL);
  await waitForTestHook(page, 30000);
  await sleep(300);

  await setButton(page, BUTTONS.CHARGE, true);
  await sleep(900);

  const hook = await getHook(page);
  expect(hook.charging).toBe(true);
  expect(hook.chargeLevel).toBeGreaterThan(0.25);

  // Hide disc/halo/grain/echoes: only charge ribbons should remain lit.
  const lum = await page.evaluate(() => window.__probeFrame({ chargeOnly: true }));
  expect(lum).toBeGreaterThan(20);

  await setButton(page, BUTTONS.CHARGE, false);
});
