/**
 * 平台探测（纯前端，无需 plugin-os）。
 * Tauri webview 的 userAgent 在 macOS 上含 "Mac"（Macintosh / Mac OS X）。
 */
export const isMacOS = /Mac/.test(navigator.userAgent);
export const isWindows = /Windows/.test(navigator.userAgent);
export const isLinux = /Linux/.test(navigator.userAgent) && !/Android/.test(navigator.userAgent);
export const usesCustomWindowControls = isWindows || isLinux;
/** Window effects use the native material APIs, which Linux webviews do not expose. */
export const supportsNativeMaterial = isWindows || isMacOS;
