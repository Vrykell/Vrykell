# Licensing and redistribution

## Project scope

Original project code and documentation are licensed under Apache-2.0, except where otherwise stated. The copyright notice is `Copyright 2026 Vrykell contributors`. The full license is in the root `LICENSE`; the project scope and third-party exceptions are in `NOTICE`.

External code, fonts, icons and other materials retain their original licenses. Their inclusion does not transfer their copyright to this project or grant rights to external trademarks. Preserve original notices in their original language.

## Generate and verify notices

With the locked frontend dependencies installed and the native package manager available, run:

```sh
npm run licenses:generate
npm run licenses:check
npm run build
```

The generator examines frontend output modules, imported icon collections, bundled font provenance and native dependencies for the reference targets `x86_64-pc-windows-msvc`, `aarch64-apple-darwin` and `x86_64-unknown-linux-gnu`. Native metadata resolution may download missing locked packages. It does not build installers or alter the lockfiles.

The generated file is `public/legal/THIRD_PARTY_NOTICES.txt`. It contains component versions, license expressions, source URLs and original license/notice texts. The native inventory is conservative and includes build dependencies; inclusion does not imply that every entry is linked into every target. License texts omitted from published package archives are retained in `licenses/third-party/` with their upstream source records where available.

Regenerate whenever a dependency, imported asset, bundled font, native feature or target changes. Commit the refreshed notices. Verification fails for missing metadata, missing license texts or stale generated output. New manual overrides must be checked against the actual upstream version and retain original copyright notices.

## Source availability

Exact-version native source archives are linked in the generated inventory. Covered source, including unmodified MPL-2.0 code, remains available under its original terms at those locations. Keep those source links and the corresponding license texts with redistributed executables. If covered files are modified, make the corresponding modified source available under the required terms and update the notice to point to that source. The project license does not override file-level source obligations.

Bundled fonts remain under OFL-1.1. Preserve their original copyright and license information, reserved font name declarations and conversion provenance. Format conversion must preserve the original font data and equivalent metadata to qualify as compression-only conversion; other changes require a separate license review.

## Binary distributions

The package configuration includes the root `LICENSE`, `NOTICE`, generated third-party inventory and the five font license files under the installed `legal` resource directory. The generated inventory also travels with the frontend assets. The installer license field references the root license; package metadata declares Apache-2.0.

Before publishing an installer, review its actual native payload, including system runtime libraries copied into self-contained packages. Add their original notices and any required source or relinking information. The generated source-level inventory does not certify unbuilt platform packages. Regenerate for additional architectures or enabled features.

Preserve per-component notices even when minification removes comments. Application names and external marks are not sublicensed by the project license; integration references do not imply endorsement.
