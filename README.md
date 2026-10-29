<div align="center">

<img src="public/app-icon.svg" width="80" height="80" alt="Vrykell" />

# Vrykell

### Terminal and AI, side by side.

A desktop terminal with command completion, a file browser, an editor and Git tools. Use local shells or SSH, and keep AI conversations and agents beside your work.

[Download](https://github.com/Vrykell/Vrykell/releases) · [Workflows](#workflows) · [Command completion](#command-completion) · [Git](#git) · [Contribute](CONTRIBUTING.en.md) · [简体中文](README.zh-CN.md)

<p>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="Apache-2.0" /></a>
  <a href="https://github.com/Vrykell/Vrykell/actions/workflows/ci.yml"><img src="https://img.shields.io/badge/CI-checks-64748b?style=flat-square" alt="CI checks" /></a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-3b82f6?style=flat-square" alt="Windows, macOS, Linux" />
</p>

</div>

<a href="docs/images/hero-workspace-en.png"><img src="docs/images/hero-workspace-en.png" width="1600" alt="Code, a build terminal and an agent in Vrykell" /></a>

## Workflows

Each tab holds up to four panes: terminals, files, AI conversations or external agents. Drag panes to rearrange them and organize tabs into named, colored groups. Terminals and conversations keep running when you switch tabs.

### Edit on the left. Build on the right.

Open a source file beside a build or test terminal. Edit, run the command and compare the result. An optional agent pane can read the relevant files and command output.

The editor includes syntax highlighting, find and replace, encoding selection, Markdown preview and Git diffs. Command blocks retain their working directory, branch, duration and exit status. You can attach a failed block to a conversation.

<a href="docs/images/scenario-build-en.png"><img src="docs/images/scenario-build-en.png" width="1600" alt="Editing code beside a build terminal" /></a>

### SSH on the left. AI on the right.

Connect to a server and check service status or deployment logs. Open AI beside the session and attach the output you want to discuss. Select the execution terminal before giving an agent a task; tool calls and approval requests appear in the conversation.

Host management covers password and key authentication, host-key confirmation and port forwarding. Direct connections support SFTP browsing, uploads, downloads and remote editing. Jump hosts work for interactive terminals; file browsing and resource monitoring through them remain limited.

<a href="docs/images/scenario-remote-en.png"><img src="docs/images/scenario-remote-en.png" width="1600" alt="A remote service check beside an AI deployment discussion" /></a>

### Run an agent beside a terminal

Start a built-in AI conversation or connect an external agent through ACP. Keep its execution terminal visible, then open files or diffs to check the changes. Conversations can run in a pane or in the sidebar.

Built-in conversations support attachments, tool permissions, skills, MCP and local memory. External agents provide their own models and tools through ACP. Available capabilities depend on the service or agent you configure.

### Other layouts

| Your task | A workspace arrangement |
| --- | --- |
| Debug an API | Run the service in one terminal, send requests in another, and keep the handler or logs nearby. |
| Investigate a failed build | Keep the failed command block, ask AI about its output, and open the affected file to check the fix. |
| Work across projects | Organize tabs into named, colored groups and collapse groups you are not using. |
| Check a remote change | Place remote files or AI beside SSH, then confirm the target before acting. |
| Review an agent's work | Compare tool records, file contents and Git diffs before continuing. |
| Repeat a workflow | Search, favorite, group and rerun commands from history. |

## Terminal, files and connections

Terminals, project files, saved hosts and AI conversations also have dedicated workspaces. Their tabs can be used on their own or combined in split panes.

### Terminal

Use classic mode for a continuous terminal or block mode to keep each command and its output together. Full-screen programs use an interactive terminal screen. Local and SSH sessions have separate tabs, directories and command histories.

Search past commands, save favorites, arrange them into groups and rerun them. A command block records the directory, branch, duration and exit status alongside its output.

#### Command completion

- History suggestions appear as you type. Local matching and file-path completion work without a model key; optional AI completion uses your configured model when local suggestions are unavailable.
- Tab completion combines built-in suggestions, supported shell completion and file paths. Path completion follows the current local or SSH directory, including quoted paths and names with spaces.
- Use `Tab` and `Shift+Tab` to cycle candidates and `Esc` to restore the original input. Suggestion acceptance shortcuts are configurable.

<a href="docs/images/single-terminal-en.png"><img src="docs/images/single-terminal-en.png" width="1600" alt="Terminal sessions and command blocks" /></a>

### Files and editor

Browse local folders or remote files over SFTP. Create files and directories, rename, copy, move and delete entries, and work with multiple selections. Uploads and downloads have a transfer list; a file can open in the built-in editor or a configured external application.

The editor supports syntax highlighting, find and replace, Markdown preview, character encodings and Vim bindings. Files stay in tabs. Read-only states, unsaved changes and save conflicts are shown before an overwrite.

<a href="docs/images/single-editor-en.png"><img src="docs/images/single-editor-en.png" width="1600" alt="Project file editing workspace" /></a>

### Git

The source control panel follows the current terminal or file, including saved SSH connections. It uses Git installed on the local machine or remote host.

- View conflicts, staged, unstaged and untracked files in a list or tree. Open a file's diff, stage or unstage it, and discard changes after confirmation.
- Review staged changes, write a commit message and commit. An optional AI action drafts a message for you to review.
- Fetch, pull and push; create, switch, rename or delete branches; merge, rebase and manage tags. Repository state determines which actions are available.
- Browse linked worktrees and switch the repository shown in the panel.

A typical review is **open the diff → stage the intended files → check the message → commit → push**. The terminal remains available for other Git commands.

### SSH hosts

Manage connections in a list or as cards and find a target by name, group or tag. A saved host can open a terminal, browse remote files, manage transfers or configure forwarding. Direct connections can also show resource status on demand.

<a href="docs/images/single-hosts-en.png"><img src="docs/images/single-hosts-en.png" width="1600" alt="Host cards and connection management" /></a>

### AI conversations

Ask a question in a plain conversation or attach text, files and images; image input requires a capable model. When a task needs execution, select its terminal environment and review tool calls and permission requests. Built-in conversations and external agents can be kept separately for each task.

<a href="docs/images/single-ai-en.png"><img src="docs/images/single-ai-en.png" width="1600" alt="A dedicated AI conversation workspace" /></a>

## Themes and fonts

Ten built-in dark and light schemes apply to the interface, editor and terminal. Dark and light selections are saved separately, with an option to follow the system. Set fonts and sizes independently for the interface, editor, terminal and chat; bundled fonts are available without a separate installation.

<a href="docs/images/theme-settings-en.png"><img src="docs/images/theme-settings-en.png" width="1600" alt="Theme settings and color scheme previews" /></a>

<a href="docs/images/theme-light-en.png"><img src="docs/images/theme-light-en.png" width="1600" alt="A light code, terminal and agent workbench" /></a>

<a href="docs/images/theme-nord-en.png"><img src="docs/images/theme-nord-en.png" width="1600" alt="A cool color scheme with grouped split workspaces" /></a>

You can also choose a local wallpaper and adjust application opacity.

## Capabilities

| Area | Available features |
| --- | --- |
| Terminal | Local shells, SSH, command blocks, classic terminal view, TUI and alternate screens, IME, copy and search. |
| Completion | History suggestions, shell and path completion, candidate cycling, configurable acceptance keys and optional AI completion. |
| Workspace | Mixed resource tabs, up to four panes, drag ordering, named groups, group colors, collapsing, pane focus and resizing. |
| AI and agents | Multiple models, bring your own key, streaming, command-output references, tool permissions, ACP, skills, MCP and local memory. |
| Files and editor | Local and SFTP browsing, multi-selection, file operations, transfers, editor tabs, encodings, Vim bindings and Markdown preview. |
| Git | Diffs, staging, commits, optional AI commit messages, fetch/pull/push, branches, merge/rebase, tags and linked-worktree browsing. |
| Remote connections | Host profiles, password and key authentication, host-key verification, port forwarding and resource monitoring over direct connections. |
| History and search | Command and session history, favorites, grouping, filters and workspace layout restoration. |
| Appearance and input | Ten built-in dark/light color schemes with system appearance support; application/terminal/editor typography, bundled fonts, shortcuts and Chinese/English interfaces. |

Screenshots use the application UI with a sample project and simulated session data. Click an image for its original resolution.

## Get started

Download Windows, macOS and Linux installers from [Releases](https://github.com/Vrykell/Vrykell/releases). The current release is **0.1.0 Beta 1**. It is an early preview; see [current boundaries](#current-boundaries) before using it for daily work. You can also run from source or build an installer with the [build guide](docs/en/ci.md).

Install Node.js **22.12+**, a stable Rust toolchain and your platform's [desktop build prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
git clone https://github.com/Vrykell/Vrykell.git
cd Vrykell
npm ci
npm run tauri dev
```

For frontend-only development, use `npm run dev` on port `1420`. To build an installer, run `npm run tauri -- build`.

<details>
<summary>Platform preparation</summary>

- **Windows**: C++ build tools, the system WebView2 runtime and the desktop SDK needed by the native context menu.
- **macOS**: command-line development tools, Perl and Make. Native SSH dependencies build from source without a separately installed system cryptography library.
- **Linux**: desktop WebView, GUI and application-indicator development dependencies; see the prerequisites above.

</details>

### Connect a model or agent

Add a model service URL, key and model in settings, then select the active configuration. Built-in conversations support native Messages and generation interfaces and OpenAI-compatible endpoints, including compatible local model services. Requests go directly to the service you configure; the application does not provide a model relay.

Configure an external agent's startup command and working directory in ACP settings. Review tool permissions before starting. With remote targets, also check the selected execution terminal and directory so the execution environment is clear.

### Current boundaries

- Sessions and composition layouts can enter history. Unsaved editor drafts and file browsing state are not a reliable way to preserve work across restarts.
- Model services, external agents and remote hosts require your configuration. Their costs and capabilities depend on the services you choose.
- Jump-host support focuses on interactive terminals; browsing and monitoring do not cover the same connection paths yet.
- Distribution signing and notarization are not configured. See [CI and packages](docs/en/ci.md).

## Contributing

Bug reports, documentation, translations, tests and code contributions are welcome. Include reproduction steps and your platform when reporting a bug. For a substantial feature, open an issue to discuss the intended behavior first.

**Contribution PRs target `dev`.** Maintainers use `main` for integration and version builds. Read the [contributing guide](CONTRIBUTING.en.md) for branch naming, setup, checks and review.

```bash
npx tsc --noEmit
npm run test
npm run check:architecture
```

Interactive changes also need matching browser regressions, and backend changes need native tests. Commit messages use English and the agreed prefixes. Commit, PR and issue templates are included.

## Community

Join the community group to share ideas, ask questions and follow the project. Group number: **1130135497**.

<a href="docs/images/community-group.jpg"><img src="docs/images/community-group.jpg" width="260" alt="Community group QR code" /></a>

## Read more

[Features and regression checklist](docs/en/feature-spec.md) · [Architecture](docs/en/architecture.md) · [Workspace compositions](docs/en/workspace-compositions.md) · [Development rules](docs/en/development-rules.md) · [Security model](docs/en/security-model.md) · [CI and packages](docs/en/ci.md) · [Known pitfalls](docs/en/pitfalls.md)

## License

Original code and documentation use the [Apache License, Version 2.0](LICENSE), except where otherwise stated. Copyright 2026 Vrykell contributors.

Third-party software, fonts and icons retain their own terms and attribution. See [NOTICE](NOTICE), [third-party notices](THIRD_PARTY_NOTICES.md) and the [licensing guide](docs/en/licensing.md). Unless explicitly stated otherwise, contributions submitted for inclusion are offered under the project license.
