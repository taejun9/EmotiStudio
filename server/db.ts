import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ACTION_SUGGESTIONS } from '../shared/types.ts';
import type {
  Activity,
  CharacterConcept,
  ConceptDetail,
  FrameAnimation,
  Direction,
  GenerationJob,
  MotionPreset,
  Project,
  ProjectDetail,
  Provider,
  Sticker,
  StickerVersion,
  User,
} from '../shared/types.ts';

export type Row = Record<string, any>;
export const inferBuiltin = (name: string): 'neulbo' | 'tokki' | null =>
  /토[끼키]|tokki|rabbit/i.test(name) ? 'tokki' : /늘보|neulbo|sloth/i.test(name) ? 'neulbo' : null;
export const now = () => new Date().toISOString();
export const id = () => randomUUID();
export interface VersionMedia {
  imageUrl: string;
  cleanImageUrl: string;
  caption: string | null;
  poseId: string | null;
  imageHash?: string | null;
  posterUrl: string;
  sourceUrl: string;
  gifUrl: string | null;
  motionPreset: MotionPreset | null;
  frameCount: number;
  durationMs: number;
  animation: FrameAnimation | null;
}
export const staticMedia = (url: string): VersionMedia => ({
  imageUrl: url,
  cleanImageUrl: url,
  caption: null,
  poseId: null,
  posterUrl: url,
  sourceUrl: url,
  gifUrl: null,
  motionPreset: null,
  frameCount: 1,
  durationMs: 0,
  animation: null,
});
export const SAMPLES = [
  {
    file: 'hello',
    title: '느긋한 인사',
    emotion: '반가워요',
    prompt: 'Waving one paw, gentle friendly smile, greeting a friend.',
  },
  {
    file: 'love',
    title: '마음을 전해요',
    emotion: '사랑해요',
    prompt: 'Hugging a small pink heart with an affectionate, shy smile.',
  },
  {
    file: 'sleepy',
    title: '조금만 더 잘게',
    emotion: '졸려요',
    prompt: 'Sleepy closed eyes, curled up resting comfortably, tiny sleep sparkles.',
  },
  {
    file: 'thanks',
    title: '고마운 마음',
    emotion: '고마워요',
    prompt: 'Bowing gently with paws together, grateful warm expression.',
  },
  {
    file: 'cheer',
    title: '천천히 해도 괜찮아',
    emotion: '응원해요',
    prompt: 'Raising both paws in encouragement, bright reassuring smile, small celebratory stars.',
  },
  {
    file: 'sorry',
    title: '미안한 늘보',
    emotion: '미안해요',
    prompt: 'Looking apologetic with lowered eyes and paws together, one tiny sweat drop.',
  },
] as const;

export const SAMPLE_DIRECTION: Direction = {
  id: 'sloth-cozy',
  title: '느긋해서 더 다정한 하루',
  description:
    '서두르지 않는 늘보군의 작고 다정한 일상. 둥근 실루엣과 따뜻한 표정으로 마음을 전해요.',
  tags: ['포근한 일상', '느긋한 유머', '파스텔'],
  color: '#b8cbb0',
  prompts: SAMPLES.map((s) => s.prompt),
};

export class Store {
  db: DatabaseSync;
  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path.join(dataDir, 'emotistudio.sqlite'));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE COLLATE NOCASE,
        password_hash TEXT, is_guest INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS concepts (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL, character_name TEXT NOT NULL, concept TEXT NOT NULL,
        personality TEXT NOT NULL DEFAULT '', audience TEXT NOT NULL DEFAULT '', reference_url TEXT,
        builtin_character TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS concepts_owner ON concepts(user_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL, character_name TEXT NOT NULL, concept TEXT NOT NULL,
        personality TEXT NOT NULL DEFAULT '', audience TEXT NOT NULL DEFAULT '', reference_url TEXT,
        direction_json TEXT, status TEXT NOT NULL DEFAULT 'concept', provider TEXT NOT NULL DEFAULT 'sample',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS projects_owner ON projects(user_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS stickers (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL, emotion TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
        current_version INTEGER NOT NULL DEFAULT 1, feedback TEXT, sort_order INTEGER NOT NULL, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS stickers_project ON stickers(project_id, sort_order);
      CREATE TABLE IF NOT EXISTS versions (
        id TEXT PRIMARY KEY, sticker_id TEXT NOT NULL REFERENCES stickers(id) ON DELETE CASCADE,
        version INTEGER NOT NULL, image_url TEXT NOT NULL, prompt TEXT NOT NULL, feedback TEXT,
        provider TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(sticker_id, version)
      );
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        status TEXT NOT NULL, total INTEGER NOT NULL, completed INTEGER NOT NULL DEFAULT 0,
        error TEXT, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS jobs_project ON jobs(project_id, created_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS jobs_one_active ON jobs(project_id) WHERE status IN ('queued','running');
      CREATE TABLE IF NOT EXISTS activity (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        type TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS assets (
        filename TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        bytes INTEGER NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS image_usage (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        image_count INTEGER NOT NULL, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS image_usage_owner_date ON image_usage(user_id, created_at);
      INSERT OR IGNORE INTO image_usage (id, user_id, image_count, created_at)
        SELECT j.id, p.user_id, j.total, j.created_at FROM jobs j JOIN projects p ON p.id = j.project_id
        WHERE json_extract(j.payload_json, '$.provider') = 'openai' AND COALESCE(json_extract(j.payload_json, '$.motionOnly'), 0) = 0 AND COALESCE(json_extract(j.payload_json, '$.captionOnly'), 0) = 0;
    `);
    this.migrate();
    this.run('DELETE FROM sessions WHERE expires_at <= ?', now());
  }
  private migrate() {
    const projectColumns = new Set(this.all('PRAGMA table_info(projects)').map((row) => row.name));
    const versionColumns = new Set(this.all('PRAGMA table_info(versions)').map((row) => row.name));
    const jobColumns = new Set(this.all('PRAGMA table_info(jobs)').map((row) => row.name));
    this.transaction(() => {
      for (const [name, definition] of Object.entries({
        format: "TEXT NOT NULL DEFAULT 'static'",
        target_count: 'INTEGER NOT NULL DEFAULT 32',
        is_legacy: 'INTEGER NOT NULL DEFAULT 1',
        motion_preset: "TEXT NOT NULL DEFAULT 'float'",
        action_prompt: "TEXT NOT NULL DEFAULT ''",
        concept_id: 'TEXT REFERENCES concepts(id) ON DELETE RESTRICT',
        builtin_character: 'TEXT',
        captions_enabled: 'INTEGER NOT NULL DEFAULT 0',
      })) {
        if (!projectColumns.has(name))
          this.db.exec(`ALTER TABLE projects ADD COLUMN ${name} ${definition}`);
      }
      if (!projectColumns.has('target_count')) {
        for (const project of this.all('SELECT id FROM projects')) {
          const batch = this.one(
            "SELECT payload_json FROM jobs WHERE project_id = ? AND json_extract(payload_json, '$.stickerId') IS NULL ORDER BY rowid DESC LIMIT 1",
            project.id,
          );
          const previousTarget = batch ? Number(JSON.parse(batch.payload_json).count) : 0;
          const stickerCount = Number(
            this.one('SELECT COUNT(*) AS n FROM stickers WHERE project_id = ?', project.id)!.n,
          );
          const target =
            Number.isInteger(previousTarget) && previousTarget > 0
              ? previousTarget
              : stickerCount || 32;
          this.run(
            'UPDATE projects SET target_count = ?, is_legacy = 1 WHERE id = ?',
            target,
            project.id,
          );
        }
      }
      for (const [name, definition] of Object.entries({
        poster_url: 'TEXT',
        source_url: 'TEXT',
        gif_url: 'TEXT',
        motion_preset: 'TEXT',
        frame_count: 'INTEGER NOT NULL DEFAULT 1',
        duration_ms: 'INTEGER NOT NULL DEFAULT 0',
        animation_json: 'TEXT',
        clean_image_url: 'TEXT',
        caption: 'TEXT',
        pose_id: 'TEXT',
        image_hash: 'TEXT',
      })) {
        if (!versionColumns.has(name))
          this.db.exec(`ALTER TABLE versions ADD COLUMN ${name} ${definition}`);
      }
      this.run('UPDATE versions SET poster_url = image_url WHERE poster_url IS NULL');
      this.run('UPDATE versions SET source_url = image_url WHERE source_url IS NULL');
      if (!jobColumns.has('attempted'))
        this.db.exec('ALTER TABLE jobs ADD COLUMN attempted INTEGER NOT NULL DEFAULT 0');
      this.run(
        "UPDATE projects SET action_prompt = ? WHERE action_prompt = ''",
        ACTION_SUGGESTIONS[0].prompt,
      );
      this.run(
        "UPDATE versions SET clean_image_url = COALESCE(json_extract(animation_json, '$.sheetUrl'), image_url) WHERE clean_image_url IS NULL",
      );
      const groups = new Map<string, string>();
      for (const project of this.all(
        'SELECT * FROM projects WHERE concept_id IS NULL ORDER BY created_at, id',
      )) {
        const key = `${project.user_id}:${project.character_name}`;
        let conceptId = groups.get(key);
        if (!conceptId) {
          conceptId = id();
          this.run(
            'INSERT INTO concepts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            conceptId,
            project.user_id,
            project.character_name,
            project.character_name,
            project.concept,
            project.personality,
            project.audience,
            project.reference_url,
            inferBuiltin(project.character_name),
            project.created_at,
            project.updated_at,
          );
          groups.set(key, conceptId);
        }
        this.run(
          'UPDATE projects SET concept_id = ?, builtin_character = ? WHERE id = ?',
          conceptId,
          inferBuiltin(project.character_name),
          project.id,
        );
      }
      this.db.exec('CREATE INDEX IF NOT EXISTS projects_concept ON projects(concept_id)');
      this.db.exec('PRAGMA user_version = 4');
    });
  }
  settleUsage(jobId: string, conservativeRestart = false) {
    const job = this.one('SELECT * FROM jobs WHERE id = ?', jobId);
    if (!job) return;
    const attempted = Math.max(
      Number(job.attempted),
      Number(job.completed) + (conservativeRestart && job.status === 'running' ? 1 : 0),
    );
    this.run(
      'UPDATE image_usage SET image_count = MIN(image_count, ?) WHERE id = ?',
      Math.min(job.total, attempted),
      jobId,
    );
  }
  one(sql: string, ...params: (string | number | null)[]): Row | undefined {
    return this.db.prepare(sql).get(...params) as Row | undefined;
  }
  all(sql: string, ...params: (string | number | null)[]): Row[] {
    return this.db.prepare(sql).all(...params) as Row[];
  }
  run(sql: string, ...params: (string | number | null)[]) {
    return this.db.prepare(sql).run(...params);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = fn();
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      // SQLITE_FULL can roll back automatically; retain the actual failure.
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }
  user(row: Row): User {
    return { id: row.id, name: row.name, email: row.email, isGuest: Boolean(row.is_guest) };
  }
  activity(projectId: string, type: string, message: string) {
    this.run('INSERT INTO activity VALUES (?, ?, ?, ?, ?)', id(), projectId, type, message, now());
    this.run('UPDATE projects SET updated_at = ? WHERE id = ?', now(), projectId);
    this.run(
      'UPDATE concepts SET updated_at = ? WHERE id = (SELECT concept_id FROM projects WHERE id = ?)',
      now(),
      projectId,
    );
  }
  project(row: Row): Project {
    const counts = this.one(
      "SELECT COUNT(*) AS total, SUM(s.status = 'approved') AS approved, SUM(v.provider = 'sample') AS samples FROM stickers s JOIN versions v ON v.sticker_id = s.id AND v.version = s.current_version WHERE s.project_id = ?",
      row.id,
    )!;
    const first = this.one(
      'SELECT v.poster_url FROM stickers s JOIN versions v ON v.sticker_id = s.id AND v.version = s.current_version WHERE s.project_id = ? ORDER BY s.sort_order LIMIT 1',
      row.id,
    );
    return {
      id: row.id,
      conceptId: row.concept_id,
      builtinCharacter: row.builtin_character,
      captionsEnabled: Boolean(row.captions_enabled),
      name: row.name,
      characterName: row.character_name,
      concept: row.concept,
      personality: row.personality,
      audience: row.audience,
      referenceUrl: row.reference_url,
      direction: row.direction_json ? JSON.parse(row.direction_json) : null,
      status: row.status,
      provider: row.provider,
      format: row.format,
      targetCount: row.target_count,
      isLegacy: Boolean(row.is_legacy),
      motionPreset: row.motion_preset,
      actionPrompt: row.action_prompt,
      stickerCount: Number(counts.total),
      approvedCount: Number(counts.approved || 0),
      containsPresetSamples: Number(counts.samples || 0) > 0,
      coverUrl: first?.poster_url || row.reference_url,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
  concept(row: Row): CharacterConcept {
    const projects = this.all(
      'SELECT * FROM projects WHERE concept_id = ? ORDER BY updated_at DESC',
      row.id,
    ).map((p) => this.project(p));
    return {
      id: row.id,
      name: row.name,
      characterName: row.character_name,
      concept: row.concept,
      personality: row.personality,
      audience: row.audience,
      referenceUrl: row.reference_url,
      builtinCharacter: row.builtin_character,
      projectCount: projects.length,
      stickerCount: projects.reduce((total, project) => total + project.stickerCount, 0),
      coverUrl: projects.find((p) => p.coverUrl)?.coverUrl || row.reference_url,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
  conceptDetail(row: Row): ConceptDetail {
    return {
      ...this.concept(row),
      projects: this.all(
        'SELECT * FROM projects WHERE concept_id = ? ORDER BY updated_at DESC',
        row.id,
      ).map((p) => this.project(p)),
    };
  }
  job(row?: Row): GenerationJob | null {
    if (!row) return null;
    return {
      id: row.id,
      projectId: row.project_id,
      status: row.status,
      total: row.total,
      completed: row.completed,
      error: row.error,
      createdAt: row.created_at,
      requestedCount: JSON.parse(row.payload_json).count,
    };
  }
  detail(row: Row): ProjectDetail {
    const stickers: Sticker[] = this.all(
      'SELECT * FROM stickers WHERE project_id = ? ORDER BY sort_order',
      row.id,
    ).map((s) => {
      const versions: StickerVersion[] = this.all(
        'SELECT * FROM versions WHERE sticker_id = ? ORDER BY version DESC',
        s.id,
      ).map((v) => ({
        id: v.id,
        version: v.version,
        imageUrl: v.image_url,
        cleanImageUrl: v.clean_image_url || v.image_url,
        caption: v.caption,
        poseId: v.pose_id,
        posterUrl: v.poster_url || v.image_url,
        sourceUrl: v.source_url || v.image_url,
        gifUrl: v.gif_url,
        motionPreset: v.motion_preset,
        frameCount: v.frame_count,
        durationMs: v.duration_ms,
        animation: v.animation_json ? JSON.parse(v.animation_json) : null,
        prompt: v.prompt,
        feedback: v.feedback,
        provider: v.provider,
        createdAt: v.created_at,
      }));
      const current = versions.find((v) => v.version === s.current_version)!;
      return {
        id: s.id,
        projectId: s.project_id,
        title: s.title,
        emotion: s.emotion,
        status: s.status,
        currentVersion: s.current_version,
        feedback: s.feedback,
        createdAt: s.created_at,
        imageUrl: current.imageUrl,
        caption: current.caption,
        poseId: current.poseId,
        posterUrl: current.posterUrl,
        gifUrl: current.gifUrl,
        motionPreset: current.motionPreset,
        frameCount: current.frameCount,
        durationMs: current.durationMs,
        animation: current.animation,
        versions,
      };
    });
    const activities: Activity[] = this.all(
      'SELECT * FROM activity WHERE project_id = ? ORDER BY rowid DESC LIMIT 100',
      row.id,
    ).map((a) => ({ id: a.id, type: a.type, message: a.message, createdAt: a.created_at }));
    return {
      ...this.project(row),
      stickers,
      activities,
      job: this.job(
        this.one('SELECT * FROM jobs WHERE project_id = ? ORDER BY rowid DESC LIMIT 1', row.id),
      ),
    };
  }
  addSticker(
    projectId: string,
    index: number,
    title: string,
    emotion: string,
    imageUrl: string,
    prompt: string,
    provider: Provider,
    media: VersionMedia = staticMedia(imageUrl),
  ): string {
    const stickerId = id();
    this.run(
      "INSERT INTO stickers VALUES (?, ?, ?, ?, 'pending', 1, NULL, ?, ?)",
      stickerId,
      projectId,
      title,
      emotion,
      index,
      now(),
    );
    this.addVersion(stickerId, 1, media, prompt, null, provider);
    return stickerId;
  }
  addVersion(
    stickerId: string,
    version: number,
    media: VersionMedia,
    prompt: string,
    feedback: string | null,
    provider: Provider,
  ) {
    this.run(
      'INSERT INTO versions (id, sticker_id, version, image_url, prompt, feedback, provider, created_at, poster_url, source_url, gif_url, motion_preset, frame_count, duration_ms, animation_json, clean_image_url, caption, pose_id, image_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id(),
      stickerId,
      version,
      media.imageUrl,
      prompt,
      feedback,
      provider,
      now(),
      media.posterUrl,
      media.sourceUrl,
      media.gifUrl,
      media.motionPreset,
      media.frameCount,
      media.durationMs,
      media.animation ? JSON.stringify(media.animation) : null,
      media.cleanImageUrl,
      media.caption,
      media.poseId,
      media.imageHash || null,
    );
  }
  seed(userId: string) {
    const projectId = id();
    this.transaction(() => {
      const conceptId = id();
      this.run(
        'INSERT INTO concepts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        conceptId,
        userId,
        '늘보군',
        '늘보군',
        '언제나 느긋하지만 마음만은 누구보다 다정한 나무늘보.',
        '느긋함, 다정함, 소심한 유머',
        '일상의 작은 위로가 필요한 20–30대',
        '/samples/reference.png',
        'neulbo',
        now(),
        now(),
      );
      this.run(
        `INSERT INTO projects (id, user_id, name, character_name, concept, personality, audience, reference_url, direction_json, status, provider, created_at, updated_at, format, target_count, is_legacy, motion_preset) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'review', 'sample', ?, ?, 'static', 6, 1, 'float')`,
        projectId,
        userId,
        '늘보군의 느긋한 하루',
        '늘보군',
        '언제나 느긋하지만 마음만은 누구보다 다정한 나무늘보. 소소한 일상에서 공감과 위로를 건네는 이모티콘.',
        '느긋함, 다정함, 소심한 유머',
        '일상의 작은 위로가 필요한 20–30대',
        '/samples/reference.png',
        JSON.stringify(SAMPLE_DIRECTION),
        now(),
        now(),
      );
      this.run(
        'UPDATE projects SET action_prompt = ?, concept_id = ?, builtin_character = ? WHERE id = ?',
        ACTION_SUGGESTIONS[0].prompt,
        conceptId,
        'neulbo',
        projectId,
      );
      SAMPLES.forEach((s, index) =>
        this.addSticker(
          projectId,
          index,
          s.title,
          s.emotion,
          `/samples/${s.file}.png`,
          `미리 제작된 늘보군 샘플: ${s.prompt}`,
          'sample',
        ),
      );
      this.activity(
        projectId,
        'sample',
        '늘보군 미리보기 프로젝트를 열었어요. 이 6종은 사전 제작된 샘플이며, 입력한 내용으로 생성한 결과가 아닙니다.',
      );
    });
  }
}
