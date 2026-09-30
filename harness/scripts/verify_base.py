#!/usr/bin/env python3
"""Validate the repository base without packages, network access, or writes."""

from __future__ import annotations

import argparse
from pathlib import Path
import re
import subprocess
from urllib.parse import unquote, urlsplit

DIRECTORIES = (
    'docs/architecture', 'docs/product', 'docs/quality', 'docs/privacy',
    'docs/references', 'docs/exec_plans/active', 'docs/exec_plans/completed',
    'docs/meetings', 'docs/reviews', 'harness/scripts', 'harness/templates',
)
FILES = (
    'AGENTS.md', 'README.md', '.gitignore',
    'docs/product/product.md', 'docs/product/roadmap.md',
    'docs/architecture/harness.md', 'docs/architecture/system.md',
    'docs/architecture/domain-model.md', 'docs/architecture/platform-presets.md',
    'docs/quality/rules.md', 'docs/privacy/principles.md',
    'docs/references/official-sources.md', 'docs/references/kakao-static-evidence.md',
    'docs/meetings/index.md',
    'harness/scripts/verify_base.py', 'harness/tests/test_verify_base.py',
    'harness/templates/exec-plan.md', 'harness/templates/review.md',
    'harness/templates/meeting.md',
)
PLAN_NAME = re.compile(r'plan-(\d{3})-[a-z0-9]+(?:-[a-z0-9]+)*\.md')
PLAN_SECTIONS = (
    'Status', 'Owner', 'User Request', 'Goal', 'Non-Goals', 'Context Map',
    'Constraints', 'Implementation Plan', 'QA Plan', 'Review Plan',
    'Decision Log', 'Progress Log', 'Completion Notes',
)
REVIEW_SECTIONS = ('Summary', 'QA', 'Findings', 'Residual Risk', 'Follow-Ups')


def verify(root: Path, implementation: bool = False) -> list[str]:
    errors: list[str] = []
    if not root.is_dir():
        return [f'Repository directory not found: {root}']
    for name in DIRECTORIES:
        if not (root / name).is_dir():
            errors.append(f'Missing directory: {name}')
    for name in FILES:
        if not (root / name).is_file():
            errors.append(f'Missing file: {name}')
    if (root / 'docs/plan').exists():
        errors.append('Forbidden path: docs/plan')
    for path in root.iterdir():
        if path.suffix.lower() == '.md' and path.name not in ('AGENTS.md', 'README.md'):
            errors.append(f'Unexpected root Markdown: {path.name}')

    def read(path: Path) -> str:
        try:
            return path.read_text(encoding='utf-8')
        except (OSError, UnicodeError) as exc:
            errors.append(f'Cannot read {path.relative_to(root)}: {exc}')
            return ''

    def check_sections(path: Path, body: str, required: tuple[str, ...]) -> None:
        headings = set(re.findall(r'^## (.+)$', body, re.MULTILINE))
        for section in required:
            if section not in headings:
                errors.append(f'{path.relative_to(root)}: missing section {section}')

    plans: dict[str, Path] = {}
    completed: set[str] = set()
    for state in ('active', 'completed'):
        folder = root / 'docs/exec_plans' / state
        for path in sorted(folder.rglob('*')):
            if path.name == '.gitkeep' and path.parent == folder:
                continue
            match = PLAN_NAME.fullmatch(path.name)
            if path.parent != folder or not path.is_file() or not match:
                errors.append(f'Invalid plan path: {path.relative_to(root)}')
                continue
            number = match.group(1)
            if number == '000':
                errors.append(f'Plan number must start at 001: {path.name}')
            if number in plans:
                errors.append(f'Duplicate plan number: {number}')
            plans[number] = path
            body = read(path)
            if not body.startswith(f'# {path.stem}\n'):
                errors.append(f'Plan title does not match filename: {path.name}')
            check_sections(path, body, PLAN_SECTIONS)
            status = re.search(r'^## Status\s*\n+([^\n]+)', body, re.MULTILINE)
            if not status or status.group(1).strip() != state:
                errors.append(f'Plan status must be {state}: {path.name}')
            if state == 'completed':
                completed.add(path.name)
                review = root / 'docs/reviews' / path.name
                if not review.is_file():
                    errors.append(f'Missing completion review: {path.name}')
                else:
                    check_sections(review, read(review), REVIEW_SECTIONS)
    for path in (root / 'docs/reviews').glob('plan-*.md'):
        if path.name not in completed:
            errors.append(f'Review has no completed plan: {path.name}')

    markdown = [root / 'AGENTS.md', root / 'README.md']
    markdown += list((root / 'docs').rglob('*.md'))
    markdown += list((root / 'harness').rglob('*.md'))
    for path in sorted(markdown):
        if not path.is_file():
            continue
        # This intentionally checks inline file links, not a full Markdown grammar.
        body = re.sub(r'```.*?```', '', read(path), flags=re.DOTALL)
        for link in re.findall(r'\[[^\]]*\]\(([^\s)]+)\)', body):
            target = link.strip('<>')
            parts = urlsplit(target)
            if parts.scheme or parts.netloc or not parts.path:
                continue
            file_path = path.parent / unquote(parts.path)
            if not file_path.exists():
                errors.append(f'Broken local link in {path.relative_to(root)}: {target}')

    if implementation:
        def git(*args: str) -> str:
            result = subprocess.run(
                ['git', '-C', str(root), *args], capture_output=True, text=True, check=True,
            )
            return result.stdout.strip()
        try:
            branch = git('branch', '--show-current')
            plan_name = branch.removeprefix('codex/') + '.md'
            if not branch.startswith('codex/') or not PLAN_NAME.fullmatch(plan_name):
                errors.append('Implementation requires branch codex/plan-NNN-<task>')
            elif not (root / 'docs/exec_plans/active' / plan_name).is_file():
                errors.append(f'Branch has no matching active plan: {branch}')
            git_dir = Path(git('rev-parse', '--absolute-git-dir')).resolve()
            common = Path(git('rev-parse', '--path-format=absolute', '--git-common-dir')).resolve()
            if git_dir == common:
                errors.append('Implementation requires a linked worktree')
        except (OSError, subprocess.CalledProcessError) as exc:
            errors.append(f'Cannot verify implementation Git state: {exc}')
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument('--implementation', action='store_true')
    args = parser.parse_args()
    errors = verify(args.root.resolve(), args.implementation)
    for error in errors:
        print(f'FAIL: {error}')
    if errors:
        print(f'Base verification failed: {len(errors)} issue(s)')
        return 1
    print('Base verification passed' + (' (implementation state included)' if args.implementation else ''))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
