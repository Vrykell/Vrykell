# Continuous integration and packages

The workflow in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) runs on
pushes to `main` and pull requests targeting `dev` or `main`. Changes limited to
documentation, `.github/` files or the README screenshot script do not trigger it. It can also be started manually.

- The frontend job checks types, unit tests, architecture boundaries and the production build.
- Automatic runs only perform the frontend checks on a Linux runner.
- Manual `full` runs add four browser test shards and backend tests on all three desktop platforms, including the native context menu and generated third-party inventory checks on Windows. Failure diagnostics are kept for three days.
- Manual `package` runs on `main` perform the frontend checks and build one selected installer target. They do not run the full browser or backend matrices; run `full` on the same commit separately when that coverage is required.

`dev` is the integration branch and `main` is the default branch. Merge into `main`,
then use Actions → CI → Run workflow to select `full` or `package`. For a package,
select `main` and the desired target; repeat only for additional platforms needed.

The available targets produce a 64-bit installer for Windows, 64-bit `.deb` and
`.AppImage` packages for Linux, and separate ARM64 and Intel `.dmg` packages for
macOS. Open the successful workflow run and download its `vrykell-<target>-<commit>`
artifacts within three days. Each artifact is tied to the exact built commit. The
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
