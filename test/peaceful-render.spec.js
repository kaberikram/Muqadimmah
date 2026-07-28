const { test, expect } = require('@playwright/test');
const {
  BUTTONS,
  openPeaceful,
  tapButton,
  getPeacefulHook,
  waitForPeacefulHook,
  sleep,
} = require('./helpers');

// Pixel-level checks: the panels must put real light on screen and the figures
// must actually remove it, not merely keep their JS state consistent. The probe
// reports { max, mean } — max saturates on a lit panel, so occlusion is judged
// on the mean.
test.use({ viewport: { width: 320, height: 200 } });

test('panels put visible pixels on screen; blackout kills them', async ({ page }) => {
  await openPeaceful(page);
  await waitForPeacefulHook(page, 30000);
  await sleep(600); // let the opening cut ease in

  const lit = await page.evaluate(() => window.__probeFrame());
  expect(lit.max).toBeGreaterThan(30);

  await tapButton(page, BUTTONS.BLACKOUT); // L3
  await sleep(500); // blackout fade
  const dark = await page.evaluate(() => window.__probeFrame());
  expect(dark.max).toBeLessThan(lit.max * 0.2);
});

test('figures remove light from the frame', async ({ page }) => {
  await openPeaceful(page);
  await waitForPeacefulHook(page, 30000);
  // Freeze the composition — an idle cut between probes would reseed panel
  // brightness and make the frames incomparable.
  await page.evaluate(() => window.__setIdleCuts(false));

  // How much light the figures remove scales with how many are staged, and a
  // cut picks 1-3 at random. Cut until it rolls 3 so the threshold below is
  // measured against a known composition rather than a lucky one.
  for (let i = 0; i < 15; i++) {
    if ((await getPeacefulHook(page)).figureCount === 3) break;
    await tapButton(page, BUTTONS.BURST); // A — force a cut
    await sleep(250);
  }
  expect((await getPeacefulHook(page)).figureCount).toBe(3);
  await sleep(600);

  // Figure bodies blend multiplicatively (dst *= 1−α), so they can only ever
  // darken: turning them off must raise the mean. noHalos suppresses the
  // additive head glows, which otherwise add back more light than the bodies
  // remove and flip the sign of this comparison.
  const withFigures = await page.evaluate(() => window.__probeFrame({ noHalos: true }));

  await tapButton(page, BUTTONS.AURA); // B — figures off
  await sleep(600);
  expect((await getPeacefulHook(page)).figuresOn).toBe(false);
  const withoutFigures = await page.evaluate(() => window.__probeFrame({ noHalos: true }));

  // Measured delta runs 8-12 on a mean of ~215; 3 leaves room for drift while
  // still failing if the silhouettes stop occluding.
  expect(withoutFigures.mean - withFigures.mean).toBeGreaterThan(3);
});
