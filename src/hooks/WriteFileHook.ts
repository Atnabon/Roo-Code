import { ToolHook } from "./ToolHook"

export class WriteFileHook implements ToolHook {
	async preExecute(toolName: string, payload: any) {
		// TODO: check scope and preconditions
	}

	async postExecute(toolName: string, payload: any) {
		// TODO: log trace and content hash
	}
}
