import { ToolHook } from "./ToolHook"

export class HITLHook implements ToolHook {
	async preExecute(toolName: string, payload: any) {
		// TODO: show vscode warning / approve-reject
	}

	async postExecute(toolName: string, payload: any) {}
}
