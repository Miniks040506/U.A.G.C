# Technical reference

**Universal Agent Gateway Connectivity** · v0.2.2

A local MCP gateway for delegating coding work to external agents, reviewing the resulting Git patch, and applying it to the original repository.

U.A.G.C separates the coding **runtime** from its inference **provider** and **model**. Your MCP client remains responsible for planning, review, and approval; workers implement a bounded task in a separate Git worktree.

```text
MCP client / architect
  → resolve runtime + provider + model
  → delegate task and plan
  → worker edits an isolated Git worktree
  → inspect status, summary, and patch
  → resume the same ACP session with review feedback
  → apply the reviewed patch
  → validate the target repository and clean up
```

> **Status:** an early local developer tool. MCP/ACP transport and repository workflows are tested with deterministic workers. The named third-party runtime profiles are configuration examples, not certified integrations. Worktrees provide Git isolation, not an operating-system sandbox.

## What it provides

- One stdio MCP server with 12 tools for discovery, delegation, review, and cleanup.
- Runtime/model registries and reusable execution profiles.
- Persistent ACP sessions through `acpx`, with a generic CLI adapter for other workers.
- Asynchronous jobs, bounded process output, deadlines, and cancellation handling.
- Worktree patches captured against the original commit, including changes committed by a worker.
- Clean-target patch application that preserves the user's Git index.
- Local job records, prompts, logs, and patches for inspection.

There is no hosted service, model router, web UI, or built-in credential manager.

## Requirements

- Node.js **22.13 or newer** and Git on `PATH`.
- An MCP client that can launch a stdio server.
- Any coding runtime you intend to use, installed and authenticated separately.
- A clean Git repository with at least one commit for worktree mode.

For generic CLI workers on Windows, configure a native executable or `node.exe` plus a script path. Raw `.cmd`/`.bat` launchers are not supported by the shell-free CLI adapter.

## Install and validate

```sh
git clone https://github.com/Miniks040506/U.A.G.C.git
cd U.A.G.C
npm ci --ignore-scripts
npm test
npm run doctor -- --config ./agents.example.json
```

On PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`.

The repository is private; cloning requires access. Installation is local to the checkout. Tests use temporary repositories and deterministic worker fixtures; they do not invoke a paid model or require provider credentials.

`doctor` only checks executable discovery and configuration resolution. `FOUND` does **not** prove that the runtime is authenticated, its ACP handshake works, or the requested model is available.

## Connect an MCP client

Use the client's stdio-server configuration with absolute paths:

```json
{
  "mcpServers": {
    "uagc": {
      "command": "node",
      "args": [
        "C:/tools/U.A.G.C/src/index.mjs",
        "--config",
        "C:/tools/U.A.G.C/agents.example.json"
      ]
    }
  }
}
```

Replace both paths with your checkout location. The existing executable/package name `universal-agent-mcp` and MCP server identity are retained for compatibility.

## Configuration

Use `agents.example.json` as a starting point. Remove unused example entries and replace model slugs with values supported by your provider and runtime.

| Term | Meaning | Example |
| --- | --- | --- |
| Runtime | The agent program that reads, edits, and runs code | Hermes, Codex, OpenCode |
| Provider | The inference service used by that runtime | OpenRouter |
| Model | The model alias or concrete model identifier | `qwen` |
| Profile | A named runtime/model combination | `qwen-hermes` |

The sample `qwen` runtime refers to **Qwen Code**. The sample `qwen` model alias refers to an inference model; these are different concepts.

A minimal provider-aware ACP configuration:

```json
{
  "runtimes": {
    "hermes": {
      "kind": "acp",
      "target": "hermes",
      "argv": ["hermes", "acp"],
      "prerequisite": "hermes",
      "modelSelection": {
        "supportsModel": true,
        "supportsProvider": true,
        "format": "{{provider}}:{{model}}"
      }
    }
  },
  "models": {
    "qwen": { "provider": "openrouter", "model": "qwen/qwen3-coder" }
  },
  "profiles": {
    "qwen-hermes": { "runtime": "hermes", "model": "qwen" }
  },
  "defaults": {
    "workspaceMode": "worktree",
    "permissions": "read-only",
    "timeoutSeconds": 1800,
    "maxDiffChars": 120000,
    "strictModelBinding": true
  }
}
```

The model ID above is an example; verify it with the chosen provider. Credentials remain with the runtime. Do not put secrets into committed configuration files. Workers inherit the gateway's process environment.

Resolution precedence is **explicit input → profile → defaults** for strict binding. Model aliases can also supply runtime-specific overrides. CLI model/provider declarations must have corresponding argv/env placeholders, including formatted {{runtimeModel}} transport. Runtime-specific overrides are checked too. Capability flags are declarations: resolution verifies the declared compatibility, not which model a remote service actually used.

CLI runtimes define `kind: "cli"`, an `argv` array, and optional `env` values. Supported placeholders are `{{cwd}}`, `{{promptFile}}`, `{{prompt}}`, `{{runtime}}`, `{{provider}}`, `{{model}}`, and `{{runtimeModel}}`. Prefer `{{promptFile}}` for large prompts. Without a prompt placeholder in `argv`, the adapter sends the prompt on stdin.

## Permissions and isolation

| Mode | Adapter | Behavior |
| --- | --- | --- |
| `read-only` | ACP | Approves ACP read/search requests; denies non-read permission requests. Default. |
| `approve-all` | ACP | Explicitly auto-approves ACP permission requests. Use only with trusted workers and tasks. |
| `runtime-managed` | CLI | Delegates permissions to the configured CLI. U.A.G.C does not enforce a filesystem policy. |

The ambiguous v0.2.0 `workspace-write` value is rejected. No mode creates an OS sandbox or controls operations an agent performs outside the ACP client. Use a separate container, VM, or OS account when stronger isolation is required.

Worktree mode refuses a non-Git or dirty source directory. `shared` must be explicitly selected and permits direct edits in the source directory. Shared jobs cannot be applied through `agent_apply`; their changes already exist in place.

## Review and apply workflow

1. Inspect the target repository and write the implementation plan.
2. Call `execution_resolve` with the intended runtime/model or profile.
3. Start a worker with `agent_delegate`:

```json
{
  "profile": "qwen-hermes",
  "cwd": "D:/repos/my-app",
  "task": "Implement the approved change",
  "plan": "Describe the exact behavior, files, and acceptance checks",
  "workspaceMode": "worktree",
  "permissions": "approve-all"
}
```

4. Poll `agent_status`, then inspect `agent_result`. Review the actual patch and worker diagnostics. A successful process exit does not mean its implementation is correct.
5. For ACP jobs, call `agent_resume` with precise feedback before applying. CLI jobs do not support resume.
6. After approval in your client, call `agent_apply`. The source must be clean and still on the original branch and commit; `allowDirty=true` is rejected. The patch is checked before application, and conflicting patches are rejected without a three-way merge.
7. Run the target project's checks yourself, then call `agent_cleanup` to close the ACP session and remove its worktree and temporary branch.

`agent_apply` does not create a commit or push. Approval is a responsibility of the caller; U.A.G.C does not implement an independent human-approval token. Applied or cleaned jobs cannot be resumed.

## MCP tools

| Tools | Purpose |
| --- | --- |
| `runtime_list`, `agent_list` | Runtime discovery; `agent_list` is the legacy alias |
| `model_list`, `profile_list` | Configured aliases and profiles |
| `execution_resolve` | Resolve a binding without launching a worker |
| `agent_delegate` | Start a job and return its ID |
| `agent_status`, `agent_result` | Status, diagnostics, summary, and captured patch |
| `agent_resume` | Continue an ACP session with feedback |
| `agent_cancel` | Cancel active work and wait for the local attempt to settle |
| `agent_apply` | Apply a completed worktree patch to a clean target |
| `agent_cleanup` | Close the ACP session and remove the worktree |

## State and operational limits

State defaults to `~/.universal-agent-mcp`. Override it with `stateDir` in configuration or `UAG_STATE_DIR`. An exclusive gateway.lock permits one gateway process per state directory; use separate state directories for separate clients. A clean process exit releases ownership. After a hard crash the lock is retained: inspect its PID, surviving workers and worktrees before manually removing it. Stale locks are never automatically stolen.

Each job stores its resolved binding, prompt, attempt logs, workspace metadata, and patch. Job IDs are validated and job JSON updates are serialized and atomically replaced. State files can contain repository content and sensitive worker output; protect them as you would the source repository.

- Process output is limited to 8 MiB per command; exceeding it fails the command. Result summaries retain the last 8,000 characters, with a truncation flag. Patch display is capped separately by `maxDiffChars`.
- Generic process calls default to 60 seconds; worker calls use the job deadline. Process termination has an additional bounded grace period.
- Cancellation is best effort for detached descendants. An unconfirmed termination becomes `termination-uncertain`, which blocks automatic cleanup and resume.
- Timeout/cancel results retain partial patches once local termination is confirmed. Failed and cancelled jobs remain ineligible for apply. Review or export partial work before cleanup. Uncertain termination skips capture.
- Jobs created before v0.2.2 lack the original branch identity and cannot be applied; start a fresh job.
- Closing an ACP session that was never created is treated as already closed; other close failures still block cleanup.
- Jobs left active by a gateway restart become `interrupted`. Inspect surviving processes and recover manually; they are not automatically retried.
- Custom ACP launch configuration uses an exclusive `.acpxrc.json.uagc-lock` recovery file. If another writer changes the config, U.A.G.C preserves that change and the original backup instead of overwriting it.
- Avoid editing the target concurrently with apply. Git preflight reduces conflict risk; it is not a transaction against unrelated external filesystem writers or hardware failure.
- Git submodules, detached daemon containment, and real provider authentication are not covered by the fixture integration suite.

## Verification and development

```sh
npm test
npm run doctor -- --config ./agents.example.json
```

The suite covers ID traversal, atomic state updates, config validation, permissions, timeout/cancel handling, Git safety, stale results, MCP stdio calls, and real `acpx` transport with a local fake ACP worker. CI runs Node 22 and 24 on Windows and Ubuntu. See [verification notes](VERIFICATION.md) for the distinction between fixture coverage and live runtime testing.

No new framework is required: the project uses JavaScript ES modules and Node's built-in test runner.

## Troubleshooting

| Symptom | Next step |
| --- | --- |
| `Cannot find package` | Run `npm ci --ignore-scripts` in this checkout. |
| `FOUND` in doctor, worker still fails | Check the runtime's installation, authentication, adapter, and model support. |
| Unsupported permission mode | Choose an explicit mode from the table above; update v0.2.0 config. |
| Dirty source/target rejected | Review and commit or stash your changes before delegation/apply. |
| ACP workspace busy/recovery lock | Confirm all related workers have stopped; inspect the lock's original config backup and current config before manual recovery. |
| `interrupted` / `termination-uncertain` | Inspect worker processes, session logs, and the worktree before manual recovery. |
| Patch truncated | Review the full local `patchFile`; truncation only affects the displayed result. |

## License and provenance

[MIT](../LICENSE). This repository continues the user-supplied Universal Agent MCP v0.2.0 source. The initial import is preserved as small commits; v0.2.1 records the reviewed fixes and integration tests in [CHANGELOG.md](../CHANGELOG.md).
