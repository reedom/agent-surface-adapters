export function agentbusDirective(runId: string, nagiInstance: string): string {
  const from = `ext:awe-${runId}`;
  return [
    `You are running as an agent under nagi, runId "${runId}".`,
    `You may send progress updates at meaningful milestones over the agentbus CLI (optional, zero or more times):`,
    `  printf '%s' '{"type":"progress","runId":"${runId}","text":"<short status>"}' | agentbus send ${nagiInstance} --from ${from}`,
    `Your FINAL assistant message is automatically captured and reported as the result, so end with a clear, complete final answer. Do NOT ask follow-up questions or wait for further input.`,
    `Tool approvals are handled automatically by the harness; just proceed with your work.`,
  ].join('\n');
}

export function composeSystemPrompt(instructions: string | undefined, directive: string): string {
  return instructions ? `${instructions}\n\n${directive}` : directive;
}

/**
 * Directive telling the agent its final message must be a JSON object conforming to
 * `schema`. The surfaced lane has no native structured-output flag, so the schema is
 * delivered in the prompt and validated by the Stop hook.
 */
export function schemaDirective(schema: unknown): string {
  return [
    'IMPORTANT — Structured output required:',
    'Your FINAL assistant message MUST be a single JSON object that conforms to this JSON Schema, and contain NOTHING else (no prose, no markdown, no code fences):',
    JSON.stringify(schema),
  ].join('\n');
}
