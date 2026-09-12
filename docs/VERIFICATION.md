# Verification notes

## Scope

U.A.G.C is tested as a local MCP gateway. A passing fixture test establishes gateway and transport behavior; it does not certify an external model, provider, or coding runtime.

The v0.2.0 input contained 29 files and 2,452 physical lines. All files were read during the initial audit. The source in Downloads was left unchanged. The imported implementation is preserved in Git history; the generated dependency lock is a separate commit.

## Automated checks

| Area | Evidence |
| --- | --- |
| Original behavior | Original tests retained, with local Git line-ending configuration |
| Job state | Traversal rejection, concurrent updates, copy isolation, disk reload, ID mismatch |
| Permissions | CLI rejects unsupported guarantees; ACP flags require explicit modes |
| Config/model selection | Input/profile/default precedence, invalid defaults, env template capability inference |
| CLI templates | Prompt contents containing placeholder-like text remain intact |
| Process handling | Timeout, cancellation, pre-aborted signals, bounded output, missing executable |
| Git isolation | Non-Git and dirty source rejected; shared mode explicitly selected |
| Patch capture | Worker commits included against the saved original base |
| Patch apply | Dirty/index state preserved; conflicts rejected; empty patch handled |
| Cleanup | Locked-worktree errors reported; ACP session closed before removal |
| Lifecycle | Cancel waits, completed jobs stay completed, actions do not overlap, restart interrupted state |
| Results | Stale patches hidden; shared diagnostics retained; output limits checked |
| Doctor | Executable discovery clearly distinguished from connection verification |
| ACP config | Exclusive lock, original restoration, external edits preserved with backup |
| MCP/ACP integration | All 12 tools exposed; stdio initialize; input rejection; CLI delegation/apply; real acpx transport; same-session resume; model forwarding; read-only denial |

Run the full suite with `npm test`. Integration fixtures create temporary repositories and a temporary ACP home. They need Node and Git but no provider credentials or model calls.

## v0.2.2 regression audit

- Local Windows / Node 24.14.0: 28 tests pass, including real acpx with a deterministic worker that exits before session creation.
- The new regression cases were also run against a temporary copy of the v0.2.1 source. They failed for all five original defects: duplicate state ownership, missing partial patches, target branch drift, absent-session cleanup and declared-but-untransmitted CLI models.
- Cross-process ownership is rejected before another gateway can alter a live job. Closing the owner permits a fresh broker to inspect interrupted jobs; abandoned locks require manual inspection.
- Timeout and cancellation retain partial changes after confirmed local termination. Uncertain termination does not capture or allow cleanup; failed jobs cannot be applied.
- Branch/HEAD drift and missing legacy target identity are rejected. Dirty targets and conflicting patches still preserve source files and index.
- Only the exact structured missing-session response from pinned acpx is tolerated during close. Permission/storage errors still propagate.
- Follow-up review cases reject releasing ownership during workspace preparation and preserve uncertain-termination classification if ACP config restoration also fails. Both tests failed before their fixes and passed afterward.
- CLI binding checks cover configuration loading, runtime-specific overrides, direct and formatted environment placeholders, and null public runtimeModel reporting.
- The beginner guide's three JSON examples were parsed; its demo configuration was exercised through actual MCP stdio discovery, delegate, result, apply and cleanup. Normal server exit released the state lock. Local documentation links were checked.
- The guide demo does not validate the Claude Desktop UI or a live Hermes/provider connection.

## Environment

Local audit and implementation checks were run on Windows with Node 24.14.0 and Git 2.53.0.windows.1. CI is configured for Node 22/24 on Ubuntu and Windows. Its status is the authority for those remote checks; configuration alone is not a claim that a run passed.

The original suite passed 10/11 with machine-level `core.autocrlf=true`. Its one failure compared LF to CRLF. The tests now set Git line-ending behavior inside their temporary repositories; they do not change user-global Git configuration.

Installed direct dependencies are locked:

- `@modelcontextprotocol/server`: 2.0.0
- `acpx`: 0.15.1
- `zod`: 4.4.3

The temporary pre-implementation installation returned zero known advisories from `npm audit` on 2026-09-12. Advisory results change over time and do not prove application security.

## Not verified

- Hermes/Qwen/OpenRouter authentication or live inference.
- End-to-end compatibility with every runtime listed in the default registry.
- Which model a remote provider actually executed.
- Real Claude Code or other desktop-client UI integration; the suite exercises the MCP wire protocol directly.
- OS sandbox containment, detached daemon termination, Git submodules, or malicious external filesystem writers.
- Crash recovery that resumes running jobs automatically; interrupted jobs require manual inspection.

## Safe migration from v0.2.0

1. Update permission values. ACP defaults to `read-only`; writing requires explicit `approve-all`. CLI jobs must select `runtime-managed`.
2. Remove `allowDirty=true` from apply calls. Review and preserve user changes before applying worker patches.
3. Start a fresh job for worktree state that lacks the saved `baseCommit`. Old patches are not silently recaptured against a new HEAD.
4. Configure a separate `stateDir` per process/client. v0.2.2 refuses a second owner via `gateway.lock`. After a crash, inspect the recorded PID and surviving workers before removing only the stale lock.
5. v0.2.2 requires both the saved source branch and base commit when applying. Older jobs lacking branch identity must be reviewed separately or replaced with a fresh job; do not fabricate migration metadata.
6. If a job is interrupted or termination is uncertain, inspect processes and worktree contents before recovery. Never blindly replay a write operation.
7. Treat doctor output as discovery. Establish readiness separately with the real runtime and its provider.

## Review policy

Worktree isolation makes changes reviewable. It does not itself authorize applying them. The caller must inspect `agent_result`, inspect full patches when display is truncated, obtain any required approval, then run the target repository's validation after apply.

An exit code of zero proves only that the worker process reported success. It is not a quality, security, or correctness assessment of the generated code.
