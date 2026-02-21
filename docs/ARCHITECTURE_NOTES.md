# Architecture Notes — Roo Code AI-Native IDE

## Executive Summary

Roo Code has been enhanced with a deterministic Hook System that transforms it into an AI-Native IDE. This system enforces a mandatory "Handshake" protocol (Intent → Code), ensures security via scope enforcement and HITL, and enables robust parallel orchestration.

## Core Component: Hook Engine

The `HookEngine` implements a standard middleware/interceptor pattern. It wraps tool execution with sequential Pre-Hooks and Post-Hooks.

### Execution Flow

1.  **Tool Call**: LLM requests a tool (e.g., `write_to_file`).
2.  **Pre-Hooks**:
    - `IntentSelectionHook`: Gatekeeper ensures an intent is active.
    - `ScopeEnforcementHook`: Authorizes the file target against `owned_scope`.
    - `HITLHook`: Classifies operation and logs for potential human approval.
    - `OptimisticLockHook`: Blocks stale writes (parallelism guard).
3.  **Tool Execution**: Actual Roo Code logic runs.
4.  **Post-Hooks**:
    - `WriteFileHook`: Post-processes mutations (SHA-256 hashing).
    - `TraceLedgerHook`: Records a persistent, hashed audit record in `agent_trace.jsonl`.
    - `IntentMap`: Updates the feature-to-file mapping.

## Data Model: Sidecar Storage

The platform uses the `.orchestration/` directory for machine-managed state:

- `active_intents.yaml`: Source of truth for intents, scopes, and constraints.
- `agent_trace.jsonl`: Append-only immutable trace of all agent actions.
- `intent_map.md`: High-level human-readable mapping of code to intents.
- `CLAUDE.md`: Shared brain storing project context and lessons learned.

## Deterministic Protocol

The reasoning loop is governed by the `TurnStateMachine`, which enforces a strict sequence:
`AWAITING_INTENT_SELECTION` → `CONTEXT_LOADED` → `ACTION_ALLOWED` → `BLOCKED`.

## Security & Reliability

- **Scope Enforcement**: Glob-based patterns prevent accidental edits to sensitive areas.
- **Optimistic Locking**: Prevents race conditions in multi-agent environments.
- **Content Hashing**: Uses SHA-256 for spatial independence, ensuring traces are valid across environments.
