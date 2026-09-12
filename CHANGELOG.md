# Changelog

## 0.2.1

### Safety and correctness

- Validate job IDs; serialize atomic state writes and protect returned snapshots.
- Refuse silent shared-workspace fallback and dirty worktree sources.
- Capture worker commits against the original base commit.
- Reject dirty/conflicting patch application without resetting the user's index.
- Replace ambiguous workspace-write permissions with explicit ACP/CLI modes.
- Bound process output and enforce deadlines; wait for cancellation to settle.
- Guard lifecycle transitions; mark jobs interrupted after a gateway restart.
- Lock temporary ACP configuration, preserve external edits, and close sessions before cleanup.
- Unify strict model-binding precedence and validate configuration defaults.
- Distinguish executable discovery from runtime readiness in doctor.
- Hide stale patches and bound model-visible result summaries.

### Verification and documentation

- Add regression tests and MCP/ACP integration fixtures without paid inference.
- Add Node 22/24 CI on Windows and Ubuntu and reproducible dependency locking.
- Introduce the U.A.G.C project identity, setup guide, migration notes, and verification scope.
- Retain the universal-agent-mcp executable and MCP identity for compatibility.

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
