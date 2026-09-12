import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

// Deterministic ACP fixture: no network, credentials or model invocation.
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
const modelId = 'audit-provider:audit-model';
const models = { availableModels: [{ modelId, name: 'Audit model' }], currentModelId: modelId };
let pending;
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  fs.appendFileSync(process.env.UAGC_FAKE_LOG, JSON.stringify(message) + '\n');
  if (message.id === 'permission' && !message.method) {
    const allowed = message.result?.outcome?.outcome === 'selected' && message.result.outcome.optionId === 'allow';
    let text = 'Permission denied';
    if (allowed) {
      const output = path.join(process.cwd(), 'acp-output.txt');
      text = fs.existsSync(output) ? 'resumed' : 'implemented';
      fs.writeFileSync(output, text + '\n');
    }
    send({ method: 'session/update', params: { sessionId: 'audit-session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } } });
    send({ id: pending, result: { stopReason: 'end_turn' } });
    return;
  }
  let result = {};
  if (message.method === 'initialize') result = { protocolVersion: 1, agentCapabilities: { loadSession: true }, agentInfo: { name: 'uagc-fixture', version: '1.0.0' }, authMethods: [] };
  if (message.method === 'session/new') result = { sessionId: 'audit-session', models };
  if (message.method === 'session/load') result = { models };
  if (message.method === 'session/prompt') {
    pending = message.id;
    send({ id: 'permission', method: 'session/request_permission', params: {
      sessionId: 'audit-session', toolCall: { toolCallId: 'write-output', title: 'Write fixture output', kind: 'edit' },
      options: [{ optionId: 'allow', name: 'Allow once', kind: 'allow_once' }, { optionId: 'deny', name: 'Deny', kind: 'reject_once' }],
    } });
    return;
  }
  if (message.id !== undefined) send({ id: message.id, result });
});
