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

	// Execute all PreHooks with independent error boundaries
	async runPreHooks(toolName: string, payload: any) {
		for (const hook of this.preHooks) {
			try {
				const result = await hook.preExecute(toolName, payload)
				// If result is truthy (HookError), it's a deliberate block
				if (result) {
					throw new Error(`PreHook blocked: ${result.message}`)
				}
			} catch (err: any) {
				// Re-throw deliberate blocking errors so caller can handle them
				if (err instanceof Error && err.message.startsWith("PreHook blocked:")) {
					throw err
				}
				// Isolate unexpected hook crashes — log and continue
				console.warn(`[HookEngine] Hook crashed (isolated): ${err.message || err}`)
			}
		}
	}

	// Execute all PostHooks with independent error boundaries
	async runPostHooks(toolName: string, payload: any, result: any) {
		for (const hook of this.postHooks) {
			try {
				const postResult = await hook.postExecute(toolName, payload, result)
				// If postResult is truthy (HookError), log the issue
				if (postResult) {
					console.warn(`[HookEngine] PostHook reported: ${postResult.message}`)
				}
			} catch (err: any) {
				// PostHook errors should never block tool execution — log and continue
				console.warn(`[HookEngine] PostHook crashed (isolated): ${err.message || err}`)
			}
		}
	}

	// Main method to wrap tool execution
	async executeWithHooks(toolName: string, payload: any, actualToolFn: (payload: any) => Promise<any>) {
		// 1️⃣ Run pre-hooks
		await this.runPreHooks(toolName, payload)

		// 2️⃣ Execute the actual tool
		let toolResult
		try {
			toolResult = await actualToolFn(payload)
		} catch (err: any) {
			throw new Error(`Tool execution failed: ${err.message}`)
		}

		// 3️⃣ Run post-hooks
		await this.runPostHooks(toolName, payload, toolResult)

		// 4️⃣ Return the final result
		return toolResult
	}
}
