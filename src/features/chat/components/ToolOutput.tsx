import type { ReactNode } from 'react';
import { t } from '@i18n';
import CopyButton from '@ui/actions/CopyButton';

/** References and tool results share one output frame and copy target. */
export default function ToolOutput({ framed, text, children, copyTestId = 'tool-output-copy' }: {
  framed: boolean; text: string; children: ReactNode; copyTestId?: string;
}) {
  return <div className="ai-tool-frame" data-framed={framed}>
    {children}
    {framed && text.length > 0 && <CopyButton className="ai-tool-copy" testId={copyTestId}
      text={text} label={t('Copy output')} />}
  </div>;
}
