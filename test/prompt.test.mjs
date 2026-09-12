import test from 'node:test';
import assert from 'node:assert/strict';
import { buildImplementationPrompt, buildResumePrompt } from '../src/prompt.mjs';

test('implementation prompt carries task, plan, and execution contract', () => {
  const prompt = buildImplementationPrompt({
    task: 'Implement auth',
    plan: '1. Add service\n2. Add middleware',
    extraContext: 'Use existing JWT dependency',
  });
  assert.match(prompt, /Implement auth/);
  assert.match(prompt, /Add service/);
  assert.match(prompt, /Use existing JWT dependency/);
  assert.match(prompt, /Do not commit/);
});

test('resume prompt frames architect feedback as corrective work', () => {
  const prompt = buildResumePrompt('Middleware violates layering.');
  assert.match(prompt, /Middleware violates layering/);
  assert.match(prompt, /Continue in the same workspace and session/);
});
