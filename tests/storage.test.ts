import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store, now } from '../server/db.ts';

test('disk-full auto rollback retains the storage error and preserves committed work', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'emoti-storage-'));
  const store = new Store(dir);
  try {
    store.run(
      'INSERT INTO users VALUES (?, ?, NULL, NULL, 1, ?)',
      'saved-user',
      '보존할 사용자',
      now(),
    );
    const pages = Number(store.one('PRAGMA page_count')!.page_count);
    store.db.exec(`PRAGMA max_page_count = ${pages + 1}`);
    assert.throws(
      () =>
        store.transaction(() => {
          store.run(
            'INSERT INTO users VALUES (?, ?, NULL, NULL, 1, ?)',
            'oversize',
            'x'.repeat(2_000_000),
            now(),
          );
        }),
      (error: unknown) =>
        Boolean(
          typeof error === 'object' && error !== null && 'errcode' in error && error.errcode === 13,
        ),
    );
    assert.equal(
      store.one('SELECT name FROM users WHERE id = ?', 'saved-user')!.name,
      '보존할 사용자',
    );
    assert.equal(store.one('SELECT id FROM users WHERE id = ?', 'oversize'), undefined);
    assert.equal(store.db.isTransaction, false);
    assert.equal(store.one('PRAGMA integrity_check')!.integrity_check, 'ok');
  } finally {
    store.db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
