"""Exercise quality gate failures in disposable copies, never the working tree."""

import importlib.util
from pathlib import Path
import shutil
import tempfile
import unittest

REPOSITORY = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('verify_base', REPOSITORY / 'harness/scripts/verify_base.py')
VERIFY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VERIFY)


class BaseGateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='emoti-base-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in ('AGENTS.md', 'README.md', '.gitignore'):
            shutil.copy2(REPOSITORY / name, self.root / name)
        for name in ('docs', 'harness'):
            shutil.copytree(REPOSITORY / name, self.root / name, ignore=shutil.ignore_patterns('__pycache__'))
        # Use a predictable active plan; the real repo may be active or completed.
        for folder in ('docs/exec_plans/active', 'docs/exec_plans/completed', 'docs/reviews'):
            for plan in (self.root / folder).glob('plan-*.md'):
                plan.unlink()
        self.plan = self.root / 'docs/exec_plans/active/plan-001-fixture.md'
        template = (self.root / 'harness/templates/exec-plan.md').read_text()
        self.plan.write_text(template.replace('plan-NNN-task-name', 'plan-001-fixture'))

    def assert_failure(self, fragment):
        self.assertTrue(any(fragment in error for error in VERIFY.verify(self.root)), fragment)

    def test_valid_structure(self):
        self.assertEqual(VERIFY.verify(self.root), [])

    def test_missing_document(self):
        (self.root / 'docs/product/product.md').unlink()
        self.assert_failure('Missing file: docs/product/product.md')

    def test_forbidden_plan_directory(self):
        (self.root / 'docs/plan').mkdir()
        self.assert_failure('Forbidden path')

    def test_extra_root_markdown(self):
        (self.root / 'NOTES.md').write_text('notes')
        self.assert_failure('Unexpected root Markdown')

    def test_invalid_plan_name(self):
        self.plan.rename(self.plan.with_name('plan-1-fixture.md'))
        self.assert_failure('Invalid plan path')

    def test_duplicate_plan_number(self):
        other = self.plan.with_name('plan-001-other.md')
        other.write_text(self.plan.read_text().replace('plan-001-fixture', 'plan-001-other'))
        self.assert_failure('Duplicate plan number')

    def test_completed_plan_requires_review(self):
        target = self.root / 'docs/exec_plans/completed' / self.plan.name
        self.plan.rename(target)
        target.write_text(target.read_text().replace('\nactive\n', '\ncompleted\n'))
        self.assert_failure('Missing completion review')
        template = (self.root / 'harness/templates/review.md').read_text()
        (self.root / 'docs/reviews' / target.name).write_text(template)
        self.assertEqual(VERIFY.verify(self.root), [])

    def test_status_matches_directory(self):
        self.plan.write_text(self.plan.read_text().replace('\nactive\n', '\ncompleted\n'))
        self.assert_failure('Plan status must be active')

    def test_broken_local_link(self):
        with (self.root / 'AGENTS.md').open('a') as file:
            file.write('\n[missing](docs/missing.md)\n')
        self.assert_failure('Broken local link')

    def test_implementation_requires_git(self):
        errors = VERIFY.verify(self.root, implementation=True)
        self.assertTrue(any('Git state' in error for error in errors))


if __name__ == '__main__':
    unittest.main()
