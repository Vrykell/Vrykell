import { z } from 'zod';
import type { ToolExecutionOptions } from 'ai';
import { buildTools, type ToolContext } from '../tools';
import { resolveApproval } from '../stores/permissions';
import type { ToolRun } from '../model/messageParts';
import { t } from '@i18n';

const names = ['run_command', 'read_terminal', 'terminal_keys', 'read_file', 'write_file', 'edit_file', 'list_dir', 'search_files', 'ask_user'] as const;
interface AppTool {
  description?: string;
  inputSchema: z.ZodType;
  execute?: (input: unknown, options: ToolExecutionOptions<unknown>) => unknown;
}
export interface ApplicationToolDescriptor { name: string; description?: string; inputSchema: Record<string, unknown> }
export interface ApplicationToolResult { content: Array<{ type: 'text'; text: string }>; isError: boolean }

function toolsFor(context: ToolContext): Record<string, AppTool> {
  return Object.fromEntries(Object.entries(buildTools(context)).filter(([name]) => names.includes(name as typeof names[number]))) as unknown as Record<string, AppTool>;
}

export function applicationToolCatalog(): ApplicationToolDescriptor[] {
  return Object.entries(toolsFor({ tabId: 'catalog', paneId: '', setToolState: () => {} })).map(([name, tool]) => ({
    name, description: tool.description, inputSchema: z.toJSONSchema(tool.inputSchema),
  }));
}

export class ApplicationToolSession {
  private controller = new AbortController();
  private tools: Record<string, AppTool>;
  private tail = Promise.resolve();
  private blocked = false;
  private asked = false;
  private calls = new Map<string, ToolRun>();

  constructor(context: ToolContext, private onTool: (run: ToolRun) => void) {
    this.tools = toolsFor({ ...context, signal: this.controller.signal, setToolState: (id, state, extra) => {
      const run = this.calls.get(id);
      if (run && !this.controller.signal.aborted) { Object.assign(run, { state }, extra); this.onTool({ ...run }); }
    } });
  }

  close() {
    this.controller.abort();
    for (const [id, run] of this.calls) {
      if (['running', 'approval-pending', 'input-pending'].includes(run.state)) {
        run.state = 'cancelled'; run.endedAt = Date.now(); this.onTool({ ...run });
      }
      resolveApproval(id, 'deny');
    }
  }

  call(requestId: string, name: string, args: unknown): Promise<ApplicationToolResult> {
    const queued = this.tail.then(() => this.execute(requestId, name, args));
    this.tail = queued.then(() => undefined, () => { this.blocked = true; });
    return queued;
  }

  private async execute(requestId: string, name: string, args: unknown): Promise<ApplicationToolResult> {
    const error = (message: string): ApplicationToolResult => ({ content: [{ type: 'text', text: message }], isError: true });
    if (this.controller.signal.aborted) return error('The agent turn is no longer active.');
    if (this.blocked) return error('A previous tool call was denied. Explain the result and finish this turn. Do not ask for confirmation again; wait for a new user message.');
    if (name === 'ask_user' && this.asked) return error('A question was already asked in this turn. Use its answer and finish without asking again.');
    const tool = this.tools[name];
    if (!tool?.execute || !(tool.inputSchema instanceof z.ZodType)) return error('This tool is unavailable. Terminal tools require an explicitly selected execution terminal; remote terminals cannot use local file tools.');
    const parsed = await tool.inputSchema.safeParseAsync(args);
    if (!parsed.success) return error('Invalid tool arguments. Check the advertised input schema.');
    if (this.controller.signal.aborted) return error('The agent turn is no longer active.');
    if (name === 'ask_user') this.asked = true;
    const run: ToolRun = { toolCallId: `app-mcp-${requestId}`, toolName: name, input: parsed.data as Record<string, unknown>, startedAt: Date.now(), state: 'running' };
    this.calls.set(run.toolCallId, run);
    this.onTool({ ...run });
    try {
      const result = await tool.execute(parsed.data, { toolCallId: run.toolCallId, messages: [], context: undefined, abortSignal: this.controller.signal });
      const denied = typeof result === 'object' && result !== null && 'denied' in result && result.denied === true;
      const cancelled = this.controller.signal.aborted || typeof result === 'object' && result !== null && 'cancelled' in result && result.cancelled === true;
      const failed = typeof result === 'object' && result !== null && 'ok' in result && result.ok === false;
      this.blocked ||= denied;
      const output = JSON.stringify(result ?? { ok: false, error: 'Tool unavailable' });
      const oversized = new TextEncoder().encode(output).length > 240_000;
      const text = oversized ? JSON.stringify({ ok: false, error: 'Tool result exceeds its limit. Request a smaller range.' }) : output;
      run.output = text.length > 8000 ? JSON.stringify({ result: text.slice(0, 7600), truncated: true }) : text;
      run.modelOutput = text;
      run.state = cancelled ? 'cancelled' : denied ? 'denied' : failed ? 'error' : 'done'; run.endedAt = Date.now();
      this.onTool({ ...run });
      return { content: [{ type: 'text', text }], isError: failed || denied || cancelled || oversized };
    } catch {
      run.state = this.controller.signal.aborted ? 'cancelled' : 'error';
      run.error = t(this.controller.signal.aborted ? 'Tool call cancelled.' : 'Application tool failed.');
      run.endedAt = Date.now(); this.onTool({ ...run });
      this.blocked = true;
      return error(run.error);
    } finally { this.calls.delete(run.toolCallId); }
  }
}
