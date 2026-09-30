#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HISTORICAL_COMMITS = new Set([
  '7e239884838fe842151c10f897a367d9905387ea',
  '4529e24360616549ddb1e1d7757cf19462caf72e',
]);
const PLAN = 'plan-(?!000)[0-9]{3}-[a-z0-9]+(?:-[a-z0-9]+)*';
const BRANCH = new RegExp(`^codex/(${PLAN})$`);
const PLAN_LINE = new RegExp(`^Plan: (${PLAN})$`, 'gm');
const TITLE =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9][a-z0-9._/-]*\))?!?: \S.*$/;
const ZERO = /^0+$/;

function git(...args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  }).trimEnd();
}

function optionalGit(...args) {
  try {
    return git(...args);
  } catch (error) {
    if (error.status === 1 || error.status === 128) return null;
    throw error;
  }
}

export function validateMessage(message, expectedPlan) {
  const normalized = message.replace(/\r\n/g, '\n').trimEnd();
  const [title = '', separator, ...body] = normalized.split('\n');
  if (!TITLE.test(title) || [...title].length > 100 || title !== title.trim()) {
    throw new Error(
      'Use a Conventional Commit title (max 100 characters): type(scope): description',
    );
  }
  if (separator !== '') throw new Error('Separate the commit title and body with a blank line.');
  const plans = [...body.join('\n').matchAll(PLAN_LINE)].map((match) => match[1]);
  if (plans.length !== 1)
    throw new Error('Include exactly one body line: Plan: plan-NNN-task-name');
  if (expectedPlan && plans[0] !== expectedPlan) {
    throw new Error(`Commit Plan must match the current branch: Plan: ${expectedPlan}`);
  }
  return plans[0];
}

function currentPlan() {
  const branch = git('branch', '--show-current');
  const match = BRANCH.exec(branch);
  if (!match)
    throw new Error(
      'Commits require branch codex/plan-NNN-task-name; main/detached HEAD are blocked.',
    );
  const gitDir = resolve(git('rev-parse', '--absolute-git-dir'));
  const commonDir = resolve(git('rev-parse', '--path-format=absolute', '--git-common-dir'));
  if (gitDir === commonDir) throw new Error('Commits require a linked Git worktree.');
  return match[1];
}

function verifyPlanAt(ref, plan) {
  const paths = ['active', 'completed'].map((state) => ({
    state,
    path: `docs/exec_plans/${state}/${plan}.md`,
  }));
  const found = paths.filter(
    ({ path }) => optionalGit('cat-file', '-e', `${ref}:${path}`) !== null,
  );
  if (found.length !== 1)
    throw new Error(`${ref}: exactly one tracked active or completed plan is required: ${plan}`);
  const { state, path } = found[0];
  const body = git('show', `${ref}:${path}`);
  if (
    !body.startsWith(`# ${plan}\n`) ||
    !new RegExp(`^## Status\\s*\\n+${state}\\s*$`, 'm').test(body)
  ) {
    throw new Error(`${ref}: plan title/status must match ${path}`);
  }
  if (state === 'completed') {
    const review = `docs/reviews/${plan}.md`;
    if (optionalGit('cat-file', '-e', `${ref}:${review}`) === null) {
      throw new Error(`${ref}: completed plan requires a tracked review: ${review}`);
    }
  }
}

function preCommit() {
  const plan = currentPlan();
  const tree = git('write-tree');
  verifyPlanAt(tree, plan);
  git('diff', '--cached', '--check');
  // Validate exactly what will be committed, including staged Markdown links and reviews.
  const snapshot = mkdtempSync(join(tmpdir(), 'emoti-staged-'));
  try {
    git('checkout-index', '--all', `--prefix=${snapshot}/`);
    execFileSync(
      'python3',
      ['-B', join(snapshot, 'harness/scripts/verify_base.py'), '--root', snapshot],
      {
        stdio: 'inherit',
      },
    );
  } finally {
    rmSync(snapshot, { recursive: true, force: true });
  }
}

function resolveCommit(ref) {
  return git('rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`);
}

function checkCommits(commits) {
  for (const commit of commits.filter(Boolean)) {
    if (HISTORICAL_COMMITS.has(commit)) continue;
    const plan = validateMessage(git('show', '-s', '--format=%B', commit));
    verifyPlanAt(commit, plan);
  }
  console.log(`Git policy passed (${commits.filter(Boolean).length} commit(s) inspected).`);
}

function range(base, head) {
  if (!base || !head) throw new Error('Usage: git-policy.mjs range <base> <head>');
  const baseCommit = resolveCommit(base);
  const headCommit = resolveCommit(head);
  checkCommits(git('rev-list', '--reverse', `${baseCommit}..${headCommit}`).split('\n'));
}

function prePush(input) {
  for (const line of input.trim().split('\n').filter(Boolean)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 4) throw new Error('Invalid pre-push input from Git.');
    const [, localOid, remoteRef, remoteOid] = fields;
    if (![localOid, remoteOid].every((oid) => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(oid))) {
      throw new Error('Invalid object ID in pre-push input.');
    }
    if (remoteRef === 'refs/heads/main')
      throw new Error(
        'Direct pushes to main are blocked, including deletion. Push a task branch and merge its PR.',
      );
    if (ZERO.test(localOid)) continue; // Deleting a task branch does not introduce commits.
    const head = resolveCommit(localOid);
    let commits;
    if (ZERO.test(remoteOid)) {
      // Inspect full ancestry for a new remote ref; another local remote-tracking ref must not hide commits.
      commits = git('rev-list', '--reverse', head);
    } else {
      let base;
      try {
        base = resolveCommit(remoteOid);
      } catch {
        throw new Error(
          'Remote commit is unavailable locally. Fetch the remote, then retry the push.',
        );
      }
      commits = git('rev-list', '--reverse', `${base}..${head}`);
    }
    checkCommits(commits.split('\n'));
  }
}

export function main(args) {
  const [command, ...rest] = args;
  switch (command) {
    case 'pre-commit':
      return preCommit();
    case 'commit-msg': {
      if (rest.length !== 1) throw new Error('Usage: git-policy.mjs commit-msg <message-file>');
      const plan = validateMessage(readFileSync(rest[0], 'utf8'), currentPlan());
      return verifyPlanAt(git('write-tree'), plan);
    }
    case 'pre-push':
      return prePush(readFileSync(0, 'utf8'));
    case 'range':
      return range(...rest);
    default:
      throw new Error(
        'Usage: git-policy.mjs <pre-commit|commit-msg <file>|pre-push|range <base> <head>>',
      );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`Git policy: ${error.message}`);
    process.exitCode = 1;
  }
}
