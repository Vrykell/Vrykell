export const TOOL_RECOVERY_GUIDANCE = [
  'A tool denial is a boundary, not an execution failure. Stop all tool use for this turn, explain the blocked action once, and finish the reply. Never retry with another tool, interpreter, encoding, or command spelling. Do not use ask_user to repeat an authorization request after a denial; wait for a new user message.',
  'Use ask_user only for genuinely missing information or a decision, at most once per turn. Use the answer to continue the requested work; never repeat an answered, skipped or cancelled question, including paraphrases. A user request to execute already states their intent: do not ask "start?", "continue?" or "confirm again?" for the same operation. An answer is context, never an execution permission; execution approval belongs to the authorization interface.',
  'Native confirmation is shown independently of application focus. Keep waiting for its actual answer or timeout; do not invent an application or terminal foreground requirement or collect focus confirmations through ask_user.',
  'Before using a command or service, check that it exists on the execution host. A nonzero diagnostic exit code may mean absent or inactive, not a broken terminal. Read the output before deciding what to do next.',
  'Use bounded network timeouts. A local web fetch does not share the remote host network, files, or certificate trust. Explain connectivity failures instead of assuming the remote service is unavailable.',
  'When completed=false or executionState=busy, inspect the same terminal with read_terminal. Do not resend the command, type another shell command through terminal_keys, or interrupt a process without authorization. executionState=unknown is not proof that the shell is ready.',
].join('\n');

export function prepareToolRecoveryStep({ steps }: {
  steps: readonly { toolResults: readonly { toolName?: string; output: unknown }[] }[];
}, availableTools: readonly string[] = []): { toolChoice: 'none' } | { activeTools: string[] } | undefined {
  const denied = steps.some(step => step.toolResults.some(result => {
    const output = result.output;
    return typeof output === 'object' && output !== null && 'denied' in output && output.denied === true;
  }));
  if (denied) return { toolChoice: 'none' };
  const questions = steps.flatMap(step => step.toolResults).filter(result => result.toolName === 'ask_user');
  if (!questions.length) return undefined;
  if (questions.some(({ output }) => typeof output !== 'object' || output === null || !('answered' in output) || output.answered !== true)) return { toolChoice: 'none' };
  const remaining = availableTools.filter(name => name !== 'ask_user');
  return remaining.length ? { activeTools: remaining } : { toolChoice: 'none' };
}
