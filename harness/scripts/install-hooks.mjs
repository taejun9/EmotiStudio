#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { chmodSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = realpathSync(join(dirname(fileURLToPath(import.meta.url)), '../..'));
function git(...args) {
  return spawnSync('git', args, { cwd: root, encoding: 'utf8' });
}

function install() {
  if (process.env.CI && process.env.CI !== 'false') {
    console.log('Git hooks: skipped in CI; the workflow runs Git policy explicitly.');
    return;
  }
  const top = git('rev-parse', '--show-toplevel');
  if (top.error?.code === 'ENOENT' || top.status !== 0) {
    console.log('Git hooks: skipped (Git or repository metadata unavailable).');
    return;
  }
  if (realpathSync(top.stdout.trim()) !== root) {
    console.log('Git hooks: skipped (this package is an archive inside another repository).');
    return;
  }
  const existing = git('config', '--get', 'core.hooksPath');
  if (existing.status !== 0 && existing.status !== 1) throw new Error(existing.stderr.trim());
  const hookPath = existing.stdout.trim();
  if (hookPath && hookPath !== '.githooks') {
    throw new Error(
      `Existing core.hooksPath=${hookPath} was preserved. Review it before explicitly configuring .githooks.`,
    );
  }
  for (const name of ['pre-commit', 'commit-msg', 'pre-push']) {
    chmodSync(join(root, '.githooks', name), 0o755);
  }
  const configured = git('config', '--local', 'core.hooksPath', '.githooks');
  if (configured.status !== 0)
    throw new Error(configured.stderr.trim() || 'Cannot set core.hooksPath.');
  console.log('Git hooks installed: core.hooksPath=.githooks (shared by linked worktrees).');
}

try {
  install();
} catch (error) {
  console.error(`Git hooks: ${error.message}`);
  process.exitCode = 1;
}
