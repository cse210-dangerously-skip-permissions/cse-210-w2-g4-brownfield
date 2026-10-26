# Contributing

Short version: branch off `main`, one small PR per change, someone else reviews, CI green, squash merge.

## Setup

- Use Node.js 22.5 or newer (`node -v` to check).
- Run `npm install`. It installs dependencies and a pre-commit hook that formats the files you commit.

## Workflow

1. Branch from `main`, named `yourname/short-topic`.
2. Keep each PR to one responsibility. Split mixed work into separate PRs (for example, keep config-only changes separate from implementation).
3. Run the local checks below.
4. Open a PR and fill in the template. Title it with a conventional commit: `type: short summary` (feat, fix, docs, test, refactor, chore, ci). The PR title becomes the commit message on `main`.
5. Get one approving review from someone who is not the author. Requested changes block merging until resolved.
6. Squash merge, then delete the branch.

Direct pushes to `main` are disabled, and the test and e2e checks must pass before a merge. The repo admin can override in an edge case; ask with your reason.

## Local checks

```
npm run lint           # ESLint
npm run typecheck      # JSDoc type check
npm test               # unit tests
npm run test:coverage  # unit tests + coverage baseline check
npm run test:e2e       # Playwright browser tests
npm run format:check   # Prettier check only
```

- Coverage: the baseline in `coverage-baseline.json` is a ratchet. CI fails if a number drops. If your change raises coverage, copy the `Current:` numbers from the output into the baseline and commit it with your PR.
- Formatting: the pre-commit hook formats staged files, so you usually do not need to run Prettier yourself. CI also runs the format check and fails on unformatted files.

## Code style

- Prettier default style (double quotes, 2-space indent), enforced in CI.
- ESLint recommended rules; per-file exceptions live in `eslint.config.js`.
- JSDoc on new or changed functions (also in the PR template checklist). `npm run typecheck` checks it against the code.
