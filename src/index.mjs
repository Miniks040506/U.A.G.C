#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { parseCliArgs, loadConfig } from './config.mjs';
import { AgentBroker } from './broker.mjs';
import { buildMcpServer } from './mcp-server.mjs';

const args = parseCliArgs();

if (args.help) {
  process.stderr.write(`universal-agent-mcp\n\nUsage:\n  node src/index.mjs [--config /path/to/agents.json]\n`);
  process.exit(0);
}

const config = await loadConfig(args.configPath);
const broker = new AgentBroker(config);
await broker.init();

void serveStdio(() => buildMcpServer(broker));
console.error(`[universal-agent-mcp] serving over stdio; state=${config.stateDir}`);
