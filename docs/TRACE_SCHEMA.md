# Trace Schema — `agent_trace.jsonl`

Append-only JSONL ledger recording every tool execution by the AI agent.

## Format

One JSON record per line. No array wrapper.

## Record Schema

| Field             | Type                | Description                                                   |
| ----------------- | ------------------- | ------------------------------------------------------------- |
| `id`              | `string` (UUIDv4)   | Unique trace entry identifier                                 |
| `timestamp`       | `string` (ISO-8601) | When the trace was recorded                                   |
| `vcs.revision_id` | `string`            | Git HEAD (short hash) at time of trace                        |
| `session_id`      | `string` (UUIDv4)   | Agent session identifier                                      |
| `intent_id`       | `string \| null`    | Active intent from TurnStateMachine (e.g., `"INT-001"`)       |
| `tool_name`       | `string`            | Name of the executed tool                                     |
| `mutation_class`  | `enum`              | `AST_REFACTOR`, `INTENT_EVOLUTION`, `READ_ONLY`, or `UNKNOWN` |
| `duration_ms`     | `number`            | Tool execution time in milliseconds                           |
| `success`         | `boolean`           | Whether the tool execution succeeded                          |
| `error`           | `string?`           | Error message if execution failed                             |
| `files`           | `TraceFileEntry[]`  | Files affected by the tool execution                          |

### TraceFileEntry

| Field           | Type                  | Description                      |
| --------------- | --------------------- | -------------------------------- |
| `relative_path` | `string`              | Workspace-relative file path     |
| `conversations` | `TraceConversation[]` | Modifications/reads on this file |

### TraceConversation

| Field                          | Type              | Description                              |
| ------------------------------ | ----------------- | ---------------------------------------- |
| `url`                          | `string`          | Session reference                        |
| `contributor.entity_type`      | `"AI" \| "HUMAN"` | Who made the change                      |
| `contributor.model_identifier` | `string?`         | Model used (e.g., `"claude-3-5-sonnet"`) |
| `ranges`                       | `TraceRange[]`    | Affected line ranges with content hashes |
| `related`                      | `TraceRelation[]` | Related intents/specs                    |

### TraceRange

| Field          | Type      | Description                        |
| -------------- | --------- | ---------------------------------- |
| `start_line`   | `number?` | Start line of affected range       |
| `end_line`     | `number?` | End line of affected range         |
| `content_hash` | `string`  | `sha256:<hex>` hash of the content |

### TraceRelation

| Field   | Type     | Description                                      |
| ------- | -------- | ------------------------------------------------ |
| `type`  | `string` | `"specification"`, `"intent"`, or `"dependency"` |
| `value` | `string` | Reference value (e.g., `"INT-001"`)              |

## Example Record

```json
{
	"id": "550e8400-e29b-41d4-a716-446655440000",
	"timestamp": "2026-02-18T12:00:00Z",
	"vcs": { "revision_id": "abc123d" },
	"session_id": "session-uuid-v4",
	"intent_id": "INT-001",
	"tool_name": "write_to_file",
	"mutation_class": "AST_REFACTOR",
	"duration_ms": 42,
	"success": true,
	"files": [
		{
			"relative_path": "src/api/weather/index.ts",
			"conversations": [
				{
					"url": "session-uuid-v4",
					"contributor": {
						"entity_type": "AI",
						"model_identifier": "minimax-m2.5:cloud"
					},
					"ranges": [
						{
							"start_line": 1,
							"end_line": 45,
							"content_hash": "sha256:a8f5f167f44f4964e6c998dee827110c"
						}
					],
					"related": [
						{
							"type": "intent",
							"value": "INT-001"
						}
					]
				}
			]
		}
	]
}
```

## Design Properties

- **Append-only**: New records are appended as new lines. No parse-rewrite cycle.
- **SHA-256 content hashing**: Provides spatial independence — code moves don't break attribution.
- **Mutation classification**: Distinguishes read-only operations from destructive writes.
- **VCS-aware**: Each record captures the Git revision for temporal context.

## Location

```
.orchestration/agent_trace.jsonl
```
