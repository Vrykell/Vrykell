# Continuous integration and packages

The workflow in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) runs on
pushes and pull requests to `dev` and `main`. It can also be started manually.

- The frontend job checks types, unit tests, architecture boundaries and the production build.
- Four isolated browser jobs share the full interaction suite, each using one worker. Failure diagnostics are saved for seven days.
- The backend matrix runs locked tests on all three desktop platforms, including the native context menu and the generated third-party inventory check on the Windows runner.
- After every check passes, a push or manual run on `main` builds desktop installers. Other branches and pull requests do not build packages.

`dev` is the integration branch. Merge it into `main` to produce version builds.
The repository default branch is `main`.

The package matrix produces a 64-bit installer for Windows, 64-bit `.deb` and
`.AppImage` packages for Linux, and separate ARM64 and Intel `.dmg` packages for
macOS. Open the successful workflow run and download its `vrykell-<target>-<commit>`
artifacts within 14 days. Each artifact is tied to the exact tested commit. The
version comes from the checked-in manifests; keep `package.json`, its lockfile,
`src-tauri/Cargo.toml`, its lockfile and `src-tauri/tauri.conf.json` in sync when
bumping it.

Builds use the checked-in dependency lockfiles and the project's packaging wrapper.
The wrapper prepares the native context menu before the installer is assembled.
License resources are embedded by the bundle configuration. Review platform libraries
copied into each installer as described in the [licensing guide](licensing.md).

These workflows save build artifacts without creating a release or a version tag.
Distribution signing and notarization credentials are not configured. The native
context menu uses the existing development certificate flow; this is separate from
distribution signing. Configure distribution credentials before publishing signed
installers. CI does not need application API keys or other user credentials.
