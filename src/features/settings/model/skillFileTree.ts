export interface FileNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: FileNode[];
}

/** Builds the flat relative paths of a skill into a renderable directory tree. */
export function buildFileTree(files: string[]): FileNode[] {
  const root: FileNode[] = [];
  const map = new Map<string, FileNode>();
  for (const file of files) {
    const parts = file.split('/');
    let current = root;
    let currentPath = '';
    for (let index = 0; index < parts.length; index++) {
      const name = parts[index]!;
      currentPath = currentPath ? `${currentPath}/${name}` : name;
      const isDir = index < parts.length - 1;
      let node = map.get(currentPath);
      if (!node) {
        node = { name, path: currentPath, isDir, children: isDir ? [] : undefined };
        map.set(currentPath, node);
        current.push(node);
      }
      current = node.children ?? [];
    }
  }
  return root;
}
