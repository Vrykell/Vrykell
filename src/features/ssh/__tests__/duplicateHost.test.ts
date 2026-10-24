import { expect, it } from 'vitest';
import { duplicateHost } from '../components/useHostMetadataMenu';

it('duplicates configuration without inheriting credentials, history or automatic listeners', () => {
  const source = { id: 'source', name: 'Production', host: 'prod.test', user: 'root', authMethod: 'password' as const, password: 'secret', hasPassword: true, lastOpenedAt: 123,
    forwardingRules: [{ id: 'forward', name: 'Database', kind: 'local' as const, bind: '127.0.0.1', port: 5432, host: 'localhost', targetPort: 5432, autoStart: true }] };
  const duplicate = duplicateHost(source);
  expect(duplicate.id).not.toBe(source.id);
  expect(duplicate).toMatchObject({ host: source.host, user: source.user, hasPassword: false });
  expect(duplicate.password).toBeUndefined(); expect(duplicate.lastOpenedAt).toBeUndefined();
  expect(duplicate.forwardingRules?.[0].id).not.toBe(source.forwardingRules[0].id);
  expect(duplicate.forwardingRules?.[0].autoStart).toBe(false);
  expect(source.forwardingRules[0].autoStart).toBe(true);
});
it('migrates copied legacy listeners into disabled automatic rules', () => {
  const duplicate = duplicateHost({ id: 'source', name: 'Host', host: 'host.test', user: 'root', authMethod: 'key', localForwards: ['8080:localhost:80'] });
  expect(duplicate.localForwards).toEqual([]);
  expect(duplicate.forwardingRules).toEqual([expect.objectContaining({ kind: 'local', port: 8080, targetPort: 80, autoStart: false })]);
});
