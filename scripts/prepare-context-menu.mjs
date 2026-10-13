import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

if (process.platform !== 'win32') throw new Error('Context menu packaging requires Windows.');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const native = path.join(root, 'src-tauri', 'windows-context-menu');
const output = path.join(native, 'generated');
const staging = path.join(root, 'src-tauri', 'target', 'context-menu', 'package');
const arch = process.env.VRYKELL_MENU_ARCH ?? (process.arch === 'arm64' ? 'arm64' : 'x64');
if (!['x64', 'arm64'].includes(arch)) throw new Error('Context menu architecture must be x64 or arm64.');
const build = path.join(root, 'src-tauri', 'target', 'context-menu', arch);
for (const directory of [output, staging, build]) fs.mkdirSync(directory, { recursive: true });
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}).`);
}
const catalog = fs.readFileSync(path.join(root, 'src', 'i18n', 'zh.ts'), 'utf8');
const title = catalog.match(/'Open in Vrykell':\s*'([^']+)'/)?.[1];
if (!title) throw new Error('The native context menu needs its Chinese catalog entry.');
const uninstallMessage = 'Could not unregister the context menu. Disable it in application settings and retry uninstalling.';
const translatedUninstall = catalog.match(/'Could not unregister the context menu\. Disable it in application settings and retry uninstalling\.':\s*'([^']+)'/)?.[1];
if (!translatedUninstall) throw new Error('The uninstall hook needs its Chinese catalog entry.');
fs.writeFileSync(path.join(output, 'installer-translations.nsh'),
  `LangString ContextMenuUnregisterError 1033 "${uninstallMessage}"\nLangString ContextMenuUnregisterError 2052 "${translatedUninstall}"\n`, 'utf8');
const resources = path.join(build, 'menu.rc');
const resourceText = `#include <windows.h>\n101 ICON "${path.join(root, 'src-tauri', 'icons', 'icon.ico').replaceAll('\\', '/')}"\nLANGUAGE LANG_ENGLISH, SUBLANG_ENGLISH_US\nSTRINGTABLE\nBEGIN\n102 "Open in Vrykell"\nEND\nLANGUAGE LANG_CHINESE, SUBLANG_CHINESE_SIMPLIFIED\nSTRINGTABLE\nBEGIN\n102 "${title.replaceAll('"', '\\"')}"\nEND\n`;
fs.writeFileSync(resources, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(resourceText, 'utf16le')]));
run('cmake', ['-S', native, '-B', build, '-A', arch === 'arm64' ? 'ARM64' : 'x64', `-DMENU_RESOURCES=${resources}`]);
run('cmake', ['--build', build, '--config', 'Release']);
if (process.argv.includes('--test')) run('ctest', ['--test-dir', build, '-C', 'Release', '--output-on-failure']);
fs.mkdirSync(path.join(staging, 'windows-context-menu'), { recursive: true });
const dll = path.join(build, 'Release', 'VrykellExplorerCommand.dll');
const digest = createHash('sha256').update(fs.readFileSync(dll)).digest('hex');
const dllName = `VrykellExplorerCommand-${digest.slice(0, 16)}.dll`;
for (const directory of [output, path.join(staging, 'windows-context-menu')]) {
  for (const name of fs.readdirSync(directory)) {
    if (/^VrykellExplorerCommand(?:-[0-9a-f]{16})?\.dll$/.test(name) && name !== dllName) fs.unlinkSync(path.join(directory, name));
  }
  fs.copyFileSync(dll, path.join(directory, dllName));
}
const oldDll = path.join(staging, 'VrykellExplorerCommand.dll');
if (fs.existsSync(oldDll)) fs.unlinkSync(oldDll);
fs.mkdirSync(path.join(staging, 'Assets'), { recursive: true });
for (const file of ['StoreLogo.png', 'Square150x150Logo.png', 'Square44x44Logo.png']) {
  fs.copyFileSync(path.join(root, 'src-tauri', 'icons', '128x128.png'), path.join(staging, 'Assets', file));
}
const version = `${JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version}.0`;
const manifest = fs.readFileSync(path.join(native, 'AppxManifest.xml'), 'utf8')
  .replaceAll('__ARCH__', arch).replaceAll('__VERSION__', version).replaceAll('__DLL_NAME__', dllName);
fs.writeFileSync(path.join(staging, 'AppxManifest.xml'), manifest);
run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
  path.join(root, 'scripts', 'sign-context-menu.ps1'), '-StagingDirectory', staging, '-OutputDirectory', output]);
