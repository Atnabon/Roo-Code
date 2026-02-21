import type OpenAI from "openai"

/**
 * select_active_intent tool definition.
 * Part of the Phase 1 reasoning loop handshake.
 */
export const select_active_intent = (): OpenAI.Chat.ChatCompletionTool => ({
	type: "function",
	function: {
		name: "select_active_intent",
		description:
			"Check out an active intent from active_intents.yaml to load its context (owned_scope, constraints, acceptance_criteria). This tool MUST be called before performing any write operations. Once called, the agent receives the intent context block which guides the subsequent implementation.",
		parameters: {
			type: "object",
			properties: {
				intent_id: {
					type: "string",
					description: "The unique ID of the intent to check out (e.g., 'INT-001').",
				},
			},
			required: ["intent_id"],
		},
	},
})
