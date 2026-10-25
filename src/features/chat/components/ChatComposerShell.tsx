/**
 * ChatComposerShell — the input area's markup, in one place.
 *
 * The AI panel and the harness page are the same surface seen from two sides, and the local chat is
 * moving into the harness page: the markup lives here so neither side re-invents it. The class names
 * are the panel's own (`chat-composer-wrap` / `terminal-composer` / `chat-composer-input` /
 * `chat-input-status`), so the shared stylesheet and the layout specs keep working untouched.
 *
 * The shell is deliberately dumb: heading, hints, input and status arrive as nodes, and every
 * decision (which model, which approval mode, whether sending) stays in the caller.
 */
import type { ReactNode } from 'react';
import { Zap } from '@ui/icons';

export default function ChatComposerShell({ heading, hints, tray, children, status }: {
  /** Left side of the heading row: what this conversation is. */
  heading: ReactNode;
  /** Right side of the heading row: usually the Enter hint. */
  hints: ReactNode;
  /** Context tray above the input (attachments, references); omit when there is nothing. */
  tray?: ReactNode;
  /** The input row itself, typically a lead glyph plus the text area. */
  children: ReactNode;
  /** The bottom row: send or stop, and anything that belongs beside them. */
  status: ReactNode;
}) {
  return (
    <div className="chat-composer-wrap">
      <div className="terminal-composer chat-composer">
        <div className="terminal-composer-heading">
          <span className="chat-composer-title">{heading}</span>
          <span className="composer-key-hints">{hints}</span>
        </div>
        {tray}
        <div className="chat-composer-input"><Zap size={20} aria-hidden="true" className="chat-composer-lead" />{children}</div>
        <div className="chat-input-status">{status}</div>
      </div>
    </div>
  );
}
