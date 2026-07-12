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
      // from file origins unless explicitly allowed. WebGPU must be enabled
      // explicitly in headless — the WebGL2 software fallback is too slow to
      // keep the render loop realtime once the particle figures are visible.
      args: ['--allow-file-access-from-files', '--enable-unsafe-webgpu'],
      ...(process.env.PW_CHROMIUM_PATH
        ? { executablePath: process.env.PW_CHROMIUM_PATH }
        : {}),
    },
  },
});
