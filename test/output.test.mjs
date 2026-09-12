import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAcpNdjson } from '../src/output.mjs';

test('parses ACP assistant chunks and stop reason', () => {
  const input = [
    JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello ' } } } }),
    JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'world' } } } }),
    JSON.stringify({ jsonrpc: '2.0', id: 1, result: { stopReason: 'end_turn' } }),
  ].join('\n');

  const parsed = parseAcpNdjson(input);
  assert.equal(parsed.assistantText, 'Hello world');
  assert.equal(parsed.stopReason, 'end_turn');
});
