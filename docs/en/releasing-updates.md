# Publishing signed updates

The About page follows stable releases only. Existing prereleases do not provide a stable update feed. A signed stable release must be published before installed clients can receive it; an unavailable feed reports a retryable error.

The public verification key lives in `src-tauri/tauri.conf.json`. Preserve the matching private key outside the repository in protected storage and back it up securely. The local key is stored under the current user's `.tauri` directory. Configure the repository secret `TAURI_SIGNING_PRIVATE_KEY` with its contents; set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` only when the key has a password. Never commit either value. Losing or replacing the key prevents existing clients from verifying new packages.

1. Align versions in `package.json`, its lockfile, `src-tauri/Cargo.toml`, its lockfile and `src-tauri/tauri.conf.json`. Use a stable `MAJOR.MINOR.PATCH` version.
2. Run the required checks and merge the intended release commit into `main`.
3. Manually run **Release signed updates** on `main` with the matching `vMAJOR.MINOR.PATCH` tag. Leave `publish` disabled to prepare a reviewable draft.
4. The workflow builds signed packages for all four configured desktop targets. It resolves draft asset endpoints to public download links using the draft's asset inventory, then validates all four entries in `latest.json` before allowing publication. This finalization changes only the manifest and preserves package signatures. Inspect the draft and exercise upgrade on supported platforms.
5. Publish the verified draft as the latest stable release, or rerun the workflow for the same unchanged commit with `publish` enabled. Published releases cannot be overwritten by this workflow.

Application checks and downloads never install silently. The user confirms installation/restart, resolves unsaved editor documents, and then terminal connections close. Signature failure leaves installation unavailable. Package creation and live installation are separate, explicitly requested verification steps; unit and browser fixtures do not replace a real upgrade trial.
