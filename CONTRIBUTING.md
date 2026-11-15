# Contributing

Thanks for helping. Bugs, ideas and pull requests are all welcome. For a larger change, please open an issue first, so we can agree on the approach.

## Run it

You need Node 24 and [pnpm](https://pnpm.io) 9: `corepack enable` gives you the version `package.json` names.

```bash
pnpm install
pnpm dev
```

The app opens on http://localhost:3417 with its data in `./data`, which Git ignores. Tick "Load the demo family" on the first screen to get an invented family to work with.

If a page keeps reloading by itself in `pnpm dev`, the development cache is stale. Stop the server, run `rm -rf .next/dev` and start it again. Your data is not in there.

In `pnpm dev` you are signed in as the owner by yourself, on this computer only, so signing out brings you straight back. To try another role, open an invitation link. A build does this only with `FOLKBRANCH_LOCAL_LOGIN=1` and a `localhost` address; never set it on a server.

## Check it

| Command | What it runs |
|---|---|
| `pnpm lint` | Type checks and ESLint (the Next.js rules for React, hooks, accessibility and TypeScript) |
| `pnpm test` | Unit and integration tests |
| `pnpm audit --audit-level high` | Fails on a dependency with a known high or critical vulnerability |
| `pnpm check` | All of the above, plus a check for import cycles. Run it before you open a pull request |
| `pnpm check:full` | Everything in throwaway Docker containers and folders: browser scenarios, install without Docker, speed budgets, crash and restore scenarios. No paid model is called |
| `node tests/e2e/data-survives.mjs` | After `pnpm build && node scripts/make-bundle.mjs`: the last release fills an archive, this version opens it, restarts and crashes, and nothing entered may be lost or changed |
| `node tests/e2e/concurrent-people.mjs`, `concurrent-live.mjs`, `concurrent-agents.mjs` | After the same build: three people writing at once, a person with the assistant and an outside agent over MCP, drafts accepted after the card changed, conflicts, deletes against edits, live updates, and the server killed in the middle of writing. Nothing confirmed may be lost |

ESLint findings that were there before it was switched on are listed in `eslint-suppressions.json`, so only new ones fail. When you fix old ones, run `pnpm exec eslint . --prune-suppressions` to shrink the list.

CI runs all of this on every pull request: lint, tests, the vulnerability audit, a review of added dependencies and their licences, CodeQL code scanning, the install without Docker, the update from the last release on the same data, and the Docker image with a scan for critical vulnerabilities.

Turn on the repository's Git hooks once after cloning: `git config core.hooksPath .githooks`. They refuse a commit that names an AI assistant as author or co-author, which CI also checks: you may use any tool, but the commit is yours.

## How the code is organised

- All changes to data go through one path, `lib/ops/`. The app, REST and MCP share it, so a new operation belongs in `lib/ops/registry.ts`. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- Anything a reader can get must hide living people. Add new read tools to the reader sweep in `tests/api.test.ts`.
- A schema change: edit `lib/db/schema.ts`, run `pnpm exec drizzle-kit generate`, commit the migration. Migrations only add: never drop or rename a column or table people's data is in, since an update must open every older archive. `tests/migrations-order.test.ts` and the update check in CI guard this.
- A new word in the interface: wrap it in `t()` and add its English to `lib/i18n.ts`. `tests/i18n-coverage.test.ts` fails without it.
- A changed logo: edit the sources in `docs/brand`, then run `node scripts/make-icons.mjs`.

## Pull requests

- `main` is what is released, and work goes to `develop`. Please aim pull requests at `develop`.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org): `feat:`, `fix:`, `docs:`, `test:`.
- Note anything people will notice in `CHANGELOG.md`, under **Unreleased**. How a version is chosen and a release is cut is in [docs/RELEASING.md](docs/RELEASING.md).
- **Never commit real family data.** Tests and the demo use invented people only. Please do not attach real names or photos to issues either.

By contributing you agree that your work is licensed under [AGPL-3.0](LICENSE).
