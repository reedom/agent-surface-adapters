export function agentbusDirective(runId: string, nagiInstance: string): string {
  const from = `ext:awe-${runId}`;
  return [
    `You are running as an agent under nagi, runId "${runId}".`,
    `Report progress and your final result over the agentbus message bus using the agentbus CLI.`,
    `Send progress at meaningful milestones (zero or more times):`,
    `  printf '%s' '{"type":"progress","runId":"${runId}","text":"<short status>"}' | agentbus send ${nagiInstance} --from ${from}`,
    `When the task is fully complete, send EXACTLY ONE result message:`,
    `  printf '%s' '{"type":"result","runId":"${runId}","text":"<your final answer>"}' | agentbus send ${nagiInstance} --from ${from}`,
    `Tool approvals are handled automatically by the harness; just proceed with your work.`,
  ].join('\n');
}

export function composeSystemPrompt(instructions: string | undefined, directive: string): string {
  return instructions ? `${instructions}\n\n${directive}` : directive;
}
