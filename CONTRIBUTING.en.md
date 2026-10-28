# Contributing

[简体中文](CONTRIBUTING.md)

Contributions to Vrykell are welcome: reproductions, use cases, documentation, translations, tests and code. You do not need to understand the whole project to make a first contribution. Start with a small, well-defined problem. Discussion can be in Chinese or English; commit messages and code comments use English.

## Agree on the problem

Search existing issues and PRs first. Bug reports should include the version, operating system, reproduction steps, expected behavior and actual behavior. Feature proposals should describe a real workflow. Discuss substantial changes before implementing them so their scope is clear.

Remove keys, passwords, tokens, private host details and unrelated personal information from screenshots, logs and configuration. Inspect diagnostic logs before sharing them, even though they primarily contain metadata.

## Branches and PR targets

| Branch | Purpose |
| --- | --- |
| `dev` | Integration branch and target for external contribution PRs. |
| `main` | Default branch; maintainers promote changes from `dev` and build versions here. Ordinary features and fixes do not go directly here. |
| `<type>/<short-description>` | Your contribution branch, created from current `dev`. Use lowercase English and hyphens. |

Examples: `feat/remote-file-search`, `fix/terminal-resize`, `docs/setup-guide`, `test/session-restore`, `refactor/shared-menu`. Automated tools may create `codex/<short-description>` branches.

Fork the repository. Use your fork as `origin` and this repository as `upstream`:

```bash
git clone https://github.com/YOUR_USERNAME/Vrykell.git
cd Vrykell
git remote add upstream https://github.com/Vrykell/Vrykell.git
git fetch upstream
git switch -c feat/short-description upstream/dev
npm ci
git config --local commit.template .gitmessage
```

Synchronize before submitting. Merge upstream `dev` if others share your branch. Coordinate before rewriting your own branch history; never rewrite shared or upstream history.

```bash
git fetch upstream
git merge upstream/dev
git push -u origin feat/short-description
```

Open a PR from **your branch to `Vrykell/Vrykell:dev`**. The default branch is `main`, so check the base branch in the creation form. Maintainers promote reviewed changes from `dev` to `main`; ordinary contributions do not need a separate PR to `main`.

## Setup and conventions

Use Node.js 22.12+, stable Rust and your platform's desktop build prerequisites; see the [README](README.en.md#get-started). `npm run tauri dev` starts the desktop application; `npm run dev` starts the frontend only.

Read [AGENTS.md](AGENTS.md), the [development rules](docs/en/development-rules.md) and [project conventions](.agents/skills/vrykell-conventions/SKILL.md) before changing code. Also read the [security model](docs/en/security-model.md) for IPC, file access, rendering and external integrations.

- Reuse the closest existing interface and shared components, including interaction, spacing, menus, errors and icons.
- Keep type checking clean, respect module boundaries and use the shared IPC and resource owners.
- Write user-visible code strings in English and add Chinese catalog entries. Keep paired documentation translations synchronized.
- Preserve the terminal parsing and rendering architecture. Do not add an independent terminal parser or regex lookbehind.
- Do not commit credentials, private settings, build artifacts or machine-specific paths. Update lockfiles and notices with dependency changes; explain the provenance of external code and assets.
- Keep each PR focused. Features need tests; fixes need a regression case that reproduces the problem.

## Validation

Run these before every commit:

```bash
npx tsc --noEmit
npm run test
npm run check:architecture
```

| Change | Additional validation |
| --- | --- |
| Interaction, terminal, editor or workspace | Relevant `npm run test:e2e -- <spec>` cases and an actual UI check at narrow and wide sizes. |
| Backend or native integration | `cargo test --manifest-path src-tauri/Cargo.toml` and the affected platform paths. |
| Dependencies, fonts, icons or native targets | `npm run licenses:generate`, `npm run licenses:check` and a production build; commit refreshed notices. |
| Documentation or screenshots | Check links, paired languages, rendered output and original image clarity. Distinguish simulated data from measurements. |

Browser tests use one worker per shard. State which checks were not run and why; do not mark them as passed. Routine checks do not need installers; package only when validating packaging. The [CI guide](docs/en/ci.md) lists automated checks and the `main` package matrix.

### Updating screenshots

Run `npm run dev -- --port 1432 --host 127.0.0.1` in one terminal and `node --experimental-strip-types scripts/capture-readme.mjs` in another. Install the capture browser with `npx playwright install chromium` before the first run. The script renders the real frontend with sample data, without connecting to a live model or server.

Keep the 3200×1800 PNG output at 2× pixel density and a 16:9 aspect ratio. Wait for fonts and the editor to finish loading. Do not upscale old screenshots or stretch images. Preserve original-image links in the README and check desktop and narrow rendering after updates.

## Commits

Use English, an imperative subject and one of these prefixes. Keep commits small and focused:

```text
feat: add directory filters to command history
fix: preserve the cursor after resizing a pane
docs: explain the contributor setup
test: cover reconnect cancellation
refactor: share the file action menu
```

After `git config --local commit.template .gitmessage`, run `git commit` without `-m` to use the template. This setting only affects the current clone. Lines starting with `#` are omitted from the commit. Explain the problem, change and validation when useful; simple commits do not need every section.

## PRs and review

Complete the PR template with the problem, resulting behavior, related issue and actual validation. Add screenshots or a short recording for interactive changes. Use the same English prefixes for PR titles. Draft PRs are welcome for early scope discussions.

Address review feedback in implementation, tests and documentation, and keep the PR description aligned with the final change. Avoid unrelated formatting, generated files and large renames. Maintainers merge reviewed changes into `dev` and decide when to promote them to `main`.

## License

Unless explicitly stated otherwise, contributions submitted for inclusion use [Apache-2.0](LICENSE). Preserve third-party copyrights, licenses and attribution. Document the source and distribution requirements of new dependencies and assets; see [licensing](docs/en/licensing.md). Treat other contributors respectfully and discuss problems using evidence.
