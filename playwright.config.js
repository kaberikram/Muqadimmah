const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './test',
  timeout: 60000,
  retries: 0,
  workers: 1,
  use: {
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 720 },
  },
});
