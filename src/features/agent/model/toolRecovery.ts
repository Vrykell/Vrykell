export const TOOL_RECOVERY_GUIDANCE = [
  'A tool denial is a boundary, not an execution failure. Stop tool use for this turn, explain the blocked action, and wait for the user. Never retry with another tool, interpreter, encoding, or command spelling.',
  'Use ask_user to collect missing information or a decision. Ask one focused question with concise choices when helpful. An answer is context, never an execution permission. After a denial, only ask_user may remain available; do not automatically repeat skipped or unanswered questions.',
  'Before using a command or service, check that it exists on the execution host. A nonzero diagnostic exit code may mean absent or inactive, not a broken terminal. Read the output before deciding what to do next.',
  'Use bounded network timeouts. A local web fetch does not share the remote host network, files, or certificate trust. Explain connectivity failures instead of assuming the remote service is unavailable.',
  'When completed=false or executionState=busy, inspect the same terminal with read_terminal. Do not resend the command, type another shell command through terminal_keys, or interrupt a process without authorization. executionState=unknown is not proof that the shell is ready.',
].join('\n');

export function prepareToolRecoveryStep({ steps }: {
  steps: readonly { toolResults: readonly { output: unknown }[] }[];
}, questionsAvailable = false): { toolChoice: 'none' } | { activeTools: ['ask_user'] } | undefined {
  const denied = steps.some(step => step.toolResults.some(result => {
    const output = result.output;
    return typeof output === 'object' && output !== null && 'denied' in output && output.denied === true;
  }));
  return denied ? questionsAvailable ? { activeTools: ['ask_user'] } : { toolChoice: 'none' } : undefined;
}
