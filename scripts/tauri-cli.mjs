import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const isBuild = args[0] === 'build';
if (process.platform === 'win32' && (isBuild || args[0] === 'dev')) {
  const targetIndex = args.indexOf('--target');
  const target = targetIndex >= 0 ? args[targetIndex + 1] : args.find(arg => arg.startsWith('--target='))?.slice(9);
  const menuArch = process.env.VRYKELL_MENU_ARCH ?? (target?.startsWith('aarch64-') ? 'arm64' : target?.startsWith('x86_64-') ? 'x64' : undefined);
  const prepare = spawnSync(process.execPath, [fileURLToPath(new URL('./prepare-context-menu.mjs', import.meta.url))], {
    env: menuArch ? { ...process.env, VRYKELL_MENU_ARCH: menuArch } : process.env,
    stdio: 'inherit', windowsHide: true,
  });
  if (prepare.error || prepare.status !== 0) process.exit(prepare.status ?? 1);
}
const hasSccache = isBuild && spawnSync('sccache', ['--version'], { stdio: 'ignore' }).status === 0;

if (isBuild && !hasSccache) {
  console.warn('sccache is not installed; this build will run without the Rust compilation cache. Install it with: cargo install sccache --locked');
}

const env = { ...process.env };
if (isBuild) env.CARGO_INCREMENTAL = '1';
if (hasSccache) env.RUSTC_WRAPPER = 'sccache';
// The AppImage step runs linuxdeploy, which ships an older binutils. Its `strip` cannot parse
// the RELR sections that newer toolchains emit, so every strip call fails and the bundle aborts.
// Skipping the pass is safe: the libraries copied into the AppDir are already stripped.
if (isBuild && process.platform === 'linux' && !env.NO_STRIP) env.NO_STRIP = '1';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const child = spawn(npm, ['run', 'tauri:cli', '--', ...args], {
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

child.on('error', (error) => {
  console.error(`Failed to start Tauri CLI: ${error.message}`);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
  if (hasSccache && isBuild) {
    spawnSync('sccache', ['--show-stats'], { stdio: 'inherit' });
  }
});
