# Hook Middleware Layer Architecture

## Components

- **HookEngine**: orchestrates pre/post hooks
- **ToolHook Interface**: defines contract for all hooks
- **PreHook / PostHook**: invoked before/after tool execution
- **ToolClassification**: SAFE / DESTRUCTIVE
- **Fail-safe Error Format**: standardized HookError object

## Hook Types

- WriteFileHook
- IntentSelectionHook
- ScopeEnforcementHook
- TraceLedgerHook
- OptimisticLockHook
- HITLHook

## Flow

1. Tool is called from Extension Host
2. HookEngine intercepts tool call
3. PreHooks executed in order
4. Tool executes if pre-hooks succeed
5. PostHooks executed in order
6. Errors handled using HookError format
