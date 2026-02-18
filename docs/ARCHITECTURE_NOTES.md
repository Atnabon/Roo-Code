# ARCHITECTURE_NOTES.md — Phase 0: The Archaeological Dig

> **Author:** TRP1 Challenge — Interim Submission  
> **Date:** 2026-02-18  
> **Branch:** `tp1-arch`  
> **Base Fork:** Roo Code (VS Code Extension)

---

## Table of Contents

1. [Extension Overview](#1-extension-overview)
2. [Physical Architecture & Privilege Separation](#2-physical-architecture--privilege-separation)
3. [The Agent Execution Loop (ReAct Cycle)](#3-the-agent-execution-loop-react-cycle)
4. [The Tool Execution Pipeline](#4-the-tool-execution-pipeline)
5. [The Approval & Human-in-the-Loop Mechanism](#5-the-approval--human-in-the-loop-mechanism)
6. [The System Prompt Builder](#6-the-system-prompt-builder)
7. [MCP Integration](#7-mcp-integration)
8. [Webview ↔ Extension Host IPC](#8-webview--extension-host-ipc)
9. [Key Injection Points for the Hook Engine](#9-key-injection-points-for-the-hook-engine)
10. [Hook System Architectural Decisions](#10-hook-system-architectural-decisions)
11. [Data Model & .orchestration/ Schema](#11-data-model--orchestration-schema)
12. [Diagrams](#12-diagrams)

---

## 1. Extension Overview

Roo Code is a VS Code extension that provides an autonomous AI coding agent inside the editor. It operates as a **sidebar Webview** that communicates with a **Node.js Extension Host** backend. The agent follows a ReAct (Reason-Act) loop: it receives user prompts, generates LLM responses containing tool calls, executes those tools against the local filesystem/terminal, and feeds results back to the LLM until the task is complete.

### Key Entry Points

| File | Purpose |
|------|---------|
| `src/extension.ts` | VS Code activation entry. Registers commands, initializes services, creates `ClineProvider`. |
| `src/activate/index.ts` | Barrel export for activation handlers: `registerCommands`, `registerCodeActions`, `registerTerminalActions`, `handleUri`. |
| `src/core/webview/ClineProvider.ts` | Implements `WebviewViewProvider`. Manages webview lifecycle, state, and IPC. The orchestrator. |
| `src/core/task/Task.ts` | The heart of the agent. Contains the ReAct loop, API calling, tool dispatch, and conversation management. (4,726 lines) |
| `src/core/assistant-message/presentAssistantMessage.ts` | Tool dispatch function. Parses streamed LLM responses and routes tool calls to handlers. (995 lines) |

---

## 2. Physical Architecture & Privilege Separation

Roo Code follows VS Code's strict process model:

```
┌─────────────────────────────────────────────────────────────────┐
│                        VS Code Host                             │
│                                                                 │
│  ┌─────────────────────┐    postMessage IPC    ┌──────────────┐ │
│  │   Webview (React)   │◄────────────────────►│  Extension    │ │
│  │                     │                       │  Host         │ │
│  │  - Chat UI          │                       │  (Node.js)   │ │
│  │  - Settings View    │                       │              │ │
│  │  - Approval Modals  │                       │  - Task.ts   │ │
│  │  - Diff Viewer      │                       │  - API calls │ │
│  │                     │                       │  - Tools     │ │
│  │  RESTRICTED:        │                       │  - MCP Hub   │ │
│  │  No fs/terminal     │                       │  - FS access │ │
│  │  access             │                       │  - Terminal  │ │
│  └─────────────────────┘                       └──────────────┘ │
│                                                       │         │
│                                                       ▼         │
│                                              ┌──────────────┐   │
│                                              │  LLM Provider │   │
│                                              │  (Anthropic,  │   │
│                                              │   OpenAI, etc)│   │
│                                              └──────────────┘   │
│                                                       │         │
│                                                       ▼         │
│                                              ┌──────────────┐   │
│                                              │  MCP Servers  │   │
│                                              │  (stdio/SSE)  │   │
│                                              └──────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**Privilege Separation:**
- **Webview (UI):** Sandboxed React application. Cannot access Node.js APIs, filesystem, or terminal. Communicates exclusively via `postMessage`.
- **Extension Host (Logic):** Full Node.js environment. Manages all LLM API calls, filesystem operations, terminal commands, secrets, and MCP server connections.
- **MCP Servers:** External processes connected via stdio/SSE/HTTP transport. Expose tools through the Model Context Protocol standard.

---

## 3. The Agent Execution Loop (ReAct Cycle)

The agent operates through a **two-level loop** in `Task.ts`:

### Outer Loop: `initiateTaskLoop()` (Line ~2477)

```
while (!this.abort) {
    didEndLoop = await recursivelyMakeClineRequests(userContent)
    if (didEndLoop) break
    // LLM didn't use any tools → re-prompt with "noToolsUsed" 
    userContent = [{ type: "text", text: formatResponse.noToolsUsed() }]
}
```

This ensures the agent always uses at least one tool per turn. If the LLM returns only text without tool calls, it re-prompts.

### Inner Loop: `recursivelyMakeClineRequests()` (Line ~2511)

Uses an **explicit stack** (not recursion) to manage the request chain:

```
┌──────────────────────────────────────────────────────────────┐
│                    STACK-BASED AGENT LOOP                     │
│                                                               │
│  1. Check consecutive mistakes → ask user if limit hit        │
│  2. Rate limit check → maybeWaitForProviderRateLimit()        │
│  3. Build environment details (file tree, diagnostics)        │
│  4. Add user message to apiConversationHistory                │
│  5. Build native tools array for current mode                 │
│  6. Call LLM API (attemptApiRequest) → stream response        │
│  7. For each chunk:                                           │
│     - "text"          → display to user                       │
│     - "tool_call_partial" → parse partial tool call, stream   │
│     - "tool_call"     → finalize tool, dispatch execution     │
│     - "reasoning"     → display thinking                      │
│     - "usage"         → track token usage                     │
│  8. After stream: save assistant message to history            │
│  9. Wait for all tool executions to complete                   │
│ 10. Collect tool results as new userContent                    │
│ 11. Push new stack item → continue loop                       │
└──────────────────────────────────────────────────────────────┘
```

### Critical Streaming Mechanism

During streaming, tool calls are parsed via `NativeToolCallParser` which emits:
- `tool_call_start` → registers new tool block
- `tool_call_delta` → updates partial arguments
- `tool_call_end` → finalizes the tool block

Each finalized tool triggers `presentAssistantMessage(this)` which executes the tool in real-time during streaming.

---

## 4. The Tool Execution Pipeline

**File:** `src/core/assistant-message/presentAssistantMessage.ts`

This is the **central tool dispatch function**. It processes each content block from the LLM response:

```
presentAssistantMessage(task)
    │
    ├── block.type === "mcp_tool_use"
    │       → Synthetic use_mcp_tool block → UseMcpToolTool.execute()
    │
    ├── block.type === "text"
    │       → Strip <thinking> tags → task.say("text", content)
    │
    └── block.type === "tool_use"
            │
            ├── Create callbacks: { askApproval, handleError, pushToolResult }
            ├── validateToolUse() → check mode permissions, disabled tools
            ├── toolRepetitionDetector.check() → prevent infinite loops
            │
            └── switch (block.name):
                    ├── "write_to_file"        → WriteToFileTool.execute()
                    ├── "apply_diff"           → ApplyDiffTool.execute()
                    ├── "apply_patch"          → ApplyPatchTool.execute()
                    ├── "read_file"            → ReadFileTool.execute()
                    ├── "execute_command"       → ExecuteCommandTool.execute()
                    ├── "search_files"         → SearchFilesTool.execute()
                    ├── "list_files"           → ListFilesTool.execute()
                    ├── "use_mcp_tool"         → UseMcpToolTool.execute()
                    ├── "attempt_completion"    → AttemptCompletionTool.execute()
                    ├── "new_task"             → NewTaskTool.execute()
                    ├── "switch_mode"          → SwitchModeTool.execute()
                    ├── "generate_image"       → GenerateImageTool.execute()
                    └── default                → customToolRegistry check
```

### Tool Base Class

All tools extend `BaseTool<TName>` (in `src/core/tools/BaseTool.ts`):

```typescript
abstract class BaseTool<TName extends ToolName> {
    abstract readonly name: TName
    abstract execute(params, task: Task, callbacks: ToolCallbacks): Promise<void>
    async handlePartial(task: Task, block: ToolUse<TName>): Promise<void> // streaming
}
```

**ToolCallbacks interface:**
```typescript
interface ToolCallbacks {
    askApproval: AskApproval      // Request user approval
    handleError: HandleError      // Report errors back to LLM
    pushToolResult: PushToolResult // Send tool result back to LLM
    toolCallId?: string           // Native tool call ID
}
```

### Key Tool Files

| Tool | File | Risk Level |
|------|------|-----------|
| `WriteToFileTool` | `src/core/tools/WriteToFileTool.ts` | **Destructive** — writes/creates files |
| `ExecuteCommandTool` | `src/core/tools/ExecuteCommandTool.ts` | **Destructive** — runs terminal commands |
| `ApplyDiffTool` | `src/core/tools/ApplyDiffTool.ts` | **Destructive** — applies diffs to files |
| `ReadFileTool` | `src/core/tools/ReadFileTool.ts` | Safe — read-only |
| `ListFilesTool` | `src/core/tools/ListFilesTool.ts` | Safe — read-only |
| `SearchFilesTool` | `src/core/tools/SearchFilesTool.ts` | Safe — read-only |
| `UseMcpToolTool` | `src/core/tools/UseMcpToolTool.ts` | Variable — depends on MCP tool |
| `AttemptCompletionTool` | `src/core/tools/AttemptCompletionTool.ts` | Safe — completion signal |
| `NewTaskTool` | `src/core/tools/NewTaskTool.ts` | Safe — spawns child task |

---

## 5. The Approval & Human-in-the-Loop Mechanism

### The `ask()` Method (Task.ts, Line ~1269)

The existing approval mechanism is the **primary insertion point for hook middleware**:

```
Tool.execute()
    │
    ├── askApproval(type, message)
    │       │
    │       └── task.ask(type, text)
    │               │
    │               ├── checkAutoApproval({ state, ask, text })
    │               │       │
    │               │       ├── "approve"  → auto-approve (bypass user)
    │               │       ├── "deny"     → auto-deny
    │               │       ├── "timeout"  → auto-approve after N ms
    │               │       └── "ask"      → block, show in UI
    │               │
    │               ├── [If "ask"] → postMessage to Webview
    │               │       │
    │               │       └── Webview shows approve/reject UI
    │               │               │
    │               │               └── User clicks → postMessage back
    │               │                       │
    │               │                       └── handleWebviewAskResponse()
    │               │                               │
    │               │                               └── Sets askResponse
    │               │
    │               └── await pWaitFor(() => askResponse !== undefined)
    │
    └── [If approved] → execute tool logic
        [If rejected] → pushToolResult(rejection) → didRejectTool = true
```

### Auto-Approval System (`src/core/auto-approval/`)

The auto-approval system classifies tools into categories:

| Category | Setting | Tool Types |
|----------|---------|-----------|
| Read-only | `alwaysAllowReadOnly` | `read_file`, `list_files`, `search_files`, etc. |
| Write | `alwaysAllowWrite` | `write_to_file`, `apply_diff`, `apply_patch` |
| Execute | `alwaysAllowExecute` | `execute_command` (with allowed/denied lists) |
| MCP | `alwaysAllowMcp` | `use_mcp_tool` (per-tool `alwaysAllow` flag) |
| Subtasks | `alwaysAllowSubtasks` | `new_task` |
| Mode Switch | `alwaysAllowModeSwitch` | `switch_mode` |

**Files:**
- `src/core/auto-approval/index.ts` — Main `checkAutoApproval()` decision tree
- `src/core/auto-approval/tools.ts` — `isWriteToolAction()`, `isReadOnlyToolAction()`
- `src/core/auto-approval/commands.ts` — `getCommandDecision()` (allowed/denied command lists)
- `src/core/auto-approval/mcp.ts` — `isMcpToolAlwaysAllowed()`
- `src/core/auto-approval/AutoApprovalHandler.ts` — Rate-limiting: max requests & max cost

---

## 6. The System Prompt Builder

**File:** `src/core/prompts/system.ts`

The system prompt is constructed dynamically via `SYSTEM_PROMPT()` (exported async function):

```
SYSTEM_PROMPT(context, cwd, supportsComputerUse, mcpHub, diffStrategy, mode, ...)
    │
    └── generatePrompt(...)
            │
            ├── getRoleDefinition()          → Mode-specific role (Architect, Code, Debug, etc.)
            ├── markdownFormattingSection()   → Formatting rules
            ├── getSharedToolUseSection()     → "You have access to tools..."
            ├── getToolUseGuidelinesSection() → Tool usage rules
            ├── getCapabilitiesSection()      → What the agent can do
            ├── getModesSection()             → Available modes description
            ├── getSkillsSection()            → Available skills
            ├── getRulesSection()             → Behavioral rules
            ├── getSystemInfoSection()        → OS, shell, cwd, etc.
            ├── getObjectiveSection()         → Task completion objective
            └── addCustomInstructions()       → User-defined + .roo/ rules + language
```

**Prompt Sections** (in `src/core/prompts/sections/`):

| Section File | Purpose |
|-------------|---------|
| `tool-use.ts` | Shared tool use instructions |
| `tool-use-guidelines.ts` | Tool-specific guidelines |
| `capabilities.ts` | Agent capabilities |
| `modes.ts` | Mode descriptions |
| `rules.ts` | Behavioral rules |
| `system-info.ts` | System information |
| `objective.ts` | Task objective |
| `custom-instructions.ts` | Custom rules & .roo files |
| `skills.ts` | Skills manager |

**Tool definitions** are built separately via `buildNativeToolsArrayWithRestrictions()` in `src/core/task/build-tools.ts` and sent as native tool schemas (not embedded in prompt text).

### Injection Point for Hook System

The system prompt is the place to inject the **reasoning protocol** that forces the agent to call `select_active_intent()` before writing code. The key injection point is the `addCustomInstructions()` chain, or we can add a new section specifically for intent-driven instructions.

---

## 7. MCP Integration

**Files:**
- `src/services/mcp/McpHub.ts` — MCP server lifecycle management (1,996 lines)
- `src/services/mcp/McpServerManager.ts` — Singleton manager, reference counting

### Architecture

```
Extension Host
    │
    └── McpHub
            │
            ├── initializeGlobalMcpServers()    ← ~/.roo-code/mcp_settings.json
            ├── initializeProjectMcpServers()   ← .mcp.json (workspace root)
            │
            ├── connectToServer(name, config, source)
            │       │
            │       ├── Create MCP Client
            │       ├── Create Transport (stdio | SSE | HTTP)
            │       ├── client.connect(transport)
            │       └── Fetch tools, resources, templates
            │
            ├── fetchToolsList(serverName)
            │       └── client.request({ method: "tools/list" })
            │
            └── callTool(serverName, toolName, args)
                    └── client.request({ method: "tools/call" }, timeout)
```

**Tool Discovery Flow:**
1. MCP servers declare their tools via the `tools/list` endpoint
2. `McpHub.fetchToolsList()` retrieves and caches them
3. Tools are injected into the native tool schema array alongside built-in tools
4. LLM calls them using `mcp_serverName_toolName` naming convention
5. `presentAssistantMessage` detects `mcp_tool_use` blocks and routes to `UseMcpToolTool`

---

## 8. Webview ↔ Extension Host IPC

### Communication Pattern

```
Webview (React)                    Extension Host (Node.js)
    │                                      │
    │  postMessage({ type: "newTask",      │
    │    text: "Build auth middleware" })   │
    │ ───────────────────────────────────►  │
    │                                      │  webviewMessageHandler()
    │                                      │  switch(message.type)
    │                                      │  case "newTask": createTask()
    │                                      │
    │  ◄─────────────────────────────────  │
    │  postMessage({ type: "state",        │  postStateToWebview()
    │    state: { clineMessages, ... } })  │
    │                                      │
    │  postMessage({ type: "askResponse",  │
    │    askResponse: "yesButtonClicked" }) │
    │ ───────────────────────────────────►  │
    │                                      │  handleWebviewAskResponse()
    │                                      │  → unblocks pWaitFor in ask()
```

### Key Methods

| Method | Location | Direction |
|--------|----------|-----------|
| `postMessageToWebview()` | `ClineProvider.ts:1127` | Host → Webview |
| `postStateToWebview()` | `ClineProvider.ts:1919` | Host → Webview (full state) |
| `setWebviewMessageListener()` | `ClineProvider.ts:1326` | Webview → Host (listener) |
| `webviewMessageHandler()` | `webviewMessageHandler.ts:89` | Webview → Host (dispatch) |

### Message Types (Extension → Webview)

| Type | Purpose |
|------|---------|
| `"state"` | Full application state update |
| `"action"` | Execute UI action (scroll, focus) |
| `"theme"` | Theme data update |
| `"mcpServers"` | MCP server status |

### Message Types (Webview → Extension)

| Type | Purpose |
|------|---------|
| `"webviewDidLaunch"` | Initialize state |
| `"newTask"` | Create new agent task |
| `"askResponse"` | User approval/rejection response |
| `"updateSettings"` | Settings change |
| `"clearTask"` | Cancel current task |
| `"showTaskWithId"` | Switch to historical task |
| ~50+ more | Various UI actions |

---

## 9. Key Injection Points for the Hook Engine

Based on the archaeological dig, these are the **critical injection points** for implementing the hook middleware:

### 9.1 PreToolUse Hook — `presentAssistantMessage.ts`

**Location:** `src/core/assistant-message/presentAssistantMessage.ts`, Line ~296 (tool_use block handler)

**Injection Strategy:** Before the `switch (block.name)` dispatches to a tool handler, inject the PreToolUse hook. This intercepts ALL tool executions — both built-in and MCP.

```
[EXISTING]  block.type === "tool_use"
[EXISTING]  validateToolUse()
[EXISTING]  toolRepetitionDetector.check()
[INSERT]    ──► PreToolUse Hook Engine ◄──
                 ├── Intent validation (select_active_intent required?)
                 ├── Scope enforcement (file in owned_scope?)
                 ├── Command classification (Safe vs Destructive)
                 ├── HITL authorization (destructive commands)
                 └── Context injection (active_intents.yaml data)
[EXISTING]  switch (block.name) { ... tool dispatch }
```

### 9.2 PostToolUse Hook — `presentAssistantMessage.ts`

**Location:** After each tool's `execute()` completes successfully, before `pushToolResult()` sends the result.

**Injection Strategy:** Wrap the tool result pipeline to intercept successful writes.

```
[EXISTING]  Tool.execute() completes
[INSERT]    ──► PostToolUse Hook Engine ◄──
                 ├── Trace serialization (agent_trace.jsonl)
                 ├── Content hashing (SHA-256 of written blocks)
                 ├── Intent map update (intent_map.md)
                 ├── Auto-formatting (lint/format)
                 └── Optimistic lock validation
[EXISTING]  pushToolResult() → adds to userMessageContent
```

### 9.3 System Prompt Injection — `system.ts`

**Location:** `src/core/prompts/system.ts`, in the `generatePrompt()` function.

**Injection Strategy:** Add a new section for the intent-driven protocol after `getObjectiveSection()`:

```
[EXISTING]  getObjectiveSection()
[INSERT]    ──► getIntentDrivenSection() ◄──
                 "You are an Intent-Driven Architect.
                  Your first action MUST be to call select_active_intent()..."
[EXISTING]  addCustomInstructions()
```

### 9.4 New Tool Registration — `build-tools.ts`

**Location:** `src/core/task/build-tools.ts`

**Injection Strategy:** Register `select_active_intent` as a new native tool available to the LLM.

### 9.5 Task Initialization — `Task.ts`

**Location:** `src/core/task/Task.ts`, in `startTask()` (Line ~1924)

**Injection Strategy:** Initialize hook engine state, load `active_intents.yaml`, and establish session context before the first LLM call.

---

## 10. Hook System Architectural Decisions

### Decision 1: Middleware Pattern (Interceptor/Chain of Responsibility)

**Choice:** Implement hooks as a **middleware chain** that wraps tool execution, NOT as inline modifications to existing tool classes.

**Rationale:**
- Tools remain unmodified — hooks are isolated and composable
- New hooks can be added/removed without touching tool code
- Follows the separation of concerns principle from the specification
- Mirrors the pattern used by Claude Code's hooks and Kiro IDE

### Decision 2: Unified `ToolHook` Interface Contract

**Choice:** All hooks implement a single `ToolHook` interface with `preExecute()` and `postExecute()` methods, plus an optional `classification` field.

**Implementation** (`src/hooks/ToolHook.ts`):
```typescript
export interface ToolHook {
    preExecute(toolName: string, payload: any): Promise<void | HookError>
    postExecute(toolName: string, payload: any): Promise<void | HookError>
    classification?: ToolClassification
}
```

**Rationale:**
- Single interface makes hook creation uniform and predictable
- Each hook file is self-contained — both pre and post logic in one class
- The optional `classification` field allows hooks to declare the risk tier they handle
- Hooks return `void` (proceed) or `HookError` (block with structured error)

### Decision 3: Centralized HookEngine Orchestrator

**Choice:** The `HookEngine` class manages separate `preHooks[]` and `postHooks[]` arrays. It iterates through them in registration order, calling `preExecute` before tool execution and `postExecute` after.

**Implementation** (`src/hooks/HookEngine.ts`):
```typescript
export class HookEngine {
    private preHooks: ToolHook[] = []
    private postHooks: ToolHook[] = []

    registerPreHook(hook: ToolHook) { ... }
    registerPostHook(hook: ToolHook) { ... }
    async executePreHooks(toolName: string, payload: any) { ... }
    async executePostHooks(toolName: string, payload: any) { ... }
}
```

**Rationale:**
- Shared state across parallel agent sessions (for `CLAUDE.md` lessons)
- Single control point for `.orchestration/` file access
- Clean API: `executePreHooks()` before tool, `executePostHooks()` after

### Decision 4: Deterministic Four-State Turn Machine

**Choice:** Implement a `TurnStateMachine` in `src/state-machine/TurnStateMachine.ts` with four explicit states that govern every conversation turn.

**States:**
| State | Meaning | Allowed Actions |
|-------|---------|----------------|
| `AWAITING_INTENT_SELECTION` | Initial state. Agent must call `select_active_intent` | Only `select_active_intent` |
| `CONTEXT_LOADED` | Intent selected, constraints injected | Read tools + validated writes |
| `ACTION_ALLOWED` | Destructive action passed scope check + HITL | Tool execution proceeds |
| `BLOCKED` | Error state (invalid intent, scope violation, stale file, HITL rejection) | No actions |

**Invariant Rule:** A destructive tool MUST NEVER execute unless state == `CONTEXT_LOADED` or `ACTION_ALLOWED`.

**Rationale:**
- Solves the "Context Paradox" — agent gets intent-specific constraints before acting
- Makes state transitions explicit and auditable — not implicit in scattered if-checks
- Prevents scope creep, context drift, and vibe coding
- The 4-state model covers error handling (`BLOCKED`) and recovery (`resetToContextLoaded`)

### Decision 5: Asynchronous Promise-Pausing for HITL

**Choice:** Leverage the existing `pWaitFor` + `askResponse` pattern for blocking tool execution pending human approval.

**Implementation** (`src/hooks/HITLHook.ts`):
- Intercepts destructive commands in `preExecute()`
- Triggers `vscode.window.showWarningMessage` with Approve/Reject
- Returns `HookError` on rejection → fed back to LLM for self-correction

**Rationale:**
- The architecture already supports this exact pattern in `Task.ask()`
- No need to rewrite the async flow — hook into `askApproval` callback
- For destructive commands, the hook elevates the approval requirement

### Decision 6: Sidecar Storage in `.orchestration/`

**Choice:** All hook state stored in `.orchestration/` directory at workspace root, using YAML and JSONL files.

**Rationale:**
- Non-destructive — doesn't pollute source code
- Machine-readable and version-controllable
- JSONL for append-only trace (high write performance)
- YAML for human-readable intent specifications
- `CLAUDE.md` lives inside `.orchestration/` alongside other machine-managed state

### Decision 7: Content Hashing for Spatial Independence

**Choice:** SHA-256 hashing of written code blocks for spatial-independent attribution.

**Rationale:**
- Line numbers are volatile; hashes are permanent
- If code moves to a different file, hash-based tracing survives
- Industry standard cryptographic hash ensures uniqueness

### Decision 8: Standardized Fail-Safe Error Format

**Choice:** All hooks return a structured `HookError` object on failure, enabling the LLM to self-correct.

**Implementation** (`src/hooks/types.ts`):
```typescript
export interface HookError {
    message: string
    code: string
    toolName?: string
    details?: any
}
```

**Rationale:**
- **Autonomous Recovery** — The agent receives a machine-parseable error, not a human string, so it can reason about the constraint and propose an alternative
- **Circuit Breaker Integration** — Consecutive `HookError` returns can trigger a circuit breaker, halting the loop and escalating to the human
- **Observability** — Error codes enable structured logging and metrics

---

## 11. Data Model & .orchestration/ Schema

### Directory Structure

```
.orchestration/
├── active_intents.yaml          # Intent specifications with lifecycle state
├── agent_trace.jsonl            # Append-only trace ledger
├── intent_map.md                # Spatial map: intent → files/AST
├── CLAUDE.md                    # Shared Brain — lessons & rules across sessions
└── .intentignore                # Patterns to exclude from intent tracking
```

### active_intents.yaml Schema

```yaml
active_intents:
  - id: "INT-001"
    name: "JWT Authentication Migration"
    status: "IN_PROGRESS"            # DRAFT | IN_PROGRESS | COMPLETED | ARCHIVED
    owned_scope:
      - "src/auth/**"
      - "src/middleware/jwt.ts"
    constraints:
      - "Must not use external auth providers"
      - "Must maintain backward compatibility with Basic Auth"
    acceptance_criteria:
      - "Unit tests in tests/auth/ pass"
    created_at: "2026-02-18T12:00:00Z"
    updated_at: "2026-02-18T14:30:00Z"
```

### agent_trace.jsonl Schema (per line)

```json
{
  "id": "uuid-v4",
  "timestamp": "2026-02-18T12:00:00Z",
  "vcs": {
    "revision_id": "git_sha_hash"
  },
  "session_id": "session-uuid",
  "intent_id": "INT-001",
  "mutation_class": "INTENT_EVOLUTION",
  "files": [
    {
      "relative_path": "src/auth/middleware.ts",
      "conversations": [
        {
          "url": "session_log_id",
          "contributor": {
            "entity_type": "AI",
            "model_identifier": "claude-3-5-sonnet"
          },
          "ranges": [
            {
              "start_line": 15,
              "end_line": 45,
              "content_hash": "sha256:a8f5f167f44f4964e6c998dee827110c"
            }
          ],
          "related": [
            {
              "type": "specification",
              "value": "INT-001"
            }
          ]
        }
      ]
    }
  ]
}
```

### intent_map.md Schema

```markdown
# Intent Map

## INT-001: JWT Authentication Migration

**Status:** IN_PROGRESS  
**Scope:**

| File | AST Nodes | Last Modified |
|------|-----------|---------------|
| src/auth/middleware.ts | authenticateUser(), validateToken() | 2026-02-18 |
| src/auth/jwt.ts | signToken(), verifyToken() | 2026-02-18 |

**Dependencies:** None  
**Blocks:** INT-002 (API Rate Limiting)
```

---

## 12. Implemented Hook System — Source Code Map

The hook system is implemented across two directories:

### 12.1 `src/hooks/` — Hook Middleware Layer

| File | Class/Interface | Purpose |
|------|----------------|--------|
| `ToolHook.ts` | `ToolHook` interface | Universal contract: `preExecute()` + `postExecute()` returning `void \| HookError` |
| `types.ts` | `ToolClassification`, `HookError` | Enums (`SAFE` / `DESTRUCTIVE`) + structured error format |
| `HookEngine.ts` | `HookEngine` class | Central orchestrator — iterates pre-hooks then post-hooks |
| `IntentSelectionHook.ts` | `IntentSelectionHook` | Validates `select_active_intent` payload against `active_intents.yaml` |
| `ScopeEnforcementHook.ts` | `ScopeEnforcementHook` | Checks target file against `owned_scope` globs |
| `WriteFileHook.ts` | `WriteFileHook` | Pre: check scope + preconditions. Post: log trace + content hash |
| `HITLHook.ts` | `HITLHook` | Shows `vscode.window.showWarningMessage` for destructive commands |
| `TraceLedgerHook.ts` | `TraceLedgerHook` | Post-hook: appends to `agent_trace.jsonl` with Agent Trace schema |
| `OptimisticLockHook.ts` | `OptimisticLockHook` | Pre: compares file hash to detect parallel write collisions |

### 12.2 `src/state-machine/` — Turn State Machine

| File | Class/Enum | Purpose |
|------|-----------|--------|
| `TurnStateMachine.ts` | `TurnStateMachine`, `TurnState` | 4-state deterministic machine governing every conversation turn |

**`TurnState` enum:**
- `AWAITING_INTENT_SELECTION` — Initial state; only `select_active_intent` allowed
- `CONTEXT_LOADED` — Intent constraints injected; reads and validated writes allowed
- `ACTION_ALLOWED` — Destructive action passed all validation (scope, HITL, lock)
- `BLOCKED` — Error state; no actions until resolved

**Key Methods:**
```typescript
startTurn(conversationId)              // → AWAITING_INTENT_SELECTION
onIntentSelected(conversationId, id)   // → CONTEXT_LOADED
canExecuteWrite(conversationId)        // boolean check
allowAction(conversationId)            // → ACTION_ALLOWED
block(conversationId)                  // → BLOCKED
resetToContextLoaded(conversationId)   // → CONTEXT_LOADED (after success)
```

### 12.3 `docs/` — Architecture Documentation

| File | Purpose |
|------|--------|
| `ARCHITECTURE_NOTES.md` | This document — Phase 0 archaeological dig |
| `HOOK_DIAGRAMS.md` | Hook middleware layer components and flow |
| `STATE_MACHINE.md` | Deterministic two-stage state machine spec |
| `TRACE_SCHEMA.md` | Agent Trace JSONL schema specification |

---

## 13. Diagrams

### 13.1 High-Level Hook Engine Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│                           HOOK ENGINE MIDDLEWARE                            │
│                                                                            │
│  ┌──────────────────┐   ┌──────────────┐   ┌──────────────────┐           │
│  │  PreHooks Chain   │   │  Tool        │   │  PostHooks Chain  │          │
│  │  (preExecute)     │──►│  Execution   │──►│  (postExecute)    │          │
│  │                   │   │              │   │                   │          │
│  │  IntentSelection  │   │  (existing   │   │  TraceLedger      │          │
│  │  ScopeEnforcement │   │   tool code) │   │  WriteFile (post) │          │
│  │  WriteFile (pre)  │   │              │   │  OptimisticLock   │          │
│  │  HITLHook         │   │  WriteToFile │   │                   │          │
│  │  OptimisticLock   │   │  ExecuteCmd  │   │                   │          │
│  │                   │   │  ApplyDiff   │   │                   │          │
│  └──────────────────┘   └──────────────┘   └──────────────────┘           │
│         │                                          │                       │
│         ▼                                          ▼                       │
│  ┌──────────────┐                          ┌──────────────┐               │
│  │ .orchestration/                         │ .orchestration/               │
│  │ active_intents.yaml                     │ agent_trace.jsonl             │
│  │ (READ)                                  │ (APPEND)                      │
│  └──────────────┘                          │ CLAUDE.md (APPEND)            │
│                                            └──────────────┘               │
└────────────────────────────────────────────────────────────────────────────┘
```

### 13.2 Four-State Turn Machine (Deterministic Intent Governance)

```
                         User Request
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  STATE 1: AWAITING_INTENT_SELECTION                              │
│                                                                  │
│  Allowed:  select_active_intent ONLY                             │
│  Blocked:  write_file, execute_command, delete_file              │
│                                                                  │
│  Invariant: No destructive tool may execute.                     │
└──────────────────────┬───────────────────────────────────────────┘
                       │ select_active_intent(INT-001) [valid]
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│  STATE 2: CONTEXT_LOADED                                         │
│                                                                  │
│  Intent constraints, scope, and trace history injected.          │
│  Allowed:  read_file, write_file (if scope valid + HITL pass)    │
│  On success → ACTION_ALLOWED.  On error → BLOCKED.               │
└──────────┬───────────────────────────┬──────────────────────────┘
           │ write_file validated       │ Error (scope/HITL/stale)
           ▼                           ▼
┌─────────────────────┐     ┌─────────────────────┐
│  STATE 3:           │     │  STATE 4:           │
│  ACTION_ALLOWED     │     │  BLOCKED            │
│                     │     │                     │
│  Tool executes.     │     │  No actions.        │
│  PostHooks run:     │     │  Requires:          │
│  • Trace ledger     │     │  • User resolution  │
│  • Content hash     │     │  • Re-read file     │
│  • Intent map       │     │  • New intent       │
│                     │     │                     │
│  After success →    │     │                     │
│  CONTEXT_LOADED     │     │                     │
└─────────────────────┘     └─────────────────────┘
```

### 13.3 Tool Execution Flow with Hooks + State Machine

```
                    LLM Response (streamed)
                           │
                           ▼
              ┌─────────────────────────┐
              │  NativeToolCallParser   │
              │  Parses tool_call chunks│
              └─────────┬───────────────┘
                        │
                        ▼
              ┌─────────────────────────┐
              │ presentAssistantMessage │
              │ (Tool Dispatch)         │
              └─────────┬───────────────┘
                        │
                        ▼
              ┌─────────────────────────┐
              │ validateToolUse()       │
              │ Mode permissions check  │
              └─────────┬───────────────┘
                        │
                        ▼
              ┌─────────────────────────┐
              │ TurnStateMachine.check  │
              │ Is state valid for this │
              │ tool type?              │──────► BLOCK if AWAITING_INTENT
              └─────────┬───────────────┘        + destructive tool
                        │
                        ▼
         ┌──────────────────────────────────┐
         │    *** PRE-HOOKS (preExecute) ***│
         │                                  │
         │  ┌────────────────────────────┐  │
         │  │ IntentSelectionHook        │  │
         │  │ Validate intent_id exists  │  │
         │  │ in active_intents.yaml     │──┤──► HookError if invalid
         │  └────────────────────────────┘  │
         │  ┌────────────────────────────┐  │
         │  │ ScopeEnforcementHook       │  │
         │  │ Target file in owned_scope?│──┤──► HookError if scope violation
         │  └────────────────────────────┘  │
         │  ┌────────────────────────────┐  │
         │  │ WriteFileHook (pre)        │  │
         │  │ Preconditions check        │  │
         │  └────────────────────────────┘  │
         │  ┌────────────────────────────┐  │
         │  │ HITLHook                   │  │
         │  │ Destructive command?       │──┤──► showWarningMessage
         │  │ → Approve/Reject modal     │  │    Approve → proceed
         │  └────────────────────────────┘  │    Reject → HookError
         │  ┌────────────────────────────┐  │
         │  │ OptimisticLockHook (pre)   │  │
         │  │ File hash == expected?     │──┤──► HookError if stale file
         │  └────────────────────────────┘  │
         └──────────────┬───────────────────┘
                        │ All hooks pass → TurnStateMachine.allowAction()
                        ▼
              ┌─────────────────────────┐
              │  Tool.execute()         │
              │  (WriteToFile, Exec,..) │
              └─────────┬───────────────┘
                        │
                        ▼
         ┌──────────────────────────────────┐
         │   *** POST-HOOKS (postExecute)***│
         │                                  │
         │  ┌────────────────────────────┐  │
         │  │ WriteFileHook (post)       │  │
         │  │ SHA-256 content hash       │  │
         │  │ Log to trace ledger        │  │
         │  └────────────────────────────┘  │
         │  ┌────────────────────────────┐  │
         │  │ TraceLedgerHook            │  │
         │  │ Build Agent Trace JSON     │  │
         │  │ Append to agent_trace.jsonl│  │
         │  │ Inject intent_id + hash    │  │
         │  └────────────────────────────┘  │
         └──────────────┬───────────────────┘
                        │ TurnStateMachine.resetToContextLoaded()
                        ▼
              ┌─────────────────────────┐
              │  pushToolResult()       │
              │  → Back to LLM loop     │
              └─────────────────────────┘
```

### 13.4 Parallel Orchestration with Optimistic Locking

```
┌──────────────────────┐        ┌──────────────────────┐
│  Agent A (Architect)  │        │  Agent B (Builder)    │
│  Task Panel 1         │        │  Task Panel 2         │
│                       │        │                       │
│  1. select_intent     │        │  1. select_intent     │
│     (INT-001)         │        │     (INT-001)         │
│  StateMachine →       │        │  StateMachine →       │
│  CONTEXT_LOADED       │        │  CONTEXT_LOADED       │
│                       │        │                       │
│  2. read intent_map   │        │  2. write_to_file     │
│                       │        │     src/auth/jwt.ts   │
│  3. update plan       │        │                       │
│                       │        │  3. OptimisticLock-   │
│                       │        │     Hook.preExecute:  │
│                       │        │     hash_before !=    │
│                       │        │     hash_on_disk?     │
│                       │        │     ├─ MATCH → write  │
│                       │        │     └─ DIFFER → BLOCK │
│                       │        │       HookError:      │
│                       │        │       "Stale File"    │
│                       │        │       → re-read       │
└──────────┬───────────┘        └──────────┬───────────┘
           │                               │
           └───────────┬───────────────────┘
                       ▼
          ┌───────────────────────┐
          │ .orchestration/       │
          │ CLAUDE.md             │
          │ (Shared Brain)        │
          │                       │
          │ Lessons Learned:      │
          │ - "jwt.ts requires    │
          │   async import"       │
          │ - "Tests must run     │
          │   before push"        │
          └───────────────────────┘
```

### 13.5 Data Flow Diagram

```
                    ┌─────────────────┐
                    │    User Input    │
                    │  "Refactor auth" │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │  System Prompt   │◄── .orchestration/active_intents.yaml
                    │  + Intent Rules  │◄── .roo/ custom instructions
                    │  + Tool Catalog  │◄── CLAUDE.md (shared brain)
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │    LLM API      │
                    │  (Claude, etc.) │
                    └────────┬────────┘
                             │
                    ┌────────┴────────┐
                    │                 │
              tool_call          tool_call
         select_active_intent    write_to_file
                    │                 │
                    ▼                 ▼
           ┌──────────────┐  ┌──────────────┐
           │ PreHook:     │  │ PreHook:     │
           │ Load intent  │  │ Scope check  │
           │ Return XML   │  │ HITL auth    │
           │ context      │  │              │
           └──────┬───────┘  └──────┬───────┘
                  │                  │
                  ▼                  ▼
           (result to LLM)   ┌──────────────┐
                             │ File write   │
                             └──────┬───────┘
                                    │
                                    ▼
                             ┌──────────────┐
                             │ PostHook:    │
                             │ Hash content │
                             │ Write trace  │──► .orchestration/agent_trace.jsonl
                             │ Update map   │──► .orchestration/intent_map.md
                             └──────────────┘
```

---

## Summary of Key Findings

| Aspect | Finding |
|--------|---------|
| **Tool Loop** | `Task.ts` → `initiateTaskLoop()` → `recursivelyMakeClineRequests()` (stack-based) |
| **Tool Dispatch** | `presentAssistantMessage.ts` — switch on `block.name`, delegates to `BaseTool` subclasses |
| **Approval Mechanism** | `Task.ask()` → `checkAutoApproval()` → `pWaitFor(askResponse)` pattern |
| **Prompt Builder** | `SYSTEM_PROMPT()` in `system.ts` — composable section functions |
| **MCP** | `McpHub` manages connections, `UseMcpToolTool` handles execution |
| **IPC** | `postMessage` bidirectional, `ClineProvider` orchestrates |
| **Hook System** | `ToolHook` interface → `HookEngine` orchestrator → 6 concrete hooks in `src/hooks/` |
| **State Machine** | `TurnStateMachine` in `src/state-machine/` — 4-state deterministic governance |
| **State Storage** | Sidecar `.orchestration/` directory — YAML + JSONL + CLAUDE.md |
