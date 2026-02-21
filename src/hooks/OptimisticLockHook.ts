import fs from "fs"
import path from "path"
import crypto from "crypto"
import { ToolHook } from "./ToolHook"
import { HookError } from "./types"

/**
 * OptimisticLockHook implements optimistic concurrency control for parallel agent workflows.
 *
 * PreHook behavior (on write tools):
 * - Compare the current file hash on disk with the hash stored when the file was last read
 * - If they differ (another agent/human modified the file), block the write and return STALE_FILE error
 * - The LLM receives the error and must re-read the file before retrying
 *
 * PostHook behavior:
 * - On read_file: store the file's SHA-256 hash in memory
 * - On write tools: update the stored hash to the new file content
 */
export class OptimisticLockHook implements ToolHook {
	// In-memory map: relativePath -> lastKnownHash
	private fileHashes: Map<string, string> = new Map()
	private workspacePath: string
	private orchestrationDir: string

	// Tools that read files (we track their hashes)
	private static readonly READ_TOOLS = new Set(["read_file"])

	// Tools that write files (we compare hashes)
	private static readonly WRITE_TOOLS = new Set([
		"write_to_file",
		"apply_diff",
		"edit",
		"search_and_replace",
		"search_replace",
		"edit_file",
		"apply_patch",
	])

	constructor(options: { workspacePath: string; orchestrationDir?: string }) {
		this.workspacePath = options.workspacePath
		this.orchestrationDir = options.orchestrationDir ?? ".orchestration"
	}

	async preExecute(toolName: string, payload: any): Promise<void | HookError> {
		// Only check writes for stale files
		if (!OptimisticLockHook.WRITE_TOOLS.has(toolName)) {
			return undefined
		}

		const targetPath = this.extractTargetPath(toolName, payload)
		if (!targetPath) return undefined

		const relativePath = this.toRelativePath(targetPath)
		const lastKnownHash = this.fileHashes.get(relativePath)

		// If we haven't read this file before, allow the write
		if (!lastKnownHash) {
			return undefined
		}

		// Calculate current file hash on disk
		const absolutePath = path.isAbsolute(targetPath) ? targetPath : path.join(this.workspacePath, targetPath)

		if (!fs.existsSync(absolutePath)) {
			// File doesn't exist on disk, allow creation
			return undefined
		}

		const currentHash = this.computeFileHash(absolutePath)

		if (currentHash !== lastKnownHash) {
			return {
				message: `Stale File: "${relativePath}" has been modified by another agent or process since you last read it. Your cached version is outdated. Please re-read the file using read_file before attempting to write.`,
				code: "STALE_FILE",
				toolName,
				details: {
					filePath: relativePath,
					expectedHash: lastKnownHash,
					actualHash: currentHash,
				},
			}
		}

		return undefined
	}

	async postExecute(toolName: string, payload: any, _result?: any): Promise<void | HookError> {
		// On read_file: store the file hash
		if (OptimisticLockHook.READ_TOOLS.has(toolName)) {
			const targetPath = this.extractReadPath(payload)
			if (targetPath) {
				const absolutePath = path.isAbsolute(targetPath)
					? targetPath
					: path.join(this.workspacePath, targetPath)

				if (fs.existsSync(absolutePath)) {
					const hash = this.computeFileHash(absolutePath)
					const relativePath = this.toRelativePath(targetPath)
					this.fileHashes.set(relativePath, hash)
				}
			}
		}

		// On write tools: update the stored hash
		if (OptimisticLockHook.WRITE_TOOLS.has(toolName)) {
			const targetPath = this.extractTargetPath(toolName, payload)
			if (targetPath) {
				const absolutePath = path.isAbsolute(targetPath)
					? targetPath
					: path.join(this.workspacePath, targetPath)

				if (fs.existsSync(absolutePath)) {
					const hash = this.computeFileHash(absolutePath)
					const relativePath = this.toRelativePath(targetPath)
					this.fileHashes.set(relativePath, hash)
				}
			}

			// Append lesson to CLAUDE.md if this was a stale file recovery
			// (indicated by result containing a stale file flag)
			if (_result?.staleFileRecovery) {
				await this.appendLesson(targetPath || "unknown", "File was stale on write attempt. Re-read required.")
			}
		}

		return undefined
	}

	/**
	 * Compute SHA-256 hash of file on disk
	 */
	private computeFileHash(absolutePath: string): string {
		const content = fs.readFileSync(absolutePath, "utf-8")
		return crypto.createHash("sha256").update(content).digest("hex")
	}

	/**
	 * Convert path to workspace-relative
	 */
	private toRelativePath(filePath: string): string {
		if (path.isAbsolute(filePath)) {
			return path.relative(this.workspacePath, filePath)
		}
		return filePath
	}

	/**
	 * Extract target path from write tool payload
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
	 * Extract target path from read_file payload
	 */
	private extractReadPath(payload: any): string | null {
		const params = payload?.params || payload?.nativeArgs || {}
		return params.path || null
	}

	/**
	 * Append a lesson to .orchestration/CLAUDE.md
	 */
	private async appendLesson(filePath: string, lesson: string): Promise<void> {
		try {
			const claudePath = path.join(this.orchestrationDir, "CLAUDE.md")
			const timestamp = new Date().toISOString()
			const entry = `\n### Lesson — ${timestamp}\n- **File**: ${filePath}\n- **Lesson**: ${lesson}\n`

			if (fs.existsSync(claudePath)) {
				fs.appendFileSync(claudePath, entry, "utf-8")
			}
		} catch (err: any) {
			console.warn(`[OptimisticLockHook] Error appending lesson: ${err.message}`)
		}
	}

	/**
	 * Get all tracked file hashes (for debugging/testing)
	 */
	getTrackedFiles(): Map<string, string> {
		return new Map(this.fileHashes)
	}

	/**
	 * Clear all tracked hashes (for testing or session reset)
	 */
	clearHashes(): void {
		this.fileHashes.clear()
	}
}
