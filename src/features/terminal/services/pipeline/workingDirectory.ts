/** Remove the URI-only slash before a Windows drive without changing POSIX or UNC paths. */
export function normalizeWorkingDirectory(path: string): string {
  return /^\/[a-z]:([/\\]|$)/i.test(path) ? path.slice(1) : path;
}

/** Read the integration's raw OSC 7 path without treating its host as a UNC share. */
export function workingDirectoryFromUri(uri: string): string | undefined {
  if (!uri.startsWith('file://')) return undefined;
  const start = uri.indexOf('/', 7);
  if (start < 0) return undefined;
  return normalizeWorkingDirectory(uri.slice(start));
}
