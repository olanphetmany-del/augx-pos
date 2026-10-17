import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
    testDir: 'tests/e2e',
    testMatch: '*.spec.js',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
    use: {
        baseURL: `http://127.0.0.1:${PORT}/`,
        timezoneId: 'Asia/Vientiane',
        locale: 'th-TH',
        trace: 'retain-on-failure',
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        // The shop runs on tablets/phones; iPad Safari is the likeliest real device.
        { name: 'webkit-ipad', use: { ...devices['iPad (gen 7) landscape'] } },
    ],
    webServer: {
        command: `node scripts/serve.js ${PORT}`,
        url: `http://127.0.0.1:${PORT}/index.html`,
        reuseExistingServer: !process.env.CI,
    },
});
