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

	// Execute all PreHooks
	private async executePreHooks(toolName: string, payload: any) {
		for (const hook of this.preHooks) {
			const result = await hook.preExecute(toolName, payload)
			if (!result.success) {
				throw new Error(`PreHook blocked execution: ${result.error}`)
			}
		}
	}

	// Execute all PostHooks
	private async executePostHooks(toolName: string, payload: any, result: any) {
		for (const hook of this.postHooks) {
			const postResult = await hook.postExecute(toolName, payload, result)
			if (!postResult.success) {
				console.warn(`PostHook reported issue: ${postResult.error}`)
			}
		}
	}

	// Main method to wrap tool execution
	async executeWithHooks(toolName: string, payload: any, actualToolFn: (payload: any) => Promise<any>) {
		// 1️⃣ Run pre-hooks
		await this.executePreHooks(toolName, payload)

		// 2️⃣ Execute the actual tool
		let toolResult
		try {
			toolResult = await actualToolFn(payload)
		} catch (err: any) {
			throw new Error(`Tool execution failed: ${err.message}`)
		}

		// 3️⃣ Run post-hooks
		await this.executePostHooks(toolName, payload, toolResult)

		// 4️⃣ Return the final result
		return toolResult
	}
}
