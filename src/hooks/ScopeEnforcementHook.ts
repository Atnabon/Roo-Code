import { ToolHook } from "./ToolHook"

export class ScopeEnforcementHook implements ToolHook {
	async preExecute(toolName: string, payload: any) {
		// TODO: enforce owned_scope from active_intents.yaml
	}

	async postExecute(toolName: string, payload: any) {}
}
