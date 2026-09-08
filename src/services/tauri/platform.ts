/**
 * 平台探测（纯前端，无需 plugin-os）。
 * Tauri webview 的 userAgent 在 macOS 上含 "Mac"（Macintosh / Mac OS X）。
 */
export const isMacOS = /Mac/.test(navigator.userAgent);
