import { useMemo } from 'react';
import { tokenizeCommand } from '../model/commandSyntax';

export default function CommandSyntax({ text }: { text: string }) {
  const tokens = useMemo(() => tokenizeCommand(text), [text]);
  return <>{tokens.map((token, index) => <span key={index} className="command-token" data-kind={token.kind}>{token.text}</span>)}</>;
}
