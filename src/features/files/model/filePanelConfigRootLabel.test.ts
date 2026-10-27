import { expect, it } from 'vitest';
import { filePanelConfigFor } from '@features/files/model/filePanelConfig';
import { t } from '@i18n';

it('localizes the local drive root label', () => {
  expect(filePanelConfigFor({ kind: 'local' }).rootLabel).toBe(t('This PC'));
});
