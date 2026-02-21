import fs from "fs"
import path from "path"
import crypto from "crypto"
import { ToolHook } from "./ToolHook"
import { HookError } from "./types"

/**
 * Trace record schema for agent_trace.jsonl
 * Each record represents one tool execution with full attribution metadata.
 */
export interface TraceRecord {
	/** UUIDv4 unique identifier for this trace entry */
	id: string
	/** ISO-8601 timestamp of when this trace was recorded */
	timestamp: string
	/** Version control state at time of trace */
	vcs: {
		revision_id: string
	}
	/** Agent session UUID */
	session_id: string
	/** Active intent ID from TurnStateMachine (e.g., "INT-001") */
	intent_id: string | null
	/** Tool name that was executed */
	tool_name: string
	/** Classification of the mutation */
	mutation_class: "AST_REFACTOR" | "INTENT_EVOLUTION" | "READ_ONLY" | "UNKNOWN"
	/** Duration of tool execution in milliseconds */
	duration_ms: number
	/** Whether the tool execution succeeded */
	success: boolean
	/** Error message if execution failed */
	error?: string
	/** Files affected by this tool execution */
	files: TraceFileEntry[]
}

export interface TraceFileEntry {
	/** Workspace-relative path */
	relative_path: string
	/** Conversations/modifications on this file */
	conversations: TraceConversation[]
}

export interface TraceConversation {
	/** Session reference */
	url: string
	/** Who made the change */
	contributor: {
		entity_type: "AI" | "HUMAN"
		model_identifier?: string
	}
	/** Affected ranges with content hashes */
	ranges: TraceRange[]
	/** Related intents/specs */
	related: TraceRelation[]
}

export interface TraceRange {
	start_line?: number
	end_line?: number
	/** SHA-256 hash of the content written/read */
	content_hash: string
}

export interface TraceRelation {
	type: "specification" | "intent" | "dependency"
	value: string
}

/**
 * TraceLedgerHook appends tool execution records to .orchestration/agent_trace.jsonl
 *
 * Design properties:
 * - Append-only JSONL format (no parse-rewrite)
 * - SHA-256 content hashing for spatial independence
 * - Captures VCS revision, intent, and mutation classification
 */
export class TraceLedgerHook implements ToolHook {
	private orchestrationDir: string
	private traceFilePath: string
	private sessionId: string
	private activeIntentId: string | null = null
	private modelIdentifier: string

	constructor(options?: {
		orchestrationDir?: string
		sessionId?: string
		activeIntentId?: string | null
		modelIdentifier?: string
	}) {
		this.orchestrationDir = options?.orchestrationDir ?? path.join(process.cwd(), ".orchestration")
		this.traceFilePath = path.join(this.orchestrationDir, "agent_trace.jsonl")
		this.sessionId = options?.sessionId ?? TraceLedgerHook.generateUUID()
		this.activeIntentId = options?.activeIntentId ?? null
		this.modelIdentifier = options?.modelIdentifier ?? "unknown"
	}

	/** Update the active intent for subsequent trace records */
	setActiveIntent(intentId: string | null) {
		this.activeIntentId = intentId
	}

	/** Update the model identifier */
	setModelIdentifier(modelId: string) {
		this.modelIdentifier = modelId
	}

	async preExecute(_toolName: string, _payload: any): Promise<void | HookError> {
		// PreExecute is a no-op for tracing — we only record after execution
	}

	async postExecute(toolName: string, payload: any, result?: any): Promise<void | HookError> {
		try {
			const record = await this.buildTraceRecord(toolName, payload, result)
			await this.appendTrace(record)
		} catch (err: any) {
			// Tracing should never block tool execution — log and continue
			console.warn(`[TraceLedgerHook] Failed to write trace: ${err.message}`)
		}
	}

	/**
	 * Build a trace record from tool execution context
	 */
	private async buildTraceRecord(toolName: string, payload: any, result?: any): Promise<TraceRecord> {
		const timestamp = new Date().toISOString()
		const revisionId = await this.getGitRevision()
		const mutationClass = this.classifyMutation(toolName, payload)
		const files = this.extractFileEntries(toolName, payload, result)

		const record: TraceRecord = {
			id: TraceLedgerHook.generateUUID(),
			timestamp,
			vcs: { revision_id: revisionId },
			session_id: this.sessionId,
			intent_id: this.activeIntentId,
			tool_name: toolName,
			mutation_class: mutationClass,
			duration_ms: typeof result?.duration_ms === "number" ? result.duration_ms : 0,
			success: result?.error == null,
			files,
		}

		if (result?.error) {
			record.error = typeof result.error === "string" ? result.error : String(result.error)
		}

		return record
	}

	/**
	 * Classify mutation type based on tool name
	 */
	private classifyMutation(
		toolName: string,
		_payload: any,
	): "AST_REFACTOR" | "INTENT_EVOLUTION" | "READ_ONLY" | "UNKNOWN" {
		const readOnlyTools = [
			"list_files",
			"read_file",
			"search_files",
			"list_code_definition_names",
			"inspect_site",
			"ask_followup_question",
			"attempt_completion",
		]

		const writeTools = ["write_to_file", "replace_in_file", "insert_code_block", "apply_diff"]

		if (readOnlyTools.includes(toolName)) {
			return "READ_ONLY"
		}

		if (writeTools.includes(toolName)) {
			return "AST_REFACTOR"
		}

		if (toolName === "execute_command" || toolName === "browser_action") {
			return "INTENT_EVOLUTION"
		}

		return "UNKNOWN"
	}

	/**
	 * Extract file entries from tool payload/result for trace attribution
	 */
	private extractFileEntries(toolName: string, payload: any, result?: any): TraceFileEntry[] {
		const files: TraceFileEntry[] = []

		// Extract file path from common payload fields
		const filePath = payload?.path || payload?.filePath || payload?.file_path || payload?.relative_path
		if (!filePath) {
			return files
		}

		// Compute content hash if there's content involved
		const content = payload?.content || payload?.new_string || result?.content || ""
		const contentHash = content
			? `sha256:${crypto.createHash("sha256").update(String(content)).digest("hex")}`
			: "sha256:empty"

		const entry: TraceFileEntry = {
			relative_path: this.toRelativePath(filePath),
			conversations: [
				{
					url: this.sessionId,
					contributor: {
						entity_type: "AI",
						model_identifier: this.modelIdentifier,
					},
					ranges: [
						{
							start_line: payload?.start_line || payload?.startLine,
							end_line: payload?.end_line || payload?.endLine,
							content_hash: contentHash,
						},
					],
					related: this.activeIntentId ? [{ type: "intent" as const, value: this.activeIntentId }] : [],
				},
			],
		}

		files.push(entry)
		return files
	}

	/**
	 * Append a trace record to agent_trace.jsonl (append-only, no parse-rewrite)
	 */
	private async appendTrace(record: TraceRecord): Promise<void> {
		// Ensure the orchestration directory exists
		if (!fs.existsSync(this.orchestrationDir)) {
			fs.mkdirSync(this.orchestrationDir, { recursive: true })
		}

		// Initialize the file if it doesn't exist or contains the old empty-array scaffold
		if (fs.existsSync(this.traceFilePath)) {
			const existingContent = fs.readFileSync(this.traceFilePath, "utf-8").trim()
			if (existingContent === "[]" || existingContent === "") {
				// Clear the scaffold — JSONL doesn't use array wrappers
				fs.writeFileSync(this.traceFilePath, "", "utf-8")
			}
		}

		const line = JSON.stringify(record) + "\n"
		fs.appendFileSync(this.traceFilePath, line, "utf-8")
	}

	/**
	 * Get current git HEAD revision
	 */
	private async getGitRevision(): Promise<string> {
		try {
			const { execSync } = await import("child_process")
			return execSync("git rev-parse --short HEAD", {
				encoding: "utf-8",
				timeout: 3000,
			}).trim()
		} catch {
			return "unknown"
		}
	}

	/**
	 * Convert absolute path to workspace-relative path
	 */
	private toRelativePath(filePath: string): string {
		const cwd = process.cwd()
		if (filePath.startsWith(cwd)) {
			return filePath.slice(cwd.length + 1)
		}
		return filePath
	}

	/**
	 * Generate a UUID v4
	 */
	static generateUUID(): string {
		return crypto.randomUUID()
	}

	/**
	 * Read all trace records from the JSONL file
	 */
	static readTraces(traceFilePath: string): TraceRecord[] {
		if (!fs.existsSync(traceFilePath)) {
			return []
		}

		const content = fs.readFileSync(traceFilePath, "utf-8").trim()
		if (!content || content === "[]") {
			return []
		}

		return content
			.split("\n")
			.filter((line) => line.trim().length > 0)
			.map((line) => JSON.parse(line) as TraceRecord)
	}
}
