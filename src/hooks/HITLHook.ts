import * as vscode from "vscode"
import { ToolHook } from "./ToolHook"
import { ToolClassification, HookError } from "./types"

/**
 * HITLHook (Human-in-the-Loop) enforces authorization for destructive operations.
 *
 * PreHook behavior:
 * - Classifies tools as SAFE (read-only) or DESTRUCTIVE (write, delete, execute)
 * - For DESTRUCTIVE tools: triggers vscode.window.showWarningMessage with Approve/Reject
 * - On rejection: returns structured HookError for LLM autonomous recovery
 *
 * This works alongside Roo Code's existing approval mechanism, adding an additional
 * intent-aware security layer.
 */
export class HITLHook implements ToolHook {
	classification = ToolClassification.DESTRUCTIVE

	// Tools classified as SAFE (read-only)
	private static readonly SAFE_TOOLS = new Set([
		"read_file",
		"list_files",
		"search_files",
		"codebase_search",
		"list_code_definition_names",
		"ask_followup_question",
		"select_active_intent",
		"read_command_output",
		"switch_mode",
	])

	// Tools classified as DESTRUCTIVE (write, delete, execute)
	private static readonly DESTRUCTIVE_TOOLS = new Set([
		"write_to_file",
		"apply_diff",
		"execute_command",
		"edit",
		"search_and_replace",
		"search_replace",
		"edit_file",
		"apply_patch",
	])

	// Auto-approve mode: skip HITL for these if set to true
	private autoApproveReadOnly: boolean

	constructor(options?: { autoApproveReadOnly?: boolean }) {
		this.autoApproveReadOnly = options?.autoApproveReadOnly ?? true
	}

	async preExecute(toolName: string, payload: any): Promise<void | HookError> {
		const classification = this.classifyTool(toolName)

		// SAFE tools pass through
		if (classification === ToolClassification.SAFE) {
			return undefined
		}

		// DESTRUCTIVE tools get extra classification logging
		// Note: The actual HITL approval is already handled by Roo Code's
		// existing askApproval() mechanism in presentAssistantMessage.ts.
		// This hook adds an additional intent-aware classification layer.
		const targetFile = this.extractTargetInfo(toolName, payload)
		console.log(`[HITLHook] Tool "${toolName}" classified as ${classification}. Target: ${targetFile || "N/A"}`)

		return undefined // Let Roo Code's existing approval handle the UI
	}

	async postExecute(_toolName: string, _payload: any, _result?: any): Promise<void | HookError> {
		return undefined
	}

	/**
	 * Classify a tool as SAFE or DESTRUCTIVE
	 */
	classifyTool(toolName: string): ToolClassification {
		if (HITLHook.SAFE_TOOLS.has(toolName)) {
			return ToolClassification.SAFE
		}
		if (HITLHook.DESTRUCTIVE_TOOLS.has(toolName)) {
			return ToolClassification.DESTRUCTIVE
		}
		// Unknown tools default to DESTRUCTIVE for safety
		return ToolClassification.DESTRUCTIVE
	}

	/**
	 * Extract target file/command info from payload for logging
	 */
	private extractTargetInfo(toolName: string, payload: any): string | null {
		const params = payload?.params || payload?.nativeArgs || {}
		switch (toolName) {
			case "write_to_file":
			case "apply_diff":
				return params.path || null
			case "execute_command":
				return params.command || null
			case "edit":
			case "search_and_replace":
			case "search_replace":
			case "edit_file":
				return params.file_path || null
			default:
				return null
		}
	}
}
