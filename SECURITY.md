# Security policy

[简体中文](SECURITY.zh-CN.md)

## Reporting a vulnerability

Please keep vulnerability details, exploit code, credentials and private data out of public issues and pull requests.

Use the repository's [private vulnerability report form](https://github.com/Vrykell/Vrykell/security/advisories/new) to report a vulnerability. If the form is unavailable, open an issue asking maintainers for a private reporting channel, without describing the vulnerability or attaching sensitive material. Wait for that channel before sending details.

Include the affected version or source commit, platform, reproduction steps, expected and observed behavior, and the permissions or interaction required. Use sample data and remove credentials from logs and screenshots. Coordinate public disclosure with maintainers after a fix is available.

## Supported versions

Security fixes target the current development branch and the next preview release. Older preview installers may remain affected; they do not receive a separate long-term support guarantee. Release notes identify the source revision and validation available for each package.

## Current boundaries

- This application runs terminal commands with your user permissions. A compromised renderer or an external program you start can act with those permissions.
- External agents and installed skills are untrusted programs or instructions. Review their source, permissions and execution target before use.
- Stored credentials use the system credential store on macOS and per-user encryption on Windows. On Linux and other platforms, `~/.vrykell/secrets.json` is plaintext, protected by file permissions rather than encryption. Do not sync, publish or share it.
- Preview installers currently lack distribution signing and notarization. A checksum verifies downloaded bytes; it does not independently establish the publisher or source revision.

See the detailed security model in [English](docs/en/security-model.md) or [中文](docs/zh/security-model.md). Private vulnerability reporting is enabled. Maintainers must protect the default branches before accepting public contributions, and review historical automation logs and artifacts before publishing them further.
