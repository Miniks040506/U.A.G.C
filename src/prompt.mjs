export function buildImplementationPrompt({ task, plan, extraContext, role = 'implementer', execution }) {
  const roleText = role === 'implementer'
    ? 'You are the implementation worker. The architect/reviewer is another agent. Implement the requested work directly in the provided workspace.'
    : `You are the delegated ${role}. The architect/reviewer is another agent. Perform only the delegated role in the provided workspace.`;

  const sections = [
    '# Role',
    roleText,
    '',
    '# Task',
    task.trim(),
  ];

  if (execution) {
    sections.push(
      '',
      '# Execution Binding',
      `- Runtime: ${execution.runtime}`,
      `- Provider: ${execution.provider ?? 'runtime default'}`,
      `- Model: ${execution.model ?? 'runtime default'}`,
      `- Role: ${execution.role}`,
    );
  }

  if (plan?.trim()) sections.push('', '# Architect Plan', plan.trim());
  if (extraContext?.trim()) sections.push('', '# Extra Context', extraContext.trim());

  sections.push(
    '',
    '# Execution Rules',
    '- Follow the architect plan unless repository evidence makes a step impossible.',
    '- Inspect existing code before editing.',
    '- Keep changes scoped to the task.',
    '- Do not rewrite unrelated code.',
    '- Run the most relevant tests, type checks, or lint commands that are reasonably available.',
    '- Do not commit, merge, push, or change remotes.',
    '- When finished, report: files changed, commands/tests run, failures or caveats, and anything the architect should review carefully.',
  );

  return sections.join('\n');
}

export function buildResumePrompt(feedback) {
  return [
    '# Architect Review Feedback',
    feedback.trim(),
    '',
    '# Required Action',
    'Continue in the same workspace and session. Fix the issues identified by the architect, preserve correct existing work, re-run relevant validation, and return an updated implementation summary.',
  ].join('\n');
}
