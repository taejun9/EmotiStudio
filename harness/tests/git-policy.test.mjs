import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { validateMessage } from '../scripts/git-policy.mjs';

const REPOSITORY = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PLAN = 'plan-001-fixture';
const MESSAGE = `fix(harness): validate commit rules\n\nPlan: ${PLAN}`;
const ENV = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
);
Object.assign(ENV, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', CI: 'false' });

function run(cwd, executable, args, options = {}) {
  return spawnSync(executable, args, { cwd, encoding: 'utf8', env: ENV, ...options });
}
function ok(result) {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}
function fail(result, pattern) {
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(`${result.stdout}\n${result.stderr}`, pattern);
}
function write(root, path, body) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), body);
}
function git(cwd, ...args) {
  return run(cwd, 'git', args);
}
function policy(cwd, ...args) {
  return run(cwd, process.execPath, ['harness/scripts/git-policy.mjs', ...args]);
}
function install(cwd, options) {
  return run(cwd, process.execPath, ['harness/scripts/install-hooks.mjs'], options);
}

// Use the verifier's required layout to build a small, independent repository;
// repository documentation can evolve without adding unrelated fixture links.
const layout = JSON.parse(
  ok(
    run(REPOSITORY, 'python3', [
      '-B',
      '-c',
      'import importlib.util,json; s=importlib.util.spec_from_file_location("base", "harness/scripts/verify_base.py"); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(json.dumps({"directories":m.DIRECTORIES,"files":m.FILES}))',
    ]),
  ),
);
const planBody = readFileSync(
  join(REPOSITORY, 'harness/templates/exec-plan.md'),
  'utf8',
).replaceAll('plan-NNN-task-name', PLAN);
const reviewBody = readFileSync(join(REPOSITORY, 'harness/templates/review.md'), 'utf8').replaceAll(
  'plan-NNN-task-name',
  PLAN,
);

function fixture(t, { hooks = true } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'emoti-git-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const primary = join(directory, 'primary');
  const worktree = join(directory, 'task');
  mkdirSync(primary);
  for (const path of layout.directories) write(primary, `${path}/.gitkeep`, '');
  for (const path of layout.files) write(primary, path, '');
  write(primary, `docs/exec_plans/active/${PLAN}.md`, planBody);
  for (const path of [
    'harness/scripts/verify_base.py',
    'harness/scripts/git-policy.mjs',
    'harness/scripts/install-hooks.mjs',
    '.githooks/pre-commit',
    '.githooks/commit-msg',
    '.githooks/pre-push',
  ]) {
    mkdirSync(dirname(join(primary, path)), { recursive: true });
    copyFileSync(join(REPOSITORY, path), join(primary, path));
    if (path.startsWith('.githooks/')) chmodSync(join(primary, path), 0o755);
  }
  ok(git(primary, 'init', '--initial-branch=main'));
  ok(git(primary, 'config', 'user.name', 'Git Policy Test'));
  ok(git(primary, 'config', 'user.email', 'git-policy@example.invalid'));
  ok(git(primary, 'config', 'commit.gpgSign', 'false'));
  ok(git(primary, 'add', '.'));
  ok(git(primary, 'commit', '-m', `chore: initialize fixture\n\nPlan: ${PLAN}`));
  const base = ok(git(primary, 'rev-parse', 'HEAD'));
  ok(git(primary, 'worktree', 'add', '-b', `codex/${PLAN}`, worktree));
  if (hooks) ok(install(worktree));
  return { directory, primary, worktree, base };
}
function stageChange(worktree) {
  write(worktree, 'fixture.txt', 'staged change\n');
  ok(git(worktree, 'add', 'fixture.txt'));
}

test('message requires conventional title, bounded length and exactly one matching Plan body', () => {
  assert.equal(validateMessage(MESSAGE, PLAN), PLAN);
  assert.equal(validateMessage(`feat!: support Korean 설명\r\n\r\nPlan: ${PLAN}\r\n`), PLAN);
  for (const message of [
    'plain title',
    `Merge branch task\n\nPlan: ${PLAN}`,
    `fix: ${'x'.repeat(96)}\n\nPlan: ${PLAN}`,
    `fix: \n\nPlan: ${PLAN}`,
    `fix: description\nPlan: ${PLAN}`,
    `fix: description\n\nPlan: ${PLAN}\nPlan: ${PLAN}`,
    'fix: description\n\nPlan: plan-000-fixture',
  ]) {
    assert.throws(() => validateMessage(message));
  }
  assert.throws(() => validateMessage(MESSAGE, 'plan-002-other'), /match the current branch/);
});

test('installer activates executable hooks through a shared relative path; valid linked-worktree commit succeeds', (t) => {
  const { primary, worktree } = fixture(t);
  assert.equal(ok(git(primary, 'config', '--get', 'core.hooksPath')), '.githooks');
  stageChange(worktree);
  ok(git(worktree, 'commit', '-m', MESSAGE));
  assert.equal(ok(git(worktree, 'status', '--porcelain')), '');
});

test('actual commits on main, primary checkout and detached HEAD are blocked', (t) => {
  const { primary, worktree } = fixture(t);
  stageChange(primary);
  fail(git(primary, 'commit', '-m', MESSAGE), /main\/detached HEAD are blocked/);
  ok(git(primary, 'switch', '-c', 'codex/plan-002-primary'));
  fail(git(primary, 'commit', '-m', MESSAGE), /linked Git worktree/);
  ok(git(worktree, 'switch', '--detach'));
  stageChange(worktree);
  fail(git(worktree, 'commit', '-m', MESSAGE), /main\/detached HEAD are blocked/);
});

test('commit-msg rejects invalid title, missing Plan, mismatched Plan and misleading merge title', (t) => {
  const { worktree } = fixture(t);
  stageChange(worktree);
  fail(git(worktree, 'commit', '-m', `not conventional\n\nPlan: ${PLAN}`), /Conventional Commit/);
  fail(git(worktree, 'commit', '-m', 'fix: missing plan'), /blank line|Plan:/);
  fail(
    git(worktree, 'commit', '-m', 'fix: wrong plan\n\nPlan: plan-002-other'),
    /match the current branch/,
  );
  fail(git(worktree, 'commit', '-m', `Merge branch task\n\nPlan: ${PLAN}`), /Conventional Commit/);
});

test('an unstaged plan cannot satisfy pre-commit', (t) => {
  const { worktree } = fixture(t);
  ok(git(worktree, 'rm', '--cached', `docs/exec_plans/active/${PLAN}.md`));
  assert.ok(existsSync(join(worktree, `docs/exec_plans/active/${PLAN}.md`)));
  fail(git(worktree, 'commit', '-m', MESSAGE), /tracked active or completed plan/);
});

test('staged plan sections are checked even when the working copy is repaired', (t) => {
  const { worktree } = fixture(t);
  const path = `docs/exec_plans/active/${PLAN}.md`;
  write(worktree, path, planBody.replace('## Owner', '## Removed'));
  ok(git(worktree, 'add', path));
  write(worktree, path, planBody);
  fail(git(worktree, 'commit', '-m', MESSAGE), /missing section Owner/);
});

test('the complete staged snapshot is used for documentation link checks', (t) => {
  const { worktree } = fixture(t);
  write(worktree, 'README.md', '[missing](missing-document.md)\n');
  ok(git(worktree, 'add', 'README.md'));
  write(worktree, 'README.md', 'fixed only in the working tree\n');
  fail(git(worktree, 'commit', '-m', MESSAGE), /Broken local link/);
});

test('completion requires a staged review and permits a correctly completed plan', (t) => {
  const { worktree } = fixture(t);
  const active = `docs/exec_plans/active/${PLAN}.md`;
  const completed = `docs/exec_plans/completed/${PLAN}.md`;
  renameSync(join(worktree, active), join(worktree, completed));
  write(worktree, completed, planBody.replace('\nactive\n', '\ncompleted\n'));
  ok(git(worktree, 'add', 'docs/exec_plans'));
  write(worktree, `docs/reviews/${PLAN}.md`, reviewBody);
  fail(git(worktree, 'commit', '-m', MESSAGE), /tracked review/);
  ok(git(worktree, 'add', 'docs/reviews'));
  ok(git(worktree, 'commit', '-m', MESSAGE));
});

test('range validation detects bypassed hooks and validates the plan in each committed tree', (t) => {
  const { worktree, base } = fixture(t);
  stageChange(worktree);
  ok(git(worktree, 'commit', '-m', MESSAGE));
  ok(policy(worktree, 'range', base, 'HEAD'));
  ok(
    git(
      worktree,
      '-c',
      'core.hooksPath=/dev/null',
      'commit',
      '--allow-empty',
      '-m',
      'Initial commit',
    ),
  );
  fail(policy(worktree, 'range', base, 'HEAD'), /Conventional Commit/);
  fail(policy(worktree, 'range', '--all', 'HEAD'), /Git policy:/);
});

test('range rejects a commit whose Plan file was never tracked', (t) => {
  const { worktree, base } = fixture(t);
  ok(git(worktree, 'rm', `docs/exec_plans/active/${PLAN}.md`));
  ok(git(worktree, '-c', 'core.hooksPath=/dev/null', 'commit', '-m', MESSAGE));
  fail(policy(worktree, 'range', base, 'HEAD'), /tracked active or completed plan/);
});

test('real pushes validate new branches, block direct main updates, and allow branch deletion', (t) => {
  const { directory, worktree } = fixture(t);
  const remote = join(directory, 'remote.git');
  ok(git(worktree, 'init', '--bare', remote));
  ok(git(worktree, 'remote', 'add', 'origin', remote));
  stageChange(worktree);
  ok(git(worktree, 'commit', '-m', MESSAGE));
  ok(git(worktree, 'push', 'origin', `HEAD:refs/heads/codex/${PLAN}`));
  fail(
    git(worktree, 'push', 'origin', 'HEAD:refs/heads/main'),
    /Direct pushes to main are blocked/,
  );
  ok(git(worktree, '-c', 'core.hooksPath=/dev/null', 'push', 'origin', 'HEAD:refs/heads/main'));
  fail(git(worktree, 'push', 'origin', '--delete', 'main'), /including deletion/);
  ok(git(worktree, 'push', 'origin', '--delete', `codex/${PLAN}`));
  ok(
    git(
      worktree,
      '-c',
      'core.hooksPath=/dev/null',
      'commit',
      '--allow-empty',
      '-m',
      'invalid bypass',
    ),
  );
  fail(git(worktree, 'push', 'origin', `HEAD:refs/heads/codex/${PLAN}`), /Conventional Commit/);
});

test('pre-push fails safely when the remote base has not been fetched', (t) => {
  const { worktree } = fixture(t);
  const head = ok(git(worktree, 'rev-parse', 'HEAD'));
  fail(
    run(worktree, process.execPath, ['harness/scripts/git-policy.mjs', 'pre-push'], {
      input: `refs/heads/codex/${PLAN} ${head} refs/heads/codex/${PLAN} ${'f'.repeat(40)}\n`,
    }),
    /Fetch the remote/,
  );
});

test('installer preserves a custom hook path and skips CI or archive environments', (t) => {
  const { directory, worktree } = fixture(t, { hooks: false });
  ok(git(worktree, 'config', 'core.hooksPath', 'custom-hooks'));
  fail(install(worktree), /was preserved/);
  assert.equal(ok(git(worktree, 'config', '--get', 'core.hooksPath')), 'custom-hooks');
  ok(install(worktree, { env: { ...ENV, CI: 'true' } }));
  assert.equal(ok(git(worktree, 'config', '--get', 'core.hooksPath')), 'custom-hooks');
  const archive = join(directory, 'archive');
  mkdirSync(join(archive, 'harness/scripts'), { recursive: true });
  copyFileSync(
    join(REPOSITORY, 'harness/scripts/install-hooks.mjs'),
    join(archive, 'harness/scripts/install-hooks.mjs'),
  );
  assert.match(ok(install(archive)), /skipped/);
});
