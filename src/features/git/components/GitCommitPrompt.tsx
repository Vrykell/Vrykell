import { useState } from 'react';
import type { GitTarget } from '@core/git';
import { gitCommitPrompt, useGitPreferences } from '@config/git';
import ToolDialog from '@ui/feedback/ToolDialog';
import ConfigTextArea from '@ui/fields/ConfigTextArea';
import { OutlineButton } from '@ui/actions/OutlineButton';
import { t } from '@i18n';

export default function GitCommitPrompt({ target, onClose }: { target: GitTarget; onClose: () => void }) {
  const [text, setText] = useState(() => gitCommitPrompt(target));
  const save = () => { useGitPreferences.getState().setCommitPrompt(target, text); onClose(); };
  return <ToolDialog label={t('AI commit prompt for this workspace…')} width={600} onClose={onClose} onSubmit={save} initialFocus="textarea">
    <div data-testid="git-commit-prompt" className="git-prompt-editor">
      <p className="git-commit-hint">{target.cwd}</p>
      <ConfigTextArea rows={9} aria-label={t('Commit prompt')} value={text} onChange={event => setText(event.target.value)} />
      <p className="git-commit-hint">{t('Leave empty to restore the default prompt.')}</p>
      <footer className="git-dialog-actions"><OutlineButton onClick={onClose}>{t('Cancel')}</OutlineButton>
        <OutlineButton className="primary-button" onClick={save}>{t('Save')}</OutlineButton></footer>
    </div>
  </ToolDialog>;
}
