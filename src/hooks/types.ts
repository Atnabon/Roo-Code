export enum ToolClassification {
	SAFE = "SAFE", // read-only commands
	DESTRUCTIVE = "DESTRUCTIVE", // write, delete, execute
}

export interface HookError {
	message: string
	code: string
	toolName?: string
	details?: any
}
