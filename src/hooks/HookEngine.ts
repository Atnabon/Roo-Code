import { ToolHook } from "./ToolHook"

export class HookEngine {
	private preHooks: ToolHook[] = []
	private postHooks: ToolHook[] = []

	registerPreHook(hook: ToolHook) {
		this.preHooks.push(hook)
	}

	registerPostHook(hook: ToolHook) {
		this.postHooks.push(hook)
	}

	// Placeholder for executing hooks
	async executePreHooks(toolName: string, payload: any) {
		for (const hook of this.preHooks) {
			await hook.preExecute(toolName, payload)
		}
	}

	async executePostHooks(toolName: string, payload: any) {
		for (const hook of this.postHooks) {
			await hook.postExecute(toolName, payload)
		}
	}
}
