import { ToolHook } from "./ToolHook"

export class OptimisticLockHook implements ToolHook {
	async preExecute(toolName: string, payload: any) {
		// TODO: compare file hash for parallel writes
	}

	async postExecute(toolName: string, payload: any) {}
}
