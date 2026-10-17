import { describe, expect, it } from 'vitest';
import applicationManifest from '../../../src-tauri/windows-context-menu/application.manifest?raw';
import hostManifest from '../../../src-tauri/windows-context-menu/shell_host.manifest?raw';
import packageManifest from '../../../src-tauri/windows-context-menu/AppxManifest.xml?raw';
import nativeBuild from '../../../src-tauri/windows-context-menu/CMakeLists.txt?raw';

const identityNamespace = 'urn:schemas-microsoft-com:msix.v1';

function parseManifest(source: string): Document {
  const document = new DOMParser().parseFromString(source, 'application/xml');
  expect(document.querySelector('parsererror')).toBeNull();
  return document;
}

describe('shell package identity isolation', () => {
  it('keeps the main application outside the shell package identity', () => {
    const application = parseManifest(applicationManifest);
    expect(application.getElementsByTagNameNS(identityNamespace, 'msix')).toHaveLength(0);
    expect(application.getElementsByTagName('requestedExecutionLevel')[0]?.getAttribute('level')).toBe('asInvoker');
    expect(application.getElementsByTagName('supportedOS')).toHaveLength(1);
  });

  it('assigns matching package identity to the dedicated host', () => {
    const host = parseManifest(hostManifest);
    const packaged = parseManifest(packageManifest);
    const identity = packaged.getElementsByTagName('Identity')[0]!;
    const application = packaged.getElementsByTagName('Application')[0]!;
    const hostIdentities = host.getElementsByTagNameNS(identityNamespace, 'msix');
    expect(hostIdentities).toHaveLength(1);
    expect(application.getAttribute('Executable')).toBe('windows-context-menu\\VrykellShellHost.exe');
    expect(hostIdentities[0]!.getAttribute('publisher')).toBe(identity.getAttribute('Publisher'));
    expect(hostIdentities[0]!.getAttribute('packageName')).toBe(identity.getAttribute('Name'));
    expect(hostIdentities[0]!.getAttribute('applicationId')).toBe(application.getAttribute('Id'));
  });

  it('embeds the identity manifest into the native host target', () => {
    expect(nativeBuild).toMatch(/add_executable\(VrykellShellHost\s+shell_host\.cpp\s+shell_host\.manifest\s*\)/);
  });
});
