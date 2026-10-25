# cse-210-warm-up-graphing

Graph Tool (CSE 210 Warm Up)

## Run locally

1. Install [Node.js](https://nodejs.org/) if it is not already installed.
2. From this project folder, run `npm start`.
3. Open [http://localhost:3000](http://localhost:3000) in a browser.

## Lint and formatting

- `npm run lint` checks the code with ESLint.
- `npm run format` formats everything with Prettier; `npm run format:check` only reports unformatted files.
- `npm install` sets up a pre-commit hook that formats the files you commit, so you normally do not need to run Prettier yourself. The hook needs Node.js 22.5 or newer. If a staged file has a syntax error, the commit is blocked until you fix it; `git commit --no-verify` skips the hook in an emergency.
- CI runs lint, unit tests with the coverage check, the format check, and the Playwright tests on every push and pull request. The format check is required: unformatted files fail CI.

Prettier uses its default style (double quotes, 2-space indent) and is pinned to an exact version so formatting stays the same on every machine. Generated files, `samples/`, `Resources/`, and `administrative/` are excluded in `.prettierignore`. `.gitattributes` keeps LF line endings on every OS, including Windows, so the format check gives the same result everywhere.

ESLint uses the recommended rules. `server.js`, `test/`, `e2e/`, and `playwright.config.js` are linted as CommonJS with Node globals; everything else as browser code. Exceptions, set in `eslint.config.js`:

- `no-unused-vars` is off in `csv_loader.js` and `data_processer.js`. They are classic browser scripts that share functions through globals, so the rule reports false positives (tracked in #37).
- `no-control-regex` is off in `graphExport.js`, which strips control characters from exported file names on purpose.

The repo-wide formatting commit is listed in `.git-blame-ignore-revs`. To skip it in local `git blame`, run `git config blame.ignoreRevsFile .git-blame-ignore-revs`.

## Test coverage

- `npm run test:coverage` runs the unit tests with coverage and compares lines, branches, and functions against `coverage-baseline.json`. CI runs this instead of `npm test`. It needs Node.js 22.5 or newer.
- The baseline is a ratchet that only goes up. CI fails if any number drops below it. CI also fails if a number goes up and the baseline wasn't raised; copy the `Current:` numbers from the output into `coverage-baseline.json` and commit it.
- Only source files that the unit tests load are counted. Playwright tests are not.
- Tests must load source files by their real path (a `filename` option for `vm` scripts, a `file://` URL for `import`). Otherwise coverage cannot see the file.
