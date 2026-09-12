#!/usr/bin/env node
import { loadConfig, parseCliArgs } from '../src/config.mjs';
import { AgentBroker } from '../src/broker.mjs';

const args = parseCliArgs();
const config = await loadConfig(args.configPath);
const broker = new AgentBroker(config);


console.log(`U.A.G.C: v0.2.2`);
console.log(`Node: ${process.version}`);
console.log(`State: ${config.stateDir}`);
console.log('');
console.log('Runtimes — executable discovery only; connections and model bindings are NOT verified.');
for (const runtime of broker.listRuntimes()) {
  const caps = [
    runtime.capabilities.resume ? 'resume' : null,
    runtime.capabilities.modelSelection ? 'model' : null,
    runtime.capabilities.providerSelection ? 'provider' : null,
  ].filter(Boolean).join(',');
  console.log(`${runtime.available == null ? 'UNKNOWN' : runtime.available ? 'FOUND  ' : 'MISSING'} ${runtime.id.padEnd(12)} ${runtime.transport.padEnd(12)} caps=${caps || '-'} prerequisite=${runtime.prerequisite ?? '-'}`);
}

console.log('');
console.log(`Models (${broker.listModels().length})`);
for (const model of broker.listModels()) {
  console.log(`- ${model.id}: ${model.provider ? `${model.provider}:` : ''}${model.model}`);
}

console.log('');
console.log(`Profiles (${broker.listProfiles().length})`);
for (const profile of broker.listProfiles()) {
  if (profile.error) {
    console.log(`ERR ${profile.id}: ${profile.error}`);
  } else {
    console.log(`RESOLVED ${profile.id}: runtime=${profile.resolved.runtime} provider=${profile.resolved.provider ?? '-'} model=${profile.resolved.model ?? 'default'} runtimeModel=${profile.resolved.runtimeModel ?? 'default'}`);
  }
}
