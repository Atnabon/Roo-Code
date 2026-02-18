import { ToolHook } from "./ToolHook"

export class TraceLedgerHook implements ToolHook {
	async preExecute(toolName: string, payload: any) {}

	async postExecute(toolName: string, payload: any) {
		// TODO: append to agent_trace.jsonl
	}
}
