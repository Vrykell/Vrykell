# Third-party notices

The project's Apache-2.0 license covers original project code and documentation. Dependencies, fonts, icons and other external materials retain their own licenses and copyright notices.

The complete generated inventory, original notices, license texts and exact-version source locations are in [public/legal/THIRD_PARTY_NOTICES.txt](public/legal/THIRD_PARTY_NOTICES.txt). This file is included in the frontend distribution and the installed application's `legal` resource directory. Texts are deduplicated by content hash; every component references its corresponding full text.

| Material | Terms and attribution |
| --- | --- |
| Frontend modules | Original package licenses and notices, including their own bundled third-party notices, are retained in the generated inventory. |
| Native dependencies | The inventory covers three reference desktop dependency graphs, including build dependencies. Original licenses remain applicable. Exact-version source archives are linked for covered source, including MPL-2.0 components. |
| Bundled native transport and cryptography | The original native license texts are included separately from the wrapper packages. The bundled database engine is public domain; its source and copyright statement are linked in the inventory. |
| Bundled fonts | OFL-1.1; the five original notices remain in [public/fonts](public/fonts/). Provenance, conversion details and checksums are in [the font manifest](public/fonts/manifest.json). Font outlines and author/license metadata are retained during WOFF2 compression. |
| Editor icon font | Codicons artwork: Microsoft and contributors, CC-BY-4.0. Redistributed for embedded editor controls without project artwork changes. Its code has a separate MIT license. Source: <https://github.com/microsoft/vscode-codicons>. |
| Other imported icons | Original notices for the imported icon collections are included in the inventory. Brand marks identify supported integrations and remain subject to their owners' trademark rights. |

The inventory covers modules found in the frontend output, not every optional package installed by the package manager. Unused asset collections and optional runtimes must be reviewed before they are imported or redistributed. Do not assume that a package's code license also covers its artwork or brand marks.

Platform libraries added by a particular installer are outside this source-level inventory. Before distributing that installer, include its additional native library notices and fulfill any applicable source-availability or relinking requirements.

Regeneration and distribution procedures: [English](docs/en/licensing.md) · [中文](docs/zh/licensing.md).
