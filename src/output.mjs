export function parseAcpNdjson(text) {
  const events = [];
  const assistantChunks = [];
  const toolEvents = [];
  let stopReason = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      const message = JSON.parse(line);
      events.push(message);

      if (message?.method === 'session/update') {
        const update = message.params?.update ?? message.params;
        const kind = update?.sessionUpdate;
        if (kind === 'agent_message_chunk' && update?.content?.type === 'text') {
          assistantChunks.push(update.content.text ?? '');
        }
        if (kind === 'tool_call' || kind === 'tool_call_update') {
          toolEvents.push(update);
        }
      }

      if (message?.result?.stopReason) {
        stopReason = message.result.stopReason;
      }
    } catch {
      events.push({ nonJson: line });
    }
  }

  return {
    events,
    assistantText: assistantChunks.join(''),
    toolEvents,
    stopReason,
  };
}
