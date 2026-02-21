# Intent Map: Feature-to-Code Traceability

This map tracks which intents are responsible for which file mutations. It is automatically updated by the `WriteFileHook`.

## INT-001: Implement Core Hook Engine

**Status:** COMPLETED

| File                    | Last Tool     | Last Modified | Content Hash                            |
| ----------------------- | ------------- | ------------- | --------------------------------------- |
| src/hooks/HookEngine.ts | write_to_file | 2026-02-18    | sha256:5fb0802c72c69c6ce1fe4b36c20a2a44 |
| src/hooks/ToolHook.ts   | write_to_file | 2026-02-18    | sha256:67cb146398469bb76093595de4e4a0ce |
| src/hooks/types.ts      | write_to_file | 2026-02-18    | sha256:3a9f8c2d7e1b4f6ca082d5e7f91b3c46 |

## INT-002: Implement Phase 1 Handshake

**Status:** IN_PROGRESS

| File                                                        | Last Tool     | Last Modified | Content Hash                            |
| ----------------------------------------------------------- | ------------- | ------------- | --------------------------------------- |
| src/hooks/IntentSelectionHook.ts                            | write_to_file | 2026-02-18    | sha256:56a75b6acb06386a070998cef953c2e8 |
| src/core/task/Task.ts                                       | apply_diff    | 2026-02-19    | sha256:9088929c461406a18267447c197b75ee |
| src/core/prompts/tools/native-tools/select_active_intent.ts | write_to_file | 2026-02-19    | sha256:60057568f3e62a927be87a6707630c33 |
| src/core/prompts/system.ts                                  | apply_diff    | 2026-02-19    | sha256:6757e2a7b3672a148de9d82d92a786f7 |
| src/state-machine/TurnStateMachine.ts                       | write_to_file | 2026-02-18    | sha256:6babcbd04ad1c240168c650e8b50e09f |
| src/core/prompts/sections/intent-protocol.ts                | write_to_file | 2026-02-19    | sha256:a3c8e92f1d7b4520986cadf2e7185b30 |

## INT-003: Implement Phase 2 Security Middleware

**Status:** IN_PROGRESS

| File                              | Last Tool     | Last Modified | Content Hash                            |
| --------------------------------- | ------------- | ------------- | --------------------------------------- |
| src/hooks/ScopeEnforcementHook.ts | write_to_file | 2026-02-18    | sha256:e1d54ef14250abf98992572273dcd95e |
| src/hooks/HITLHook.ts             | write_to_file | 2026-02-18    | sha256:cf5218fe2e8d0ae285c063d6944404f3 |
| src/hooks/WriteFileHook.ts        | write_to_file | 2026-02-18    | sha256:0639a551c65098d5ec9ba12f7c6ad1f1 |
| src/hooks/TraceLedgerHook.ts      | write_to_file | 2026-02-18    | sha256:84eb23efa2e4d7060cce903c3199ce0c |

## INT-004: Implement Phase 4 Parallel Workflow

**Status:** IN_PROGRESS

| File                                                  | Last Tool     | Last Modified | Content Hash                            |
| ----------------------------------------------------- | ------------- | ------------- | --------------------------------------- |
| src/hooks/OptimisticLockHook.ts                       | write_to_file | 2026-02-18    | sha256:089b0ff59548490c21b38106d681c866 |
| .orchestration/.intentignore                          | write_to_file | 2026-02-18    | sha256:aa5524ff823f4509b61dbb58e2ed077c |
| src/core/assistant-message/presentAssistantMessage.ts | apply_diff    | 2026-02-19    | sha256:b71cdd8e560624aa78a9290ec8886871 |
