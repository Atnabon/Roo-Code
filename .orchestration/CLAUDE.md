# CLAUDE.md — The Shared Brain

> Persistent knowledge base shared across parallel agent sessions (Architect/Builder/Tester).
> Contains project-specific rules, "Lessons Learned," and architectural decisions.
>
> **Update Pattern:** Incrementally appended when verification loops (linter/test) fail
> or when architectural decisions are made. Managed by the `LessonsRecordHook` (PostToolUse).

---

## Project Constitution

- **Architecture:** Middleware/Interceptor pattern for hook system — hooks wrap tool execution, not inline
- **Security:** All destructive tool calls require active intent checkout via `select_active_intent`
- **Storage:** Sidecar `.orchestration/` — never pollute source code with metadata
- **Hashing:** SHA-256 for content hashing — spatial independence over line-based attribution
- **Fail-Safety:** Circuit breaker pattern — hook failures must not crash the agent

## Project-Specific Rules

- Always call `select_active_intent(intent_id)` before performing any file writes
- Respect `owned_scope` globs in `active_intents.yaml` — do not write outside scope
- Check `.intentignore` patterns before tracking changes
- Post-hooks are non-blocking — failures are logged but never abort tool results

## Lessons Learned

<!-- Entries below are auto-appended by the LessonsRecordHook when tools fail -->

