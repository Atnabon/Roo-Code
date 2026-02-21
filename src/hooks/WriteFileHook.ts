import fs from "fs"
import path from "path"
import crypto from "crypto"
import * as yaml from "yaml"
import { ToolHook } from "./ToolHook"
import { HookError } from "./types"
import { TurnStateMachine } from "../state-machine/TurnStateMachine"

/**
 * WriteFileHook handles post processing for file write operations.
 *
 * PostHook: Calculates SHA-256 content hash and updates intent_map.md
 */
export class WriteFileHook implements ToolHook {
	private orchestrationDir: string
	private turnStateMachine: TurnStateMachine
	private conversationId: string
	private workspacePath: string

	// Tools that write files
	private static readonly WRITE_TOOLS = new Set([
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

	async preExecute(_toolName: string, _payload: any): Promise<void | HookError> {
		return undefined
	}

	async postExecute(toolName: string, payload: any, result?: any): Promise<void | HookError> {
		if (!WriteFileHook.WRITE_TOOLS.has(toolName)) {
			return undefined
		}

		const targetPath = this.extractTargetPath(toolName, payload)
		if (!targetPath) return undefined

		try {
			const absolutePath = path.isAbsolute(targetPath) ? targetPath : path.join(this.workspacePath, targetPath)

			if (fs.existsSync(absolutePath)) {
				const content = fs.readFileSync(absolutePath, "utf-8")
				const contentHash = this.computeHash(content)

				// Update intent_map.md
				const activeIntentId = this.turnStateMachine.getActiveIntent(this.conversationId)
				if (activeIntentId) {
					this.updateIntentMap(activeIntentId, targetPath, toolName, contentHash)
				}

				// Attach hash to result for TraceLedgerHook
				if (result && typeof result === "object") {
					result.contentHash = contentHash
					result.filePath = targetPath
				}
			}
		} catch (err: any) {
			console.warn(`[WriteFileHook] Error in postExecute: ${err.message}`)
		}

		return undefined
	}

	/**
	 * Compute SHA-256 hash of content
	 */
	private computeHash(content: string): string {
		return `sha256:${crypto.createHash("sha256").update(content).digest("hex").substring(0, 32)}`
	}

	/**
	 * Extract target file path from tool payload
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
	 * Update intent_map.md with file modification entry
	 */
	private updateIntentMap(intentId: string, filePath: string, toolName: string, contentHash: string): void {
		try {
			const mapPath = path.join(this.orchestrationDir, "intent_map.md")
			const relativePath = path.isAbsolute(filePath) ? path.relative(this.workspacePath, filePath) : filePath
			const timestamp = new Date().toISOString().split("T")[0]

			let content = ""
			if (fs.existsSync(mapPath)) {
				content = fs.readFileSync(mapPath, "utf-8")
			}

			// Check if intent section exists
			const intentHeader = `## ${intentId}`
			if (!content.includes(intentHeader)) {
				const intentName = this.getIntentName(intentId)
				content += `\n${intentHeader}: ${intentName}\n\n`
				content += `**Status:** IN_PROGRESS\n\n`
				content += `| File | Last Tool | Last Modified | Content Hash |\n`
				content += `|------|-----------|---------------|-------------|\n`
			}

			// Check if file entry exists and update or add
			const escapedPath = relativePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
			const fileEntryRegex = new RegExp(`\\| ${escapedPath} \\|.*\\|`)
			const newEntry = `| ${relativePath} | ${toolName} | ${timestamp} | ${contentHash} |`

			if (fileEntryRegex.test(content)) {
				content = content.replace(fileEntryRegex, newEntry)
			} else {
				// Add new entry at the end of the table
				const lines = content.split("\n")
				let lastTableLine = -1
				for (let i = lines.length - 1; i >= 0; i--) {
					const line = lines[i]
					if (line.startsWith("|") && !line.startsWith("| File") && !line.startsWith("|---")) {
						lastTableLine = i
						break
					}
				}
				if (lastTableLine >= 0) {
					lines.splice(lastTableLine + 1, 0, newEntry)
				} else {
					lines.push(newEntry)
				}
				content = lines.join("\n")
			}

			// Ensure .orchestration directory exists
			if (!fs.existsSync(this.orchestrationDir)) {
				fs.mkdirSync(this.orchestrationDir, { recursive: true })
			}

			fs.writeFileSync(mapPath, content, "utf-8")
		} catch (err: any) {
			console.warn(`[WriteFileHook] Error updating intent_map.md: ${err.message}`)
		}
	}

	/**
	 * Get intent name from active_intents.yaml
	 */
	private getIntentName(intentId: string): string {
		try {
			const intentsPath = path.join(this.orchestrationDir, "active_intents.yaml")
			if (!fs.existsSync(intentsPath)) return intentId

			const content = fs.readFileSync(intentsPath, "utf-8")
			const data = yaml.parse(content) as any
			const intent = (data?.active_intents || []).find((i: any) => i.id === intentId)
			return intent?.name || intentId
		} catch {
			return intentId
		}
	}
}
