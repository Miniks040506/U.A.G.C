# Changelog

## 0.2.0

- Separated coding `runtime` from inference `provider` and `model`.
- Added model aliases and execution profiles.
- Added `runtime_list`, `model_list`, `profile_list`, and `execution_resolve` MCP tools.
- Added strict capability-aware model/provider binding.
- Added provider-aware Hermes ACP binding (`provider:model`).
- Added CLI `{{provider}}`, `{{runtimeModel}}`, and `{{runtime}}` placeholders plus templated runtime env.
- Persist resolved execution binding in each job/result.
- Preserved V0.1 `agent` input and `agent_list` compatibility.
- Expanded automated tests including Qwen-through-Hermes resolution.
