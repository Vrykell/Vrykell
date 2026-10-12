export type ForwardKind = 'local' | 'remote' | 'dynamic';
export interface ForwardRule {
  id: string;
  kind: ForwardKind;
  bind: string;
  port: string;
  host: string;
  targetPort: string;
}
export interface ForwardTexts { local: string; remote: string; dynamic: string }
const host = String.raw`(?:\[[0-9a-fA-F:]+\]|[\w.][\w.-]*)`;
const staticRule = new RegExp(`^(?:(${host}):)?(\\d{1,5}):(${host}):(\\d{1,5})$`);
const dynamicRule = new RegExp(`^(?:(${host}):)?(\\d{1,5})$`);
export const forwardLines = (text: string) => text.split('\n').map(line => line.trim()).filter(Boolean);

/** Parse the supported command-line forms without dropping an unrepresentable rule. */
export function parseForwardTexts(texts: ForwardTexts): ForwardRule[] | null {
  const rows: ForwardRule[] = [];
  for (const kind of ['local', 'remote', 'dynamic'] as const) {
    for (const spec of forwardLines(texts[kind])) {
      const match = spec.match(kind === 'dynamic' ? dynamicRule : staticRule);
      if (!match) return null;
      rows.push({ id: `forward-${rows.length}`, kind, bind: match[1] ?? '', port: match[2], host: match[3] ?? 'localhost', targetPort: match[4] ?? '' });
    }
  }
  return rows;
}

/** Preserve incomplete GUI rows in text so saving cannot silently discard a draft. */
export function formatForwardRules(rows: ForwardRule[]): ForwardTexts {
  const result: Record<ForwardKind, string[]> = { local: [], remote: [], dynamic: [] };
  for (const row of rows) {
    const bind = row.bind.trim();
    const prefix = bind ? `${bind.startsWith('[') || !bind.includes(':') ? bind : `[${bind}]`}:` : '';
    const target = row.host.trim();
    const host = target.startsWith('[') || !target.includes(':') ? target : `[${target}]`;
    result[row.kind].push(row.kind === 'dynamic' ? `${prefix}${row.port.trim()}` : `${prefix}${row.port.trim()}:${host}:${row.targetPort.trim()}`);
  }
  return { local: result.local.join('\n'), remote: result.remote.join('\n'), dynamic: result.dynamic.join('\n') };
}
