import fs from "fs"
import path from "path"
import * as yaml from "yaml"
import { ToolHook } from "./ToolHook"
import { HookError } from "./types"
import { TurnStateMachine, TurnState } from "../state-machine/TurnStateMachine"

/**
 * IntentSelectionHook enforces the Intent-Driven Architecture protocol.
 *
 * PreHook behavior:
 * - For `select_active_intent`: validates intent_id exists in active_intents.yaml,
 *   loads context, transitions TurnStateMachine to CONTEXT_LOADED
 * - For write/destructive tools: verifies an intent has been selected (gatekeeper)
 * - For read-only tools: passes through without blocking
 *
 * PostHook behavior:
 * - For `select_active_intent`: returns <intent_context> XML block to the LLM
 */
export class IntentSelectionHook implements ToolHook {
	private orchestrationDir: string
	private turnStateMachine: TurnStateMachine
	private conversationId: string

	// Tools that require an active intent before execution
	private static readonly WRITE_TOOLS = new Set([
		"write_to_file",
		"apply_diff",
		"execute_command",
		"edit",
		"search_and_replace",
		"search_replace",
		"edit_file",
		"apply_patch",
	])

	// Tools that are read-only and don't require intent selection
	private static readonly READ_ONLY_TOOLS = new Set([
		"read_file",
		"list_files",
		"search_files",
		"codebase_search",
		"list_code_definition_names",
		"ask_followup_question",
		"attempt_completion",
		"switch_mode",
		"read_command_output",
		"select_active_intent",
	])

	constructor(options: { orchestrationDir?: string; turnStateMachine: TurnStateMachine; conversationId: string }) {
		this.orchestrationDir = options.orchestrationDir ?? ".orchestration"
		this.turnStateMachine = options.turnStateMachine
		this.conversationId = options.conversationId
	}

	async preExecute(toolName: string, payload: any): Promise<void | HookError> {
		// For select_active_intent: validate and load intent
		if (toolName === "select_active_intent") {
			const intentId = payload?.params?.intent_id ?? payload?.nativeArgs?.intent_id
			if (!intentId) {
				return {
					message: "Missing required parameter: intent_id. You must provide a valid Intent ID.",
					code: "MISSING_INTENT_ID",
					toolName,
				}
			}

			// Validate intent exists in active_intents.yaml
			const intent = this.findIntent(intentId)
			if (!intent) {
				const availableIntents = this.getAvailableIntentIds()
				return {
					message: `Intent "${intentId}" not found in active_intents.yaml. Available intents: ${availableIntents.join(", ")}`,
					code: "INVALID_INTENT_ID",
					toolName,
				}
			}

			// Transition state machine
			this.turnStateMachine.onIntentSelected(this.conversationId, intentId)
			return undefined // Allow execution
		}

		// For write/destructive tools: verify intent is selected
		if (IntentSelectionHook.WRITE_TOOLS.has(toolName)) {
			const currentState = this.turnStateMachine.getState(this.conversationId)
			if (!currentState || currentState === TurnState.AWAITING_INTENT_SELECTION) {
				const availableIntents = this.getAvailableIntentIds()
				return {
					message: `You must call select_active_intent before using "${toolName}". Available intents: ${availableIntents.join(", ")}. Call select_active_intent(intent_id) first.`,
					code: "NO_ACTIVE_INTENT",
					toolName,
				}
			}
		}

		// Read-only tools pass through
		return undefined
	}

	async postExecute(toolName: string, payload: any, result?: any): Promise<void | HookError> {
		// After select_active_intent: build and return intent context
		if (toolName === "select_active_intent") {
			const intentId = payload?.params?.intent_id ?? payload?.nativeArgs?.intent_id
			if (intentId) {
				const context = this.buildIntentContext(intentId)
				if (result && typeof result === "object") {
					result.intentContext = context
				}
			}
		}
		return undefined
	}

	/**
	 * Find an intent by ID in active_intents.yaml
	 */
	private findIntent(intentId: string): any | null {
		try {
			const intentsPath = path.join(this.orchestrationDir, "active_intents.yaml")
			if (!fs.existsSync(intentsPath)) return null

			const content = fs.readFileSync(intentsPath, "utf-8")
			const data = yaml.parse(content) as any
			const intents = data?.active_intents || []
			return intents.find((i: any) => i.id === intentId) || null
		} catch {
			return null
		}
	}

	/**
	 * Get all available intent IDs
	 */
	private getAvailableIntentIds(): string[] {
		try {
			const intentsPath = path.join(this.orchestrationDir, "active_intents.yaml")
			if (!fs.existsSync(intentsPath)) return []

			const content = fs.readFileSync(intentsPath, "utf-8")
			const data = yaml.parse(content) as any
			const intents = data?.active_intents || []
			return intents.map((i: any) => i.id)
		} catch {
			return []
		}
	}

	/**
	 * Build an <intent_context> XML block for the LLM
	 */
	private buildIntentContext(intentId: string): string {
		const intent = this.findIntent(intentId)
		if (!intent) return `<intent_context>Intent ${intentId} not found</intent_context>`

		const constraints = (intent.constraints || []).map((c: string) => `  <constraint>${c}</constraint>`).join("\n")
		const scope = (intent.owned_scope || []).map((s: string) => `  <scope>${s}</scope>`).join("\n")
		const criteria = (intent.acceptance_criteria || [])
			.map((c: string) => `  <criterion>${c}</criterion>`)
			.join("\n")

		return `<intent_context>
  <id>${intent.id}</id>
  <name>${intent.name}</name>
  <status>${intent.status}</status>
  <owned_scope>
${scope}
  </owned_scope>
  <constraints>
${constraints}
  </constraints>
  <acceptance_criteria>
${criteria}
  </acceptance_criteria>
</intent_context>`
	}
}
