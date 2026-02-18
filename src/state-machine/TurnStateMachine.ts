export enum TurnState {
	AWAITING_INTENT_SELECTION = "AWAITING_INTENT_SELECTION",
	CONTEXT_LOADED = "CONTEXT_LOADED",
	ACTION_ALLOWED = "ACTION_ALLOWED",
	BLOCKED = "BLOCKED",
}

interface ConversationState {
	conversationId: string
	currentState: TurnState
	activeIntentId?: string
}

export class TurnStateMachine {
	private conversations: Map<string, ConversationState> = new Map()

	/**
	 * Initialize a new conversation turn
	 */
	startTurn(conversationId: string) {
		this.conversations.set(conversationId, {
			conversationId,
			currentState: TurnState.AWAITING_INTENT_SELECTION,
		})
	}

	/**
	 * Get current state
	 */
	getState(conversationId: string): TurnState | undefined {
		return this.conversations.get(conversationId)?.currentState
	}

	/**
	 * Handle intent selection
	 */
	onIntentSelected(conversationId: string, intentId: string) {
		const convo = this.conversations.get(conversationId)
		if (!convo) return

		convo.activeIntentId = intentId
		convo.currentState = TurnState.CONTEXT_LOADED
	}

	/**
	 * Validate whether write is allowed
	 */
	canExecuteWrite(conversationId: string): boolean {
		const convo = this.conversations.get(conversationId)
		if (!convo) return false

		return convo.currentState === TurnState.CONTEXT_LOADED || convo.currentState === TurnState.ACTION_ALLOWED
	}

	/**
	 * Move to action allowed (after validations)
	 */
	allowAction(conversationId: string) {
		const convo = this.conversations.get(conversationId)
		if (!convo) return

		convo.currentState = TurnState.ACTION_ALLOWED
	}

	/**
	 * Block the conversation
	 */
	block(conversationId: string) {
		const convo = this.conversations.get(conversationId)
		if (!convo) return

		convo.currentState = TurnState.BLOCKED
	}

	/**
	 * Reset after successful write
	 */
	resetToContextLoaded(conversationId: string) {
		const convo = this.conversations.get(conversationId)
		if (!convo) return

		convo.currentState = TurnState.CONTEXT_LOADED
	}

	/**
	 * Get active intent
	 */
	getActiveIntent(conversationId: string): string | undefined {
		return this.conversations.get(conversationId)?.activeIntentId
	}
}
