import { ToolHook } from "./ToolHook"

export class IntentSelectionHook implements ToolHook {
	async preExecute(toolName: string, payload: any) {
		// TODO: validate selected intent ID
	}

	async postExecute(toolName: string, payload: any) {
		// optional post-hook
	}
}
