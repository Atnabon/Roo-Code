import fs from "fs"
import path from "path"
import * as yaml from "yaml"
import { ToolHook } from "./ToolHook"
import { HookError } from "./types"
import { TurnStateMachine } from "../state-machine/TurnStateMachine"

/**
 * ScopeEnforcementHook validates that write operations only target files
 * within the owned_scope of the currently active intent.
 *
 * Uses the same glob-to-regex approach as IntentRegistry.checkScope().
 */
export class ScopeEnforcementHook implements ToolHook {
	private orchestrationDir: string
	private turnStateMachine: TurnStateMachine
	private conversationId: string
	private workspacePath: string

	// Tools that write to files and need scope enforcement
	private static readonly SCOPED_TOOLS = new Set([
		"write_to_file",
		"apply_diff",
		"edit",
		"search_and_replace",
		"search_replace",
		"edit_file",
		"apply_patch",
	])

	constructor(options: {
		orchestrationDir?: string
		turnStateMachine: TurnStateMachine
		conversationId: string
		workspacePath: string
	}) {
		this.orchestrationDir = options.orchestrationDir ?? ".orchestration"
		this.turnStateMachine = options.turnStateMachine
		this.conversationId = options.conversationId
		this.workspacePath = options.workspacePath
	}

	async preExecute(toolName: string, payload: any): Promise<void | HookError> {
		// Only enforce scope for file-writing tools
		if (!ScopeEnforcementHook.SCOPED_TOOLS.has(toolName)) {
			return undefined
		}

		// Get active intent
		const activeIntentId = this.turnStateMachine.getActiveIntent(this.conversationId)
		if (!activeIntentId) {
			return undefined // IntentSelectionHook should have already blocked
		}

		// Get target file path from payload
		const targetPath = this.extractTargetPath(toolName, payload)
		if (!targetPath) {
			return undefined
		}

		// Load intent and check scope
		const intent = this.findIntent(activeIntentId)
		if (!intent || !intent.owned_scope || intent.owned_scope.length === 0) {
			return undefined // No scope defined, allow all
		}

		// Check .intentignore
		if (this.isIgnored(targetPath)) {
			return undefined
		}

		// Check if target file matches any owned_scope pattern
		const relativePath = this.toRelativePath(targetPath)
		const isInScope = intent.owned_scope.some((pattern: string) => {
			// Convert glob pattern to regex (same approach as IntentRegistry)
			const regex = new RegExp(pattern.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*"))
			return regex.test(relativePath)
		})

		if (!isInScope) {
			return {
				message: `Scope Violation: Intent "${activeIntentId}" (${intent.name}) is not authorized to edit "${relativePath}". Allowed scope: ${intent.owned_scope.join(", ")}. Request scope expansion or select a different intent.`,
				code: "SCOPE_VIOLATION",
				toolName,
				details: {
					intentId: activeIntentId,
					targetFile: relativePath,
					allowedScope: intent.owned_scope,
				},
			}
		}

		return undefined
	}

	async postExecute(_toolName: string, _payload: any, _result?: any): Promise<void | HookError> {
		return undefined
	}

	/**
	 * Extract the target file path from tool payload
	 */
	private extractTargetPath(toolName: string, payload: any): string | null {
		const params = payload?.params || payload?.nativeArgs || {}
		switch (toolName) {
			case "write_to_file":
			case "apply_diff":
				return params.path || null
			case "edit":
			case "search_and_replace":
			case "search_replace":
			case "edit_file":
				return params.file_path || null
			default:
				return null
		}
	}

	/**
	 * Convert absolute path to workspace-relative path
	 */
	private toRelativePath(filePath: string): string {
		if (path.isAbsolute(filePath)) {
			return path.relative(this.workspacePath, filePath)
		}
		return filePath
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
	 * Check if a file is in .intentignore
	 */
	private isIgnored(filePath: string): boolean {
		try {
			const ignorePath = path.join(this.orchestrationDir, ".intentignore")
			if (!fs.existsSync(ignorePath)) return false

			const content = fs.readFileSync(ignorePath, "utf-8")
			const patterns = content
				.split("\n")
				.map((line) => line.trim())
				.filter((line) => line && !line.startsWith("#"))

			const relativePath = this.toRelativePath(filePath)
			return patterns.some((pattern) => {
				const regex = new RegExp(pattern.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*"))
				return regex.test(relativePath)
			})
		} catch {
			return false
		}
	}
}
