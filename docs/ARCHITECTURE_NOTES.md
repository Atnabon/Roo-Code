# Roo Code Nervous System Mapping

## 1. Tool Execution Entry Point

- Function: `execute_command(toolName, payload)`
- Responsible for dispatching tools to Extension Host
- Triggers Pre/Post Hooks

## 2. LLM Response Parsing

- Function: `parseLLMResponse`
- Converts raw LLM output into structured commands
- Validates command schema

## 3. write_file Execution

- Function: `write_file`
- Writes content to disk
- Handles async and error callbacks

## 4. System Prompt Construction

- Function: `buildSystemPrompt`
- Combines base instructions + user context
- Injects session metadata

## 5. Execution Flow (Simplified)

1. User triggers a tool (e.g., "refactor auth middleware")
2. `execute_command` receives request
3. System prompt built via `buildSystemPrompt`
4. LLM generates output
5. Output parsed by `parseLLMResponse`
6. `write_file` updates disk
7. Post-Hook logs trace / updates internal state
