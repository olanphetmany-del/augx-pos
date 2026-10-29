# AUGUSTX POS — agent instructions

Plain HTML/JS, no build step. GitHub Pages serves `main` directly to the
live shop, and every page uses one production Firebase database.

- Work on a branch and open a pull request. Never push to `main`.
- Run `npm run check` before finishing (Node 24). It must pass.
- Never write to the real Firebase from tests or scripts; tests use the
  fake one in `tests/e2e/`.
- The repo is public for now (we plan to move hosting and make it
  private). Until then, everything committed is visible to anyone: never
  commit customer data or internal notes. Never commit keys or passwords,
  even after the repo goes private.
- Escape customer or database text with `esc()` before using `innerHTML`.
- Adding a file the site loads (page, script, style, image, manifest)? Add
  it to `SITE` in `scripts/build-site.js`. Only listed files are deployed to
  Firebase Hosting, and the build fails on an unlisted one.

## Languages
- App text: staff screens are Thai, customer screens are Lao. Every new UI
  string needs Thai, Lao and English in `i18n-dict.js`.
- Reply to people in the language they write in.
- Commit messages and code names in English. Code comments: match the file.
- PR titles and descriptions in Lao, Thai and English, in that order, with
  the same content in all three. English is the version of record.
