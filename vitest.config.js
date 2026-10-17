import { defineConfig } from 'vitest/config';

// The shop runs in Laos; pin the timezone so date-key tests are deterministic
// regardless of where tests run (workers inherit this).
process.env.TZ = 'Asia/Vientiane';

export default defineConfig({
    test: {
        include: ['tests/**/*.test.js'],
        coverage: {
            provider: 'v8',
            // Only the standalone .js files can be measured; logic inlined in the
            // .html pages is invisible to coverage until it is extracted.
            include: ['*.js'],
            exclude: ['i18n-dict.js', 'vitest.config.js'],
            reporter: ['text-summary', 'text', 'html'],
        },
    },
});
