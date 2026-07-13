const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './test',
  timeout: 60000,
  retries: 0,
  workers: 1,
  use: {
    viewport: { width: 1280, height: 720 },
    launchOptions: {
      // The page is a file:// ES-module app; Chromium blocks module fetches
      // from file origins unless explicitly allowed. Tests run the renderer's
      // WebGL2 backend (see helpers.js) — headless software WebGPU is flaky.
      args: ['--allow-file-access-from-files'],
      ...(process.env.PW_CHROMIUM_PATH
        ? { executablePath: process.env.PW_CHROMIUM_PATH }
        : {}),
    },
  },
});
