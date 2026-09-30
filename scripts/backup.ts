import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
const source = path.resolve(process.env.DATA_DIR || './data');
const target = path.resolve(
  process.argv[2] || `./backups/${new Date().toISOString().replaceAll(':', '-')}`,
);
if (target === source || target.startsWith(source + path.sep))
  throw new Error('Choose a backup directory outside DATA_DIR.');
if (existsSync(target)) throw new Error('Backup target already exists; choose a new directory.');
if (!existsSync(path.join(source, 'emotistudio.sqlite')))
  throw new Error('Database does not exist.');
mkdirSync(target, { recursive: true, mode: 0o700 });
const db = new DatabaseSync(path.join(source, 'emotistudio.sqlite'));
db.prepare('VACUUM INTO ?').run(path.join(target, 'emotistudio.sqlite'));
db.close();
// Pause generation/uploads before backup to ensure files and DB represent the same point in time.
if (existsSync(path.join(source, 'assets')))
  cpSync(path.join(source, 'assets'), path.join(target, 'assets'), { recursive: true });
console.log(`Backup saved to ${target}`);
