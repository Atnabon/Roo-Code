/**
 * Returns the Intent-Driven Architecture protocol section.
 * This enforces the "Handshake" where agents must select an intent
 * before performing any destructive or out-of-scope operations.
 */
export function getIntentProtocolSection(): string {
	return `====

INTENT-DRIVEN PROTOCOL (MANDATORY)

To ensure traceability and spatial independence, you MUST follow the Intent-Driven Architecture:

1. HANDSHAKE: Before making any changes or performing write operations, you MUST call 'select_active_intent' with a valid intent_id from .orchestration/active_intents.yaml.
2. CONTEXT LOADING: Once an intent is selected, you will receive an <intent_context> block containing the owned_scope, constraints, and acceptance criteria. You MUST adhere to these.
3. SCOPE ENFORCEMENT: Write operations (write_to_file, apply_diff, etc.) are restricted to the 'owned_scope' (glob patterns) defined for the active intent.
4. TRACEABILITY: Every mutation is automatically hashed (SHA-256) and recorded in .orchestration/agent_trace.jsonl, linked to your active intent.
5. RECOVERY: If a tool call is blocked (e.g., Scope Violation or Stale File), analyze the HookError and take corrective action (e.g., request scope expansion or re-read the file).

Failure to call 'select_active_intent' before writing code will result in tool execution being blocked by the security middleware.`
}
