# CLAUDE.md — AI-Native Shared Brain

This file serves as a persistent memory and shared brain for agents operating within this project. It stores high-level technical decisions, project-specific conventions, and lessons learned from past errors.

## Project Context

- **Name**: Roo Code AI-Native IDE
- **Core Engine**: Deterministic Hook System (Pre/Post Middleware)
- **Protocol**: Intent-Driven Architecture (Mandatory Handshake)

## Critical Conventions

- **Traceability**: All mutations MUST be linked to an active `intent_id`.
- **Scope**: Changes MUST stay within the `owned_scope` defined in `active_intents.yaml`.
- **Parallelism**: Use optimistic locking. Stale files will block writes, requiring a re-read.
- **Error Isolation**: Each hook has independent error boundaries. Crashes are isolated; deliberate blocks propagate.

## Lessons Learned

### Lesson — 2026-02-18T10:15:31.000Z

- **File**: src/state-machine/TurnStateMachine.ts
- **Lesson**: The TurnStateMachine must be initialized with `startTurn()` in the Task constructor BEFORE hooks are registered, otherwise IntentSelectionHook cannot read the conversation state.

### Lesson — 2026-02-19T11:26:56.000Z

- **File**: src/core/task/Task.ts
- **Lesson**: Hook registration order matters. IntentSelectionHook must always be the first PreHook to ensure TurnStateMachine transitions before ScopeEnforcement checks. If ScopeEnforcement runs first, it would allow writes without an active intent.

### Lesson — 2026-02-19T11:27:27.000Z

- **File**: src/hooks/HookEngine.ts
- **Lesson**: PreHook error handling was initially too aggressive — a single hook crash would prevent all subsequent hooks from running. Refactored to isolate each hook in an independent try-catch, re-throwing only deliberate blocking errors (e.g., NO_ACTIVE_INTENT, SCOPE_VIOLATION).

### Lesson — 2026-02-19T11:27:42.000Z

- **File**: src/hooks/OptimisticLockHook.ts
- **Lesson**: Stale files are detected by comparing SHA-256 hashes. If another process modifies a file, the local cache MUST be refreshed via `read_file` before retrying. The error message must instruct the LLM to re-read, not just retry blindly.

### Lesson — 2026-02-21T09:30:00.000Z

- **File**: src/core/assistant-message/presentAssistantMessage.ts
- **Lesson**: The PreHook catch block was silently swallowing errors with `console.warn`, which meant the gatekeeper could be bypassed. Fixed to return `formatResponse.toolError()` and set `didAlreadyUseTool = true` so the LLM receives a structured error it can act on.
