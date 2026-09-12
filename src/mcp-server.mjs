import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

function asToolResult(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function asError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

const executionSelectorSchema = {
  profile: z.string().min(1).optional().describe('Optional execution profile such as qwen-hermes. Profiles pre-bind a coding runtime and model/provider.'),
  runtime: z.string().min(1).optional().describe('Coding-agent runtime, e.g. hermes, codex, opencode. If the user says "Qwen through Hermes", runtime is hermes.'),
  agent: z.string().min(1).optional().describe('Deprecated V0.1 alias for runtime. Prefer runtime.'),
  provider: z.string().min(1).optional().describe('Inference provider for the worker model, e.g. openrouter. Only use when the selected runtime supports per-job provider selection.'),
  model: z.string().min(1).optional().describe('Model alias from model_list or a raw model id. If the user says "Qwen through Hermes", model is qwen and runtime is hermes.'),
  role: z.enum(['implementer', 'reviewer', 'researcher']).optional().describe('Delegated worker role. For architect -> coder workflows use implementer.'),
  strictModelBinding: z.boolean().optional().describe('Fail instead of silently falling back if the requested provider/model cannot be bound by the runtime. Defaults to true.'),
};

export function buildMcpServer(broker) {
  const server = new McpServer(
    { name: 'universal-agent-mcp', version: '0.2.2' },
    {
      instructions: [
        'Use this server when you are the architect/reviewer and want an external coding agent runtime to execute implementation.',
        'V0.2 separates runtime from model. Runtime means the coding agent that edits/runs code (Hermes, Codex, OpenCode). Model means the LLM used inside that runtime (for example Qwen through Hermes).',
        'If the user says "plan/design yourself, then use Qwen through Hermes to implement", you should plan first, then call agent_delegate with runtime="hermes", model="qwen" (and provider="openrouter" only if not already encoded by the qwen alias/profile), review agent_result, use agent_resume for corrections, and agent_apply only after approval.',
        'Use runtime_list, model_list, and profile_list to discover available bindings. execution_resolve can dry-run a requested combination before delegation.',
        'Prefer workspaceMode=worktree for implementation so external worker changes remain reviewable before applying.',
      ].join(' '),
    },
  );

  server.registerTool(
    'runtime_list',
    {
      title: 'List coding runtimes',
      description: 'List coding-agent runtimes configured for this gateway, availability, and whether they support per-job model/provider selection.',
      inputSchema: z.object({}),
    },
    async () => asToolResult({ runtimes: broker.listRuntimes() }),
  );

  server.registerTool(
    'agent_list',
    {
      title: 'List coding agents (legacy)',
      description: 'Backward-compatible alias of runtime_list. In V0.2 call these coding runtimes to distinguish them from the worker model.',
      inputSchema: z.object({}),
    },
    async () => asToolResult({ agents: broker.listAgents() }),
  );

  server.registerTool(
    'model_list',
    {
      title: 'List worker model aliases',
      description: 'List configured model aliases and providers. These are models that can be bound to compatible coding runtimes; they are not coding agents by themselves.',
      inputSchema: z.object({}),
    },
    async () => asToolResult({ models: broker.listModels() }),
  );

  server.registerTool(
    'profile_list',
    {
      title: 'List execution profiles',
      description: 'List named runtime+model bindings such as qwen-hermes. Profiles are the safest concise way to request a known worker combination.',
      inputSchema: z.object({}),
    },
    async () => asToolResult({ profiles: broker.listProfiles() }),
  );

  server.registerTool(
    'execution_resolve',
    {
      title: 'Resolve runtime/model binding',
      description: 'Dry-run how a runtime/profile/provider/model request resolves. Use this when model/runtime wording is ambiguous or before a new binding is delegated.',
      inputSchema: z.object(executionSelectorSchema),
    },
    async (args) => {
      try { return asToolResult(broker.resolve(args)); } catch (error) { return asError(error); }
    },
  );

  server.registerTool(
    'agent_delegate',
    {
      title: 'Delegate implementation to coding runtime',
      description: 'Start a coding-runtime job from an architect task/plan. Runtime and model are separate: e.g. runtime="hermes", model="qwen" means Qwen is used inside Hermes. Returns immediately with a job id.',
      inputSchema: z.object({
        ...executionSelectorSchema,
        cwd: z.string().min(1).describe('Project directory the worker should operate in.'),
        task: z.string().min(1),
        plan: z.string().optional().describe('Detailed architect plan the coding runtime must implement.'),
        extraContext: z.string().optional(),
        workspaceMode: z.enum(['worktree', 'shared']).optional(),
        permissions: z.enum(['read-only', 'approve-all', 'runtime-managed']).optional().describe('ACP: read-only or explicit approve-all. CLI: runtime-managed; the gateway cannot enforce CLI permissions.'),
        timeoutSeconds: z.number().int().min(10).max(21600).optional(),
      }),
    },
    async (args) => {
      try { return asToolResult(await broker.delegate(args)); } catch (error) { return asError(error); }
    },
  );

  server.registerTool(
    'agent_status',
    {
      title: 'Get delegated job status',
      description: 'Get job state, resolved runtime/model binding, and recent diagnostics.',
      inputSchema: z.object({ jobId: z.string().min(1) }),
    },
    async ({ jobId }) => {
      try { return asToolResult(await broker.status(jobId)); } catch (error) { return asError(error); }
    },
  );

  server.registerTool(
    'agent_result',
    {
      title: 'Get coding-runtime result',
      description: 'Return worker summary plus resolved runtime/model, changed files, and reviewable git patch. Call this before applying changes.',
      inputSchema: z.object({
        jobId: z.string().min(1),
        includeDiff: z.boolean().default(true),
        maxDiffChars: z.number().int().min(1000).max(1000000).optional(),
      }),
    },
    async ({ jobId, includeDiff, maxDiffChars }) => {
      try { return asToolResult(await broker.result(jobId, { includeDiff, maxDiffChars })); } catch (error) { return asError(error); }
    },
  );

  server.registerTool(
    'agent_resume',
    {
      title: 'Send architect review feedback',
      description: 'Resume the same ACP coding-runtime session with architect review feedback. The original runtime/model binding is preserved.',
      inputSchema: z.object({
        jobId: z.string().min(1),
        feedback: z.string().min(1),
      }),
    },
    async ({ jobId, feedback }) => {
      try { return asToolResult(await broker.resume(jobId, feedback)); } catch (error) { return asError(error); }
    },
  );

  server.registerTool(
    'agent_cancel',
    {
      title: 'Cancel delegated job',
      description: 'Cooperatively cancel the active ACP turn where available and abort the local worker process.',
      inputSchema: z.object({ jobId: z.string().min(1) }),
    },
    async ({ jobId }) => {
      try { return asToolResult(await broker.cancel(jobId)); } catch (error) { return asError(error); }
    },
  );

  server.registerTool(
    'agent_apply',
    {
      title: 'Apply reviewed worker patch',
      description: 'Apply a completed isolated-worktree patch back to the original repository. By default refuses a dirty target tree.',
      inputSchema: z.object({
        jobId: z.string().min(1),
        allowDirty: z.boolean().default(false),
      }),
    },
    async ({ jobId, allowDirty }) => {
      try { return asToolResult(await broker.apply(jobId, allowDirty)); } catch (error) { return asError(error); }
    },
  );

  server.registerTool(
    'agent_cleanup',
    {
      title: 'Clean delegated worktree',
      description: 'Remove the isolated git worktree and its temporary branch after review/apply is complete.',
      inputSchema: z.object({
        jobId: z.string().min(1),
        deleteBranch: z.boolean().default(true),
      }),
    },
    async ({ jobId, deleteBranch }) => {
      try { return asToolResult(await broker.cleanup(jobId, deleteBranch)); } catch (error) { return asError(error); }
    },
  );

  return server;
}
