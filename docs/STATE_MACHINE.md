# Deterministic Two-Stage State Machine

## Purpose

The Turn State Machine enforces Intent Governance before any code mutation occurs.

No destructive action (write/delete/execute) may occur before an active intent has been selected and context has been loaded.

This prevents:

- Context Drift
- Vibe Coding
- Unauthorized File Writes
- Trust Debt Accumulation

---

# States

## 1. AWAITING_INTENT_SELECTION

Initial state for every new user request.
The agent MUST call `select_active_intent(intent_id)`.

Allowed:

- select_active_intent

Blocked:

- write_file
- execute_command
- delete_file

---

## 2. CONTEXT_LOADED

Triggered after a valid `select_active_intent` call.

Intent constraints, scope, and recent trace are injected.

Allowed:

- write_file
- read_file
- execute_command (if safe)

---

## 3. ACTION_ALLOWED

Entered when a destructive action has been validated by:

- Scope check
- HITL approval (if required)
- Optimistic lock validation

Allowed:

- write_file execution

---

## 4. BLOCKED

Entered when:

- Invalid intent ID
- Scope violation
- Stale file detection
- Rejected HITL
- Missing intent selection

No actions allowed.

---

# Transitions

| Event                        | From                      | To                        |
| ---------------------------- | ------------------------- | ------------------------- |
| User Request                 | -                         | AWAITING_INTENT_SELECTION |
| select_active_intent (valid) | AWAITING_INTENT_SELECTION | CONTEXT_LOADED            |
| write_file (validated)       | CONTEXT_LOADED            | ACTION_ALLOWED            |
| write_file (after success)   | ACTION_ALLOWED            | CONTEXT_LOADED            |
| Error                        | Any                       | BLOCKED                   |

---

# Invariant Rule

A destructive tool must NEVER execute unless state == CONTEXT_LOADED or ACTION_ALLOWED.

If state == AWAITING_INTENT_SELECTION → block immediately.

This invariant guarantees governance.
