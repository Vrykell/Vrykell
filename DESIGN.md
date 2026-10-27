---
version: alpha
name: Vrykell
description: A compact terminal workbench with quiet chrome, readable command output and precise blue actions.
colors:
  primary: "#2C67C5"
  favorite: "#F5C400"
  dark-canvas: "#202020"
  dark-card: "#303030"
  dark-field: "#3C3C3C"
  dark-text: "#EBEDF0"
  light-canvas: "#F7F8F9"
  light-field: "#FFFFFF"
  light-text: "#242B30"
typography:
  sans:
    fontFamily: "system-ui, sans-serif"
    fontSize: "14px"
  mono:
    fontFamily: "ui-monospace, monospace"
    fontSize: "14px"
rounded:
  DEFAULT: "8px"
  block: "14px"
spacing:
  small: "4px"
  control-gap: "8px"
  content-gap: "12px"
  section: "16px"
components:
  compact-action:
    height: "28px"
  opacity-track:
    height: "4px"
  opacity-thumb:
    size: "12px"
---

# Design System

## Overview

All four functional workspaces use the same layout-owning tab and scoped group model. `GroupedTabList` owns group cards, reorder feedback, rename input, action menus, color footers and confirmation dialogs. `WorkspacePaneCanvas` owns split geometry, placement and responsive fitting in every scope. Domain providers supply resource presentation and creation tools; they do not add their own group or pane treatment. A resource-picker selection opens or selects the owning container; split placement is an explicit action. Group deletion closes/deletes every member after all guards complete; archive remains a separate history-preserving action.

Each common-workspace tab contains its complete pane layout. Switching tabs preserves that layout and each content host. The start page is an empty-state fallback and disappears when a content tab exists. Opening a resource creates or selects its own tab; only an explicit split changes an existing layout. Pane zoom is absent. Existing tab-strip controls own split, merge and move actions; panes do not gain another toolbar. Native and external AI conversations share the side panel using the same live content owners as the main workspace. Neither conversation type adds an execution-target or directory strip above its transcript.

Shell profile identities are owned by `src/ui/icons/shellIcons.tsx`. Both supported command-shell variants use the same blue panel mark. Generic terminal actions use a neutral prompt mark. The blue panel uses theme tokens without document-global gradient identifiers, so hidden copies cannot affect visible icons.

Conversation settings use a persistent non-modal popover, not an action menu. Selecting an option or opening its profile picker does not dismiss the parent; Escape first closes the child. Resource icons reuse profile identities. Compositions use the first pane's content icon with a small circular count badge at the top right, not a separate split icon. Workspace-local splits share the composition canvas without changing navigation domains.

The reference is a compact desktop terminal workbench, not an administrative website or an integrated development environment. Output and editable text carry the screen; navigation and tools stay quiet. The signature is uninterrupted terminal state beside dense, single-line host information.

The audience manages local shells, remote hosts, files and conversations on desktop. English and Chinese interfaces share the same controls and density. There is no inferred market-specific business policy. Current user-provided prototypes govern host density, blue primary actions, yellow favorites and compact menus.

Runtime tokens remain canonical. `src/config/theme/tokens.ts` maps semantic palette properties through `paletteToCssVars`; `src/app/theme.css` defines component aliases and shared geometry. This document records intent rather than generating a second palette. The complete locale-aware font stacks live in `theme.css`; frontmatter records their system-font roles, not replacement font stacks.

## Colors

Primary actions, selected sidebar navigation icons and range progress use `--primary-action`. Selected top toolbar icons retain the neutral foreground. `--primary-button-bg` and `--primary-button-text` own solid-button contrast. Favorites use `--favorite-color` in both themes and never inherit a muted category color. Host card selection uses the neutral hover surface without a blue border. Status, shell identities, categorical tags and diagnostic colors retain independent semantic tokens.

| Document role | Runtime owner | Consumers |
|---|---|---|
| Primary | `primaryAction` → `--primary-action` → `--primary-button-bg` | Shared primary actions, send, selected action icons, range |
| Favorite | Palette amber → `--favorite-color` | Host, file and history favorite marks |
| Destructive action | `dangerAction` → `--danger-action` → `--control-danger-color` | Shared destructive controls; `dangerActionText` owns filled-button contrast |
| Canvas/card/field | Palette → `--canvas`, `--card-bg`, `--field-bg` | Pages, cards, shared fields |
| Text | Palette → `--text-primary`, `--text-secondary`, `--text-muted` | Shared controls and readable metadata |

## Typography

Use existing system UI fonts with Chinese-capable fallbacks. Labels use `--fs-label` (13 px at default scale), captions use 12 px and body text uses 14 px. Terminal output and addresses use the established monospaced stack. Preserve user font scaling and measure clipping at actual display scaling; do not compensate by enlarging every card.

## Layout

The desktop shell owns a bounded content region. Each page owns its own scroller; a table must not impose its layout on an editor or long form. Host filter controls and group chips scroll together inside the host browser. Lists never wrap identity, address, resource metrics or actions onto a second line: truncate or omit secondary information first. Cards may flow into fewer columns.

Compact actions are 28 px high. Use shared field geometry, with explicit compact variants for dense connection forms. Menus stay anchored to their trigger, fit the viewport and scroll internally. The creation picker is a small dropdown with a bounded profile list, not a centered startup screen.

Terminal and external-session creation share the same anchored 304 px dropdown, compact profile rows and bounded list. Availability remains readable without oversized cards. Resource and all-workspace switcher actions live in each tab toolbar, not the window titlebar or left navigation. Tab-toolbar actions have neutral resting states even when their controlled panel is open; hover and keyboard focus remain visible. End-aligned action menus use their measured width, never a guessed offset. Host forwarding creation reuses the environment-variable add-row treatment without an empty-rule caption.

The leading menu occupies a separate fixed slot; the tab scroll viewport cannot pass underneath it. An eight-pixel inner gutter preserves the outward tab corner without an oversized gap. Switching and domain tools precede opening and creation, with creation at the far right. A plus always creates a new item; opening an existing file uses the shared folder mark. At extremely narrow titlebar widths, search becomes icon-only with its accessible name intact and no overflowing shortcut badge.

The common workspace has a full-width, reorderable left-navigation row. The all-workspace dropdown only switches existing tabs. One ordered strip holds existing resource references; its right-hand toolbar contains focused-resource tools, split, opening and creation actions, with no extra toolbar above or below the strip. Terminal and mixed panes reuse `SplitPaneLayout`, `SplitPaneSurface`, `SplitDivider` and `PlacementOverlay`; there are no custom pane captions or replacement splitter visuals. The start page uses the existing launcher header, lead action, statistics and compact resource rows. Presentation reserves at least 360 px per horizontal pane and 200 px vertically, stacks narrow splits and owns scrolling when height is insufficient. Resource ownership and close guards stay in existing domain stores.

With resource collection enabled, host tables separate identity, status and each enabled resource metric. Each metric heading aligns to its track's left edge. Missing-value dashes align with the heading text's center; fixed table tracks keep six-pixel value gaps. Card tracks use a shorter 48-percent proportion, capped at 180 px, and a six-pixel thickness. Addresses move to hover hints and keyboard-accessible details. With collection disabled, columns return to name, address, tags and recent connection. Failed cards omit recent connection time. Host action menus use the normal text-only treatment without a details entry. Forwarding is a child of host management and shares its horizontal insets. Breadcrumb ancestors and current destinations use one font size; only the current destination gains weight.

## Elevation & Depth

Static content is separated primarily by surface tone. Floating menus and dialogs use the shared floating treatment. Do not add ornamental top rules, individual list-row borders or unrelated shadows to convey hierarchy.

## Shapes

Shared inner corners are 8 px and block corners are 14 px. Favorites and tag filters are compact capsules; primary split buttons are one continuous shape with a single internal separator. Favorite marks in the editor header have no background.

## Components

Memory settings uses the existing grouped settings rows: a quiet aggregate status row with reload, followed by a review row with an explicit assistant action. The panel has no nested statistic cards, invented switches or bulk activation. It never lists or edits memory bodies. Loading and failures reuse the shared status and persistent notification components. Assistant review opens its own briefly named conversation through the usual authorization path.

The common start page groups terminal profiles and saved hosts, native and external conversations, and file creation and opening as distinct tasks. It reuses the launcher grid and typography rather than promoting the default terminal as the only creation path. Mixed history rows show a shared split icon, pane count and member types; expansion reveals members without loading their transcripts. Terminal panes are individually placed existing hosts, not nested terminal workspaces.

Use `SidebarItem`, `TextInput`, `SegmentedControl`, `TagInput`, `Select`, `CheckboxMenu`, `ContextMenu`, `ErrorBox`, `ConfirmDialog`, `Toggle` and the existing button family. Connection authentication has four explicit parallel modes; settings option groups use authored selects. Opacity uses `RangeInput`, a thin blue track with native range keyboard semantics.

Action-menu labels share a left-aligned inset without an empty icon column. Selection checks sit at the far right, alongside the shared trailing shortcut and submenu affordances. Explicit multi-select checkbox controls retain their checkbox semantics.

Resource-switching menus use the shared 320 px bounded variant, with single-line ellipsis and full accessible names and themed hover hints. Group headers retain their existing connected card geometry and color treatment. Empty groups disappear when their last tab leaves. File-only groups do not offer session archival; files and comparisons remain in live workspace restoration, outside session history.

External conversations select an application execution target with the shared select in the existing composer status row, or in the sidebar settings panel. The default is discussion only. Both sidebar backends share a conversation title and the same history, settings and new actions. Agent selection lives in settings. Tool questions use vertically spaced full-width choices inside the owning transcript; integration adds no separate toolbar or notification stream. Streaming keeps the composer available and shows cancellable queued inputs above it.

Tab-toolbar menus sit four pixels below their trigger. Creation uses at most two menu levels; terminal, server and agent choices close both levels before opening the existing rich launcher, retaining the toolbar anchor rather than the disappearing menu row. Agent search, availability and project directory remain part of that shared launcher.

Main and split conversation tabs never add a title or action row inside their content. Their tools belong to the shared tab toolbar, including while an independent AI sidebar is open.

Independent conversations may generate simultaneously in main panes and the sidebar. Each composer shows only its own busy, queue and stop state. Transient model connection failures keep the existing pending reply while bounded retries run; exhaustion retains the shared inline reply error and manual retry.

Enabled controls have deliberate gray hover, visible focus, disabled and busy states. Shared segmented controls animate selection and brighten foreground on hover without changing the fill. Errors preserve readable text and expose technical details separately; retry and dismiss controls never shrink into diagnostic text. Host cards and status cells distinguish stale read failure, authentication failure and offline state inline. The editor remains a single-file text editing surface with common editing commands, explicit file destinations and guarded unsaved changes. Filename, encoding and cursor information share the bottom status line; floating search never pushes the document. Markdown preview and optional modal keybindings preserve the mounted editor buffer.

All icons come from shared icon components. Do not substitute text symbols or native disclosure triangles. Animation uses the existing 140–260 ms motion scale and respects reduced motion. Existing terminal scrollbar exceptions retain their shared owner.

Persistent errors and transient messages use the same notification card, including typography, padding, semantic icon and centered dismissal. Failures retain details and retry. The editor find strip has four equal corners and a vertically centered close control. Editor typeface, size, weight and line spacing are independent of terminal and conversation metrics. A dedicated editor preferences page owns these controls, modal keybindings, wrapping and optional line numbers; local and remote opening pages contain only target-specific destinations.

Agent selection in conversation settings uses the shared dropdown field trigger and existing rich launcher. Refused tool results share the failed badge treatment; cancellation reuses the approval badge palette. Answered questions retain only the selected option or typed answer as inset plain text; no highlighted or inactive options remain. Tool cards never add footer error messages. Live failures and explicit result review use the bottom-right error surface, while restored history stays quiet.

## Do's and Don'ts

Inline rename inputs use the shared field with a fixed 176 px target constrained by available width and an eight-pixel action gap; typing never shifts adjacent controls. Tab-card fields fit their 24 px content row. Sidebar conversation actions stay pinned to the right edge. Selected model names do not gain weight. Editor status stays one 32 px line at all widths, omitting secondary metadata before it can wrap. The filename has no trailing decoration; unsaved drafts have a separate text label. A live modal command has a centered 28 px input in that same row and returns to ordinary metadata when dismissed. Conversation recovery stays in the existing sidebar settings menu, using the shared select.

- Reuse the closest existing workflow and verify narrow and wide layouts in both themes.
- Preserve terminal, document and conversation state when changing presentation or position.
- Keep full values available through accessible labels, details or editing without forcing rows to wrap.
- Do not invent a second primary blue, a second input treatment or character icons.
- Do not turn the text editor into a project-oriented environment.
