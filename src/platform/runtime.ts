/**
 * Platform detection from the user agent (front-end only).
 * The webview user agent contains "Mac" on macOS (Macintosh / Mac OS X).
 */
export const isMacOS = /Mac/.test(navigator.userAgent);
export const isWindows = /Windows/.test(navigator.userAgent);
export const isLinux = /Linux/.test(navigator.userAgent) && !/Android/.test(navigator.userAgent);
export const usesCustomWindowControls = isWindows || isLinux;
