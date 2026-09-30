import { readFileSync } from 'node:fs';
import { validateMessage } from './git-policy.mjs';

// Read event JSON as data; never interpolate PR text into a shell command.
if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
  const { pull_request: pr } = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const plan = pr.head.ref.replace(/^codex\//, '');
  validateMessage(`${pr.title}\n\n${pr.body ?? ''}`, plan);
  console.log('PR title and Plan footer passed.');
}
