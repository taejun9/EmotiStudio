import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import archiver from 'archiver';
import sharp from 'sharp';
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { id, now, inferBuiltin, SAMPLES, Store, type Row } from './db.ts';
import { JobQueue, resolveImageFile, writeAsset, type JobPayload } from './generation.ts';
import { normalizeCaption } from './captions.ts';
import {
  ACTION_SUGGESTIONS,
  KAKAO_STICKER_COUNTS,
  type Direction,
  type Provider,
} from '../shared/types.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scrypt = promisify(scryptCallback);
const COOKIE = 'emotistudio_session';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}
type AuthedRequest = Request & { account: Row; sessionHash: string | null };
export interface AppOptions {
  dataDir?: string;
  publicDir?: string;
  distDir?: string;
  openaiApiKey?: string;
  imageModel?: string;
  allowedOrigins?: string[];
  secureCookies?: boolean;
  maxConcurrentJobs?: number;
  testMode?: boolean;
  fetchImpl?: typeof fetch;
}
const text = (max: number, min = 1) => z.string().trim().min(min).max(max);
const motionSchema = z.enum(['bounce', 'float', 'sway', 'pulse', 'shake']);
const projectInput = z
  .object({
    name: text(100),
    characterName: text(60),
    concept: text(3000),
    personality: text(500, 0).optional(),
    audience: text(300, 0).optional(),
    referenceUrl: z.string().max(200).nullable().optional(),
    format: z.enum(['static', 'animated']).optional(),
    motionPreset: motionSchema.optional(),
    actionPrompt: text(2000).optional(),
    conceptId: z.string().uuid().optional(),
    builtinCharacter: z.enum(['neulbo', 'tokki']).nullable().optional(),
    captionsEnabled: z.boolean().optional(),
  })
  .strict();
const conceptInput = projectInput.pick({
  name: true,
  characterName: true,
  concept: true,
  personality: true,
  audience: true,
  referenceUrl: true,
  builtinCharacter: true,
});
const directionSchema = z
  .object({
    id: text(100),
    title: text(100),
    description: text(1200),
    tags: z.array(text(40)).min(1).max(8),
    color: z.string().regex(/^#[a-fA-F0-9]{6}$/),
    prompts: z.array(text(500)).min(1).max(32),
  })
  .strict();
const providerSchema = z.enum(['sample', 'openai']);
const regionSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .strict()
  .refine(
    (r) => r.x + r.width <= 1 && r.y + r.height <= 1,
    '움직임 영역은 이미지 안에 있어야 합니다.',
  );
const emailSchema = z.email().trim().toLowerCase().max(254);
const passwordSchema = z.string().min(10, '비밀번호는 10자 이상 입력해 주세요.').max(128);

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString('hex')}`;
}
async function verifyPassword(password: string, encoded: string | null) {
  const [salt, hash] = (encoded || '00000000000000000000000000000000:' + '00'.repeat(64)).split(
    ':',
  );
  const derived = (await scrypt(password, salt!, 64)) as Buffer;
  const expected = Buffer.from(hash!, 'hex');
  return (
    expected.length === derived.length && timingSafeEqual(derived, expected) && Boolean(encoded)
  );
}

export function createApp(options: AppOptions = {}) {
  const app = express();
  const store = new Store(options.dataDir || process.env.DATA_DIR || path.join(ROOT, 'data'));
  const dataDir = path.resolve(options.dataDir || process.env.DATA_DIR || path.join(ROOT, 'data'));
  const assetsDir = path.join(dataDir, 'assets');
  const publicDir = options.publicDir || path.join(ROOT, 'public');
  const distDir = options.distDir || path.join(ROOT, 'dist');
  const openaiApiKey = options.openaiApiKey ?? process.env.OPENAI_API_KEY ?? '';
  const imageModel = options.imageModel || process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2';
  const secureCookies =
    options.secureCookies ??
    (process.env.COOKIE_SECURE
      ? process.env.COOKIE_SECURE === 'true'
      : process.env.NODE_ENV === 'production' && !options.testMode);
  const origins =
    options.allowedOrigins ||
    (process.env.APP_ORIGIN || '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  const defaultDevOrigins =
    process.env.NODE_ENV === 'production' ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173'];
  const queue = new JobQueue(store, {
    assetsDir,
    publicDir,
    openaiApiKey,
    imageModel,
    maxConcurrentJobs: Math.max(1, Math.min(options.maxConcurrentJobs || 2, 8)),
    fetchImpl: options.fetchImpl,
  });
  const cookieOptions = {
    httpOnly: true,
    secure: secureCookies,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_MS,
  };
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(cookieParser());
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('Origin');
      const selfOrigin = `${req.protocol}://${req.get('Host')}`;
      if (
        req.get('Sec-Fetch-Site') === 'cross-site' ||
        (origin && ![selfOrigin, ...origins, ...defaultDevOrigins].includes(origin))
      ) {
        return next(
          new HttpError(403, '허용되지 않은 웹사이트에서 보낸 요청입니다.', 'ORIGIN_REJECTED'),
        );
      }
    }
    next();
  });
  app.use(express.json({ limit: '64kb' }));
  app.get('/api/health', (_req, res) => {
    store.one('SELECT 1 AS ready');
    res.json({ status: 'ok' });
  });
  if (!options.testMode) {
    app.use(
      '/api/assets',
      rateLimit({
        windowMs: 60_000,
        limit: 2000,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        skip: (req) => !['GET', 'HEAD'].includes(req.method),
        message: { error: '이미지 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' },
      }),
    );
    app.use(
      '/api',
      rateLimit({
        windowMs: 60_000,
        limit: 240,
        skip: (req) => ['GET', 'HEAD'].includes(req.method) && req.path.startsWith('/assets/'),
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: { error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' },
      }),
    );
    app.use(
      '/api/auth',
      rateLimit({
        windowMs: 15 * 60_000,
        limit: 25,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: { error: '로그인 시도가 너무 많습니다. 15분 후 다시 시도해 주세요.' },
      }),
    );
  }
  const startSession = (req: AuthedRequest, res: Response, userId: string) => {
    if (req.sessionHash) store.run('DELETE FROM sessions WHERE token_hash = ?', req.sessionHash);
    const token = randomBytes(32).toString('hex');
    req.sessionHash = sha(token);
    store.run(
      'INSERT INTO sessions VALUES (?, ?, ?, ?)',
      req.sessionHash,
      userId,
      new Date(Date.now() + SESSION_MS).toISOString(),
      now(),
    );
    res.cookie(COOKIE, token, cookieOptions);
  };
  // Image reads never create accounts. Every session and private asset is owner scoped.
  app.use('/api', (request, res, next) => {
    const req = request as AuthedRequest;
    const token = req.cookies?.[COOKIE];
    req.sessionHash = typeof token === 'string' && /^[a-f0-9]{64}$/.test(token) ? sha(token) : null;
    const account = req.sessionHash
      ? store.one(
          'SELECT u.* FROM users u JOIN sessions s ON s.user_id = u.id WHERE s.token_hash = ? AND s.expires_at > ?',
          req.sessionHash,
          now(),
        )
      : undefined;
    if (account) {
      req.account = account;
      return next();
    }
    if (req.path.startsWith('/assets/'))
      return next(new HttpError(404, '이미지를 찾을 수 없습니다.'));
    const userId = id();
    store.transaction(() => {
      store.run('INSERT INTO users VALUES (?, ?, NULL, NULL, 1, ?)', userId, '게스트 작가', now());
      // Seeding uses its own transaction below.
    });
    store.seed(userId);
    req.account = store.one('SELECT * FROM users WHERE id = ?', userId)!;
    startSession(req, res, userId);
    next();
  });
  const account = (req: Request) => (req as AuthedRequest).account;
  const owned = (req: Request): Row => {
    const row = store.one(
      'SELECT * FROM projects WHERE id = ? AND user_id = ?',
      String(req.params.id),
      account(req).id,
    );
    if (!row) throw new HttpError(404, '프로젝트를 찾을 수 없습니다.', 'NOT_FOUND');
    return row;
  };
  const active = (projectId: string) =>
    Boolean(
      store.one(
        "SELECT id FROM jobs WHERE project_id = ? AND status IN ('queued', 'running')",
        projectId,
      ),
    );
  const editable = (row: Row) => {
    if (active(row.id))
      throw new HttpError(
        409,
        '이미지 작업이 진행 중입니다. 완료 후 다시 시도해 주세요.',
        'JOB_ACTIVE',
      );
    if (row.status === 'completed')
      throw new HttpError(
        409,
        '완료한 프로젝트입니다. 검수를 다시 열고 수정해 주세요.',
        'PROJECT_COMPLETED',
      );
  };
  const validateReference = (url: string | null | undefined, userId: string) => {
    if (!url) return;
    if (
      /^\/samples\/(reference|hello|love|sleepy|thanks|cheer|sorry|characters\/neulbo|characters\/tokki)\.png$/.test(
        url,
      )
    )
      return;
    if (
      !/^\/api\/assets\/[a-f0-9-]+\.png$/.test(url) ||
      !store.one(
        'SELECT filename FROM assets WHERE filename = ? AND user_id = ?',
        path.basename(url),
        userId,
      ) ||
      store.one(
        "SELECT id FROM versions WHERE json_extract(animation_json, '$.sheetUrl') = ? OR (animation_json IS NOT NULL AND clean_image_url = ?) LIMIT 1",
        url,
        url,
      )
    ) {
      throw new HttpError(
        400,
        '직접 업로드한 이미지 또는 제공된 샘플만 참조 이미지로 사용할 수 있습니다.',
        'INVALID_REFERENCE',
      );
    }
  };
  const getSticker = (projectId: string, stickerId: string) => {
    const sticker = store.one(
      'SELECT * FROM stickers WHERE id = ? AND project_id = ?',
      stickerId,
      projectId,
    );
    if (!sticker) throw new HttpError(404, '이모티콘을 찾을 수 없습니다.');
    return sticker;
  };
  const readyForExport = (row: Row) => {
    const project = store.project(row);
    if (
      row.status !== 'completed' ||
      active(row.id) ||
      project.stickerCount === 0 ||
      project.stickerCount !== project.targetCount ||
      project.approvedCount !== project.stickerCount
    ) {
      throw new HttpError(
        409,
        '모든 이모티콘을 승인하고 프로젝트를 완료한 후 내보낼 수 있습니다.',
        'REVIEW_REQUIRED',
      );
    }
    return store.detail(row);
  };
  const incompleteBatch = (projectId: string) => {
    const lastBatch = store.one(
      "SELECT * FROM jobs WHERE project_id = ? AND json_extract(payload_json, '$.stickerId') IS NULL ORDER BY rowid DESC LIMIT 1",
      projectId,
    );
    return lastBatch && lastBatch.status !== 'completed';
  };
  const checkProvider = (req: Request, provider: Provider, count: number) => {
    if (provider === 'sample') return;
    if (!openaiApiKey)
      throw new HttpError(
        503,
        '실제 이미지 생성을 사용하려면 서버에 OPENAI_API_KEY를 설정해 주세요.',
        'PROVIDER_UNAVAILABLE',
      );
    if (account(req).is_guest)
      throw new HttpError(
        401,
        '실제 이미지 생성은 계정을 만든 후 사용할 수 있습니다.',
        'ACCOUNT_REQUIRED',
      );
    const allowedEmails = (process.env.GENERATION_ALLOWED_EMAILS || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    if (allowedEmails.length && !allowedEmails.includes(account(req).email?.toLowerCase()))
      throw new HttpError(
        403,
        '현재 실제 이미지 생성은 사용이 허용된 계정에서만 이용할 수 있습니다.',
        'GENERATION_NOT_ALLOWED',
      );
    const limit = Math.max(1, Number(process.env.MAX_DAILY_GENERATED_IMAGES) || 48);
    const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
    const used = store.one(
      'SELECT COALESCE(SUM(image_count), 0) AS n FROM image_usage WHERE user_id = ? AND created_at >= ?',
      account(req).id,
      since,
    )!.n;
    if (used + count > limit)
      throw new HttpError(
        429,
        `지난 24시간의 실제 생성 한도(${limit}장)에 도달했습니다. 나중에 다시 시도해 주세요.`,
        'DAILY_LIMIT',
      );
    const globalLimit = Math.max(1, Number(process.env.MAX_GLOBAL_DAILY_GENERATED_IMAGES) || 96);
    const globalUsed = store.one(
      'SELECT COALESCE(SUM(image_count), 0) AS n FROM image_usage WHERE created_at >= ?',
      since,
    )!.n;
    if (globalUsed + count > globalLimit)
      throw new HttpError(
        429,
        '서비스의 하루 실제 이미지 생성 한도에 도달했습니다. 나중에 다시 시도해 주세요.',
        'GLOBAL_DAILY_LIMIT',
      );
  };
  const enqueue = (req: Request, project: Row, payload: JobPayload, total: number) => {
    if (!payload.captionOnly) checkProvider(req, payload.provider, total);
    const waiting = store.one(
      "SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued','running')",
    )!.n;
    if (waiting >= 20)
      throw new HttpError(429, '생성 요청이 많습니다. 잠시 후 다시 시도해 주세요.', 'QUEUE_FULL');
    const jobId = id();
    store.transaction(() => {
      if (payload.provider === 'openai' && !payload.captionOnly)
        store.run(
          'INSERT INTO image_usage VALUES (?, ?, ?, ?)',
          jobId,
          account(req).id,
          total,
          now(),
        );
      store.run(
        "INSERT INTO jobs (id, project_id, status, total, completed, error, payload_json, created_at, updated_at) VALUES (?, ?, 'queued', ?, 0, NULL, ?, ?, ?)",
        jobId,
        project.id,
        total,
        JSON.stringify(payload),
        now(),
        now(),
      );
      store.run(
        "UPDATE projects SET status = 'generating', provider = ?, updated_at = ? WHERE id = ?",
        payload.provider,
        now(),
        project.id,
      );
      if (payload.stickerId && payload.feedback)
        store.run(
          "UPDATE stickers SET feedback = ?, status = 'changes_requested' WHERE id = ?",
          payload.feedback,
          payload.stickerId,
        );
      store.activity(
        project.id,
        'generation_started',
        payload.captionOnly
          ? '원본 그림에 대사를 합성하고 있어요.'
          : payload.provider === 'sample'
            ? '선택한 캐릭터의 서로 다른 프리셋 포즈를 준비하고 있어요.'
            : payload.stickerId
              ? '선택한 이모티콘의 수정 작업을 시작했어요.'
              : `${total}개 이모티콘의 실제 이미지 생성을 시작했어요.`,
      );
    });
    queue.kick();
    return store.job(store.one('SELECT * FROM jobs WHERE id = ?', jobId));
  };

  app.get('/api/bootstrap', (req, res) =>
    res.json({
      user: store.user(account(req)),
      concepts: store
        .all('SELECT * FROM concepts WHERE user_id = ? ORDER BY updated_at DESC', account(req).id)
        .map((row) => store.concept(row)),
      projects: store
        .all('SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC', account(req).id)
        .map((row) => store.project(row)),
      capabilities: { liveGeneration: Boolean(openaiApiKey), imageModel, sampleCount: 32 },
    }),
  );
  app.post('/api/auth/register', async (req, res) => {
    const input = z
      .object({ name: text(60), email: emailSchema, password: passwordSchema })
      .strict()
      .parse(req.body);
    if (!account(req).is_guest) throw new HttpError(409, '이미 로그인되어 있습니다.');
    if (store.one('SELECT id FROM users WHERE email = ?', input.email))
      throw new HttpError(409, '이미 사용 중인 이메일입니다.', 'EMAIL_EXISTS');
    const hash = await hashPassword(input.password);
    // A concurrent registration can finish while password derivation is in progress.
    if (store.one('SELECT id FROM users WHERE email = ?', input.email))
      throw new HttpError(409, '이미 사용 중인 이메일입니다.', 'EMAIL_EXISTS');
    const promoted = store.run(
      'UPDATE users SET name = ?, email = ?, password_hash = ?, is_guest = 0 WHERE id = ? AND is_guest = 1',
      input.name,
      input.email,
      hash,
      account(req).id,
    );
    if (!promoted.changes)
      throw new HttpError(409, '이미 가입이 완료된 계정입니다. 다시 로그인해 주세요.');
    startSession(req as AuthedRequest, res, account(req).id);
    res
      .status(201)
      .json({ user: store.user(store.one('SELECT * FROM users WHERE id = ?', account(req).id)!) });
  });
  app.post('/api/auth/login', async (req, res) => {
    const input = z
      .object({ email: emailSchema, password: z.string().max(128) })
      .strict()
      .parse(req.body);
    const user = store.one('SELECT * FROM users WHERE email = ? AND is_guest = 0', input.email);
    if (!(await verifyPassword(input.password, user?.password_hash || null)))
      throw new HttpError(401, '이메일 또는 비밀번호가 일치하지 않습니다.', 'INVALID_CREDENTIALS');
    store.transaction(() => {
      // Bring the current anonymous work into the verified account instead of leaving it inaccessible.
      const guest = store.one(
        'SELECT id FROM users WHERE id = ? AND is_guest = 1',
        account(req).id,
      );
      if (guest && guest.id !== user!.id) {
        if (
          store.one(
            "SELECT j.id FROM jobs j JOIN projects p ON p.id = j.project_id WHERE p.user_id = ? AND j.status IN ('queued', 'running') LIMIT 1",
            guest.id,
          )
        )
          throw new HttpError(
            409,
            '이미지 생성이 끝난 뒤 로그인해 주세요. 진행 중인 작업을 안전하게 보존하고 있습니다.',
            'GENERATION_ACTIVE',
          );
        const existingSeed = store.one(
          "SELECT p.id FROM projects p JOIN activity a ON a.project_id = p.id WHERE p.user_id = ? AND a.type = 'sample' LIMIT 1",
          user!.id,
        );
        if (existingSeed) {
          const untouchedSeeds = store.all(
            "SELECT p.id FROM projects p WHERE p.user_id = ? AND (SELECT COUNT(*) FROM activity a WHERE a.project_id = p.id) = 1 AND EXISTS (SELECT 1 FROM activity a WHERE a.project_id = p.id AND a.type = 'sample')",
            guest.id,
          );
          for (const seed of untouchedSeeds)
            store.run('DELETE FROM projects WHERE id = ?', seed.id);
        }
        store.run('UPDATE concepts SET user_id = ? WHERE user_id = ?', user!.id, guest.id);
        store.run('UPDATE projects SET user_id = ? WHERE user_id = ?', user!.id, guest.id);
        store.run('UPDATE assets SET user_id = ? WHERE user_id = ?', user!.id, guest.id);
        store.run('UPDATE image_usage SET user_id = ? WHERE user_id = ?', user!.id, guest.id);
        store.run('DELETE FROM users WHERE id = ?', guest.id);
      }
      startSession(req as AuthedRequest, res, user!.id);
    });
    res.json({ user: store.user(user!) });
  });
  app.post('/api/auth/logout', (request, res) => {
    const req = request as AuthedRequest;
    if (req.sessionHash) store.run('DELETE FROM sessions WHERE token_hash = ?', req.sessionHash);
    res.clearCookie(COOKIE, { ...cookieOptions, maxAge: undefined });
    res.json({ ok: true });
  });

  app.get('/api/projects', (req, res) =>
    res.json(
      store
        .all('SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC', account(req).id)
        .map((row) => store.project(row)),
    ),
  );
  const ownedConcept = (req: Request, conceptId = String(req.params.id)) => {
    const row = store.one(
      'SELECT * FROM concepts WHERE id = ? AND user_id = ?',
      conceptId,
      account(req).id,
    );
    if (!row) throw new HttpError(404, '캐릭터 컨셉을 찾을 수 없습니다.', 'NOT_FOUND');
    return row;
  };
  const insertConcept = (userId: string, input: z.infer<typeof conceptInput>) => {
    if (store.one('SELECT COUNT(*) AS n FROM concepts WHERE user_id = ?', userId)!.n >= 100)
      throw new HttpError(409, '캐릭터 컨셉은 계정당 최대 100개까지 저장할 수 있습니다.');
    const conceptId = id();
    store.run(
      'INSERT INTO concepts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      conceptId,
      userId,
      input.name,
      input.characterName,
      input.concept,
      input.personality || '',
      input.audience || '',
      input.referenceUrl || null,
      input.builtinCharacter === undefined
        ? inferBuiltin(input.characterName)
        : input.builtinCharacter,
      now(),
      now(),
    );
    return store.one('SELECT * FROM concepts WHERE id = ?', conceptId)!;
  };
  const insertProject = (req: Request, input: z.infer<typeof projectInput>, parent?: Row) => {
    if (
      store.one('SELECT COUNT(*) AS n FROM projects WHERE user_id = ?', account(req).id)!.n >= 100
    )
      throw new HttpError(409, '프로젝트는 계정당 최대 100개까지 저장할 수 있습니다.');
    validateReference(parent ? parent.reference_url : input.referenceUrl, account(req).id);
    const projectId = id();
    store.transaction(() => {
      const concept =
        parent || insertConcept(account(req).id, { ...input, name: input.characterName });
      store.run(
        "INSERT INTO projects (id, user_id, name, character_name, concept, personality, audience, reference_url, direction_json, status, provider, created_at, updated_at, format, target_count, is_legacy, motion_preset, action_prompt, concept_id, builtin_character, captions_enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'concept', 'sample', ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)",
        projectId,
        account(req).id,
        input.name,
        concept.character_name,
        concept.concept,
        concept.personality,
        concept.audience,
        concept.reference_url,
        now(),
        now(),
        input.format || 'static',
        KAKAO_STICKER_COUNTS[input.format || 'static'],
        input.motionPreset || 'float',
        input.actionPrompt || ACTION_SUGGESTIONS[0].prompt,
        concept.id,
        concept.builtin_character,
        input.captionsEnabled ? 1 : 0,
      );
      store.run('UPDATE concepts SET updated_at = ? WHERE id = ?', now(), concept.id);
      store.activity(
        projectId,
        'created',
        '캐릭터 컨셉을 바탕으로 새로운 이모티콘 세트를 시작했어요.',
      );
    });
    return store.detail(store.one('SELECT * FROM projects WHERE id = ?', projectId)!);
  };
  app.get('/api/concepts', (req, res) =>
    res.json(
      store
        .all('SELECT * FROM concepts WHERE user_id = ? ORDER BY updated_at DESC', account(req).id)
        .map((row) => store.concept(row)),
    ),
  );
  app.post('/api/concepts', (req, res) => {
    const input = conceptInput.parse(req.body);
    validateReference(input.referenceUrl, account(req).id);
    const row = store.transaction(() => insertConcept(account(req).id, input));
    res.status(201).json(store.conceptDetail(row));
  });
  app.get('/api/concepts/:id', (req, res) => res.json(store.conceptDetail(ownedConcept(req))));
  app.patch('/api/concepts/:id', (req, res) => {
    const concept = ownedConcept(req);
    const input = conceptInput.partial().parse(req.body);
    if (!Object.keys(input).length) throw new HttpError(400, '변경할 내용을 입력해 주세요.');
    validateReference(input.referenceUrl, account(req).id);
    const fields: Record<string, string> = {
      name: 'name',
      characterName: 'character_name',
      concept: 'concept',
      personality: 'personality',
      audience: 'audience',
      referenceUrl: 'reference_url',
      builtinCharacter: 'builtin_character',
    };
    store.transaction(() => {
      for (const [key, value] of Object.entries(input))
        store.run(`UPDATE concepts SET ${fields[key]} = ? WHERE id = ?`, value ?? null, concept.id);
      store.run('UPDATE concepts SET updated_at = ? WHERE id = ?', now(), concept.id);
    });
    res.json(store.conceptDetail(ownedConcept(req)));
  });
  app.delete('/api/concepts/:id', (req, res) => {
    const concept = ownedConcept(req);
    if (store.one('SELECT id FROM projects WHERE concept_id = ? LIMIT 1', concept.id))
      throw new HttpError(
        409,
        '세트를 먼저 정리한 뒤 빈 캐릭터 컨셉을 삭제할 수 있습니다.',
        'CONCEPT_NOT_EMPTY',
      );
    store.run('DELETE FROM concepts WHERE id = ?', concept.id);
    res.json({ ok: true });
  });
  app.post('/api/concepts/:id/projects', (req, res) => {
    const parent = ownedConcept(req);
    const input = z
      .object({
        name: text(100),
        format: z.enum(['static', 'animated']),
        captionsEnabled: z.boolean().optional(),
        actionPrompt: text(2000).optional(),
      })
      .strict()
      .parse(req.body);
    res
      .status(201)
      .json(
        insertProject(
          req,
          { ...input, characterName: parent.character_name, concept: parent.concept },
          parent,
        ),
      );
  });
  app.post('/api/projects', (req, res) => {
    const input = projectInput.parse(req.body);
    res
      .status(201)
      .json(
        insertProject(req, input, input.conceptId ? ownedConcept(req, input.conceptId) : undefined),
      );
  });
  app.get('/api/projects/:id', (req, res) => res.json(store.detail(owned(req))));
  app.patch('/api/projects/:id', (req, res) => {
    const project = owned(req);
    editable(project);
    const input = projectInput.partial().parse(req.body);
    if (!Object.keys(input).length) throw new HttpError(400, '변경할 내용을 입력해 주세요.');
    if (input.format && input.format !== project.format && store.project(project).stickerCount)
      throw new HttpError(
        409,
        '이미지를 생성한 뒤에는 프로젝트 형식을 바꿀 수 없습니다. 새 프로젝트를 만들어 주세요.',
        'FORMAT_LOCKED',
      );
    if (
      input.motionPreset &&
      input.motionPreset !== project.motion_preset &&
      store.project(project).stickerCount
    )
      throw new HttpError(
        409,
        '생성 후에는 각 이모티콘의 모션 변경 기능을 사용해 주세요.',
        'MOTION_LOCKED',
      );
    if (input.conceptId && input.conceptId !== project.concept_id)
      throw new HttpError(409, '세트의 부모 캐릭터는 변경할 수 없습니다.', 'CONCEPT_LOCKED');
    if (
      input.builtinCharacter !== undefined &&
      input.builtinCharacter !== project.builtin_character &&
      store.project(project).stickerCount
    )
      throw new HttpError(
        409,
        '생성 후에는 세트의 프리셋 캐릭터를 바꿀 수 없습니다.',
        'CHARACTER_LOCKED',
      );
    validateReference(input.referenceUrl, account(req).id);
    const fields: Record<string, string> = {
      name: 'name',
      characterName: 'character_name',
      concept: 'concept',
      personality: 'personality',
      audience: 'audience',
      referenceUrl: 'reference_url',
      format: 'format',
      motionPreset: 'motion_preset',
      actionPrompt: 'action_prompt',
      conceptId: 'concept_id',
      builtinCharacter: 'builtin_character',
      captionsEnabled: 'captions_enabled',
    };
    store.transaction(() => {
      for (const [key, value] of Object.entries(input))
        store.run(
          `UPDATE projects SET ${fields[key]} = ? WHERE id = ?`,
          typeof value === 'boolean' ? Number(value) : (value ?? null),
          project.id,
        );
      if (input.format && input.format !== project.format)
        store.run(
          'UPDATE projects SET target_count = ?, is_legacy = 0 WHERE id = ?',
          KAKAO_STICKER_COUNTS[input.format],
          project.id,
        );
      store.activity(project.id, 'updated', '캐릭터 컨셉을 저장했어요.');
    });
    res.json(store.detail(owned(req)));
  });
  app.delete('/api/projects/:id', async (req, res) => {
    const project = owned(req);
    if (active(project.id))
      throw new HttpError(409, '이미지 작업이 완료된 후 프로젝트를 삭제해 주세요.', 'JOB_ACTIVE');
    const assets = store
      .all('SELECT filename FROM assets WHERE project_id = ?', project.id)
      .filter((asset) => {
        const url = `/api/assets/${asset.filename}`;
        return (
          !store.one('SELECT id FROM concepts WHERE reference_url = ? LIMIT 1', url) &&
          !store.one(
            'SELECT id FROM projects WHERE reference_url = ? AND id != ?',
            url,
            project.id,
          ) &&
          !store.one(
            "SELECT v.id FROM versions v JOIN stickers s ON s.id = v.sticker_id WHERE (v.image_url = ? OR v.poster_url = ? OR v.source_url = ? OR v.gif_url = ? OR json_extract(v.animation_json, '$.sheetUrl') = ? OR v.clean_image_url = ?) AND s.project_id != ?",
            url,
            url,
            url,
            url,
            url,
            url,
            project.id,
          )
        );
      });
    // Assets referenced by another project survive. Unreferenced generated images are removed.
    store.transaction(() => {
      for (const asset of assets)
        store.run('DELETE FROM assets WHERE filename = ?', asset.filename);
      store.run('DELETE FROM projects WHERE id = ?', project.id);
    });
    await Promise.allSettled(assets.map((asset) => unlink(path.join(assetsDir, asset.filename))));
    res.json({ ok: true });
  });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0 },
    fileFilter: (_req, file, cb) => {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype))
        return cb(new HttpError(400, 'PNG, JPG, WebP 이미지만 업로드할 수 있습니다.'));
      cb(null, true);
    },
  });
  app.post('/api/uploads', upload.single('file'), async (req, res) => {
    if (!req.file) throw new HttpError(400, '이미지 파일을 선택해 주세요.');
    const quota = store.one(
      'SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS bytes FROM assets WHERE user_id = ?',
      account(req).id,
    )!;
    if (quota.n >= 300 || quota.bytes + req.file.size > 500 * 1024 * 1024)
      throw new HttpError(413, '계정의 이미지 저장 한도에 도달했습니다.');
    try {
      const metadata = await sharp(req.file.buffer, {
        limitInputPixels: 25_000_000,
        failOn: 'error',
      }).metadata();
      if (!['png', 'jpeg', 'webp'].includes(metadata.format || '') || (metadata.pages || 1) > 1)
        throw new Error('invalid format');
    } catch {
      throw new HttpError(400, '올바른 PNG, JPG, WebP 정지 이미지가 아닙니다.');
    }
    let url: string;
    try {
      url = await writeAsset(store, assetsDir, account(req).id, req.file.buffer);
    } catch {
      throw new HttpError(400, '이미지를 처리할 수 없습니다. 다른 이미지로 다시 시도해 주세요.');
    }
    res.status(201).json({ url });
  });
  app.get('/api/assets/:filename', (req, res, next) => {
    const filename = String(req.params.filename);
    if (
      !/^[a-f0-9-]+\.(png|webp|gif)$/.test(filename) ||
      !store.one(
        'SELECT filename FROM assets WHERE filename = ? AND user_id = ?',
        filename,
        account(req).id,
      )
    )
      throw new HttpError(404, '이미지를 찾을 수 없습니다.');
    res.type(path.extname(filename)).sendFile(path.join(assetsDir, filename), (error) => {
      if (error) next(new HttpError(404, '이미지를 찾을 수 없습니다.'));
    });
  });
  app.post('/api/projects/:id/directions', (req, res) => {
    const p = owned(req);
    const character = p.character_name;
    const gentle = /느긋|위로|다정|포근|따뜻|힐링|휴식/.test(`${p.concept} ${p.personality}`);
    const directions: Direction[] = [
      {
        id: 'everyday',
        title: gentle ? '느긋해서 더 다정한 하루' : `${character}의 공감 가득한 하루`,
        description: `${character}의 ${p.personality || '개성 있는 성격'}을 인사·감사·응원 같은 일상 대화에 담아요. ${p.audience || '친구들'}에게 자연스럽게 마음을 전하는 방향이에요.`,
        tags: [gentle ? '포근한 일상' : '일상 공감', '따뜻한 표정', '담백한 색감'],
        color: '#A8BC94',
        prompts: SAMPLES.map((s) => s.prompt),
      },
      {
        id: 'playful',
        title: `${character}의 작은 반전`,
        description: `“${p.concept.slice(0, 90)}”라는 컨셉을 과장된 리액션과 소소한 유머로 풀어요. 캐릭터의 특징은 유지하면서 눈과 몸짓의 대비를 키워요.`,
        tags: ['유쾌한 반전', '큰 리액션', '생동감'],
        color: '#E5BA7A',
        prompts: [
          'An exaggerated surprised reaction, playful comic expression.',
          'A tiny victorious dance, joyful energetic pose.',
          'A comically sleepy pose, soft humorous expression.',
          'A proud grin with a tiny celebratory prop.',
          'An enthusiastic cheering gesture.',
          'A very shy bashful apology.',
        ],
      },
      {
        id: 'minimal',
        title: '말보다 표정으로',
        description: `${character}의 실루엣과 표정에 집중해 작은 화면에서도 감정이 읽히도록 만들어요. ${p.audience || '대화 상대'}에게 짧고 정확하게 반응하는 미니멀한 방향이에요.`,
        tags: ['미니멀', '또렷한 감정', '간결한 포즈'],
        color: '#A8B9D2',
        prompts: [
          'A clear simple greeting wave.',
          'A small tender heart gesture.',
          'A simple sleepy expression.',
          'A gentle thankful bow.',
          'A minimal confident encouraging pose.',
          'A clearly readable apologetic expression.',
        ],
      },
    ];
    res.json(directions);
  });
  app.put('/api/projects/:id/direction', (req, res) => {
    const p = owned(req);
    editable(p);
    const { direction } = z.object({ direction: directionSchema }).strict().parse(req.body);
    store.transaction(() => {
      store.run(
        'UPDATE projects SET direction_json = ?, status = ? WHERE id = ?',
        JSON.stringify(direction),
        store.project(p).stickerCount ? 'review' : 'direction',
        p.id,
      );
      store.activity(
        p.id,
        'direction',
        `“${direction.title}” 방향을 선택했어요. 추천 방향은 컨셉 기반 템플릿입니다.`,
      );
    });
    res.json(store.detail(owned(req)));
  });
  app.post('/api/projects/:id/generate', (req, res) => {
    const p = owned(req);
    editable(p);
    const input = z
      .object({
        provider: providerSchema,
        count: z.number().int().min(1).max(32).optional(),
      })
      .strict()
      .parse(req.body);
    if (!p.direction_json)
      throw new HttpError(409, '먼저 이모티콘의 방향을 선택해 주세요.', 'DIRECTION_REQUIRED');
    const project = store.project(p);
    if (input.count !== undefined && input.count !== project.targetCount)
      throw new HttpError(
        400,
        `이 프로젝트는 ${project.targetCount}종 구성입니다. 생성 수량을 임의로 바꿀 수 없습니다.`,
        'TARGET_COUNT_REQUIRED',
      );
    if (project.stickerCount >= project.targetCount)
      throw new HttpError(
        409,
        '이미 생성한 이모티콘이 있어요. 개별 수정 기능을 사용하거나 새 프로젝트를 만들어 주세요.',
        'ALREADY_GENERATED',
      );
    const job = enqueue(
      req,
      p,
      {
        userId: account(req).id,
        provider: input.provider,
        project,
        count: project.targetCount,
        startIndex: project.stickerCount,
      },
      project.targetCount - project.stickerCount,
    );
    res.status(202).json({ job });
  });
  app.get('/api/projects/:id/job', (req, res) => {
    const p = owned(req);
    res.json({
      job: store.job(
        store.one('SELECT * FROM jobs WHERE project_id = ? ORDER BY rowid DESC LIMIT 1', p.id),
      ),
    });
  });
  app.patch('/api/projects/:id/stickers/:sid', (req, res) => {
    const p = owned(req);
    editable(p);
    const sticker = getSticker(p.id, String(req.params.sid));
    const input = z
      .object({
        status: z.enum(['pending', 'approved', 'changes_requested']).optional(),
        feedback: text(2000, 0).optional(),
        title: text(100).optional(),
      })
      .strict()
      .parse(req.body);
    if (!Object.keys(input).length) throw new HttpError(400, '변경할 내용을 입력해 주세요.');
    const status = input.status ?? sticker.status;
    if (status === 'changes_requested' && !(input.feedback ?? sticker.feedback)?.trim())
      throw new HttpError(400, '수정이 필요한 내용을 입력해 주세요.');
    store.transaction(() => {
      store.run(
        'UPDATE stickers SET status = ?, feedback = ?, title = ? WHERE id = ?',
        status,
        status === 'approved' ? null : (input.feedback ?? sticker.feedback),
        input.title ?? sticker.title,
        sticker.id,
      );
      store.activity(
        p.id,
        'review',
        input.status
          ? `“${input.title || sticker.title}” ${status === 'approved' ? '승인' : status === 'changes_requested' ? '수정 요청' : '검수 대기'} 상태를 저장했어요.`
          : `“${input.title || sticker.title}” 정보를 저장했어요.`,
      );
    });
    res.json(store.detail(owned(req)));
  });
  app.post('/api/projects/:id/stickers/:sid/revise', (req, res) => {
    const p = owned(req);
    editable(p);
    if (incompleteBatch(p.id))
      throw new HttpError(
        409,
        '중단된 세트 생성을 먼저 이어서 완료한 후 개별 이미지를 수정해 주세요.',
        'BATCH_INCOMPLETE',
      );
    const sticker = getSticker(p.id, String(req.params.sid));
    const input = z
      .object({ feedback: text(2000), provider: providerSchema })
      .strict()
      .parse(req.body);
    const version = store.one(
      'SELECT * FROM versions WHERE sticker_id = ? AND version = ?',
      sticker.id,
      sticker.current_version,
    )!;
    const job = enqueue(
      req,
      p,
      {
        userId: account(req).id,
        provider: input.provider,
        project: store.project(p),
        count: 1,
        startIndex: sticker.sort_order,
        variant: Number(
          store.one(
            "SELECT COUNT(*) + 1 AS n FROM jobs WHERE project_id = ? AND status = 'completed' AND json_extract(payload_json, '$.stickerId') = ? AND COALESCE(json_extract(payload_json, '$.captionOnly'), 0) = 0",
            p.id,
            sticker.id,
          )!.n,
        ),
        caption: version.caption,
        poseId: version.pose_id,
        stickerId: sticker.id,
        feedback: input.feedback,
        previousImage: version.animation_json
          ? version.clean_image_url
          : p.format === 'animated'
            ? version.poster_url
            : version.clean_image_url || version.image_url,
        previousImageGrid: version.animation_json
          ? {
              columns: JSON.parse(version.animation_json).columns,
              rows: JSON.parse(version.animation_json).rows,
              cellIndex: JSON.parse(version.animation_json).sequence[0],
            }
          : undefined,
        originalSourceUrl: version.source_url || version.poster_url || version.image_url,
        previousSheetUrl:
          p.format === 'animated' && version.animation_json
            ? version.clean_image_url || JSON.parse(version.animation_json).sheetUrl
            : undefined,
        previousTimeline:
          p.format === 'animated' && version.animation_json
            ? {
                sequence: JSON.parse(version.animation_json).sequence,
                delaysMs: JSON.parse(version.animation_json).delaysMs,
              }
            : undefined,
        previousPrompt: version.prompt,
        actionPrompt: version.animation_json
          ? JSON.parse(version.animation_json).actionPrompt
          : p.action_prompt,
        region: version.animation_json ? JSON.parse(version.animation_json).region : null,
      },
      1,
    );
    res.status(202).json({ job });
  });
  app.post('/api/projects/:id/stickers/:sid/motion', (req, _res) => {
    const p = owned(req);
    getSticker(p.id, String(req.params.sid));
    throw new HttpError(
      410,
      '전체 그림을 움직이는 효과는 더 이상 생성하지 않습니다. 움직일 부위와 동작을 입력해 새 애니메이션을 만들어 주세요.',
      'LEGACY_MOTION_REMOVED',
    );
  });
  app.post('/api/projects/:id/stickers/:sid/animate', (req, res) => {
    const p = owned(req);
    editable(p);
    if (p.format !== 'animated')
      throw new HttpError(
        409,
        '움직이는 이모티콘 프로젝트에서 동작을 만들 수 있습니다.',
        'ANIMATION_REQUIRED',
      );
    if (incompleteBatch(p.id))
      throw new HttpError(409, '중단된 세트 생성을 먼저 완료해 주세요.', 'BATCH_INCOMPLETE');
    const sticker = getSticker(p.id, String(req.params.sid));
    const input = z
      .object({
        provider: providerSchema,
        actionPrompt: text(2000),
        region: regionSchema.nullable().optional(),
      })
      .strict()
      .parse(req.body);
    const version = store.one(
      'SELECT * FROM versions WHERE sticker_id = ? AND version = ?',
      sticker.id,
      sticker.current_version,
    )!;
    const job = enqueue(
      req,
      p,
      {
        userId: account(req).id,
        provider: input.provider,
        project: store.project(p),
        count: 1,
        startIndex: sticker.sort_order,
        variant: Number(
          store.one(
            "SELECT COUNT(*) + 1 AS n FROM jobs WHERE project_id = ? AND status = 'completed' AND json_extract(payload_json, '$.stickerId') = ? AND COALESCE(json_extract(payload_json, '$.captionOnly'), 0) = 0",
            p.id,
            sticker.id,
          )!.n,
        ),
        caption: version.caption,
        poseId: version.pose_id,
        stickerId: sticker.id,
        previousImage: version.animation_json
          ? version.clean_image_url
          : version.poster_url || version.image_url,
        previousImageGrid: version.animation_json
          ? {
              columns: JSON.parse(version.animation_json).columns,
              rows: JSON.parse(version.animation_json).rows,
              cellIndex: JSON.parse(version.animation_json).sequence[0],
            }
          : undefined,
        originalSourceUrl: version.source_url || version.poster_url || version.image_url,
        previousPrompt: version.prompt,
        actionPrompt: input.actionPrompt,
        region: input.region || null,
      },
      1,
    );
    res.status(202).json({ job });
  });
  app.post('/api/projects/:id/stickers/:sid/caption', (req, res) => {
    const p = owned(req);
    editable(p);
    if (incompleteBatch(p.id))
      throw new HttpError(409, '중단된 세트 생성을 먼저 완료해 주세요.', 'BATCH_INCOMPLETE');
    const sticker = getSticker(p.id, String(req.params.sid));
    const input = z
      .object({ enabled: z.boolean(), text: z.string().max(500).optional() })
      .strict()
      .parse(req.body);
    let captionText: string | undefined;
    if (input.text !== undefined) {
      try {
        captionText = normalizeCaption(input.text);
      } catch (error) {
        throw new HttpError(
          400,
          error instanceof Error ? error.message : '대사를 확인해 주세요.',
          'INVALID_CAPTION',
        );
      }
    }
    const version = store.one(
      'SELECT * FROM versions WHERE sticker_id = ? AND version = ?',
      sticker.id,
      sticker.current_version,
    )!;
    if (p.format === 'animated' && !version.animation_json)
      throw new HttpError(
        409,
        '이전 전체 그림 효과에는 대사를 다시 합성할 수 없습니다. 새 동작을 생성해 주세요.',
        'FRAME_ANIMATION_REQUIRED',
      );
    const animation = version.animation_json ? JSON.parse(version.animation_json) : null;
    const job = enqueue(
      req,
      p,
      {
        userId: account(req).id,
        provider: version.provider,
        project: store.project(p),
        count: 1,
        startIndex: sticker.sort_order,
        stickerId: sticker.id,
        captionOnly: true,
        caption: input.enabled ? captionText || version.caption || undefined : null,
        cleanImageUrl: version.clean_image_url,
        originalSourceUrl: version.source_url,
        previousTimeline: animation
          ? { sequence: animation.sequence, delaysMs: animation.delaysMs }
          : undefined,
        previousPrompt: version.prompt,
        actionPrompt: animation?.actionPrompt,
        poseId: version.pose_id,
        region: null,
        captionRegion: animation?.region,
        previousHash: version.image_hash,
      },
      1,
    );
    res.status(202).json({ job });
  });
  app.post('/api/projects/:id/stickers/:sid/restore', (req, res) => {
    const p = owned(req);
    editable(p);
    const sticker = getSticker(p.id, String(req.params.sid));
    const { version } = z
      .object({ version: z.number().int().min(1) })
      .strict()
      .parse(req.body);
    if (
      !store.one(
        'SELECT id FROM versions WHERE sticker_id = ? AND version = ?',
        sticker.id,
        version,
      )
    )
      throw new HttpError(404, '해당 버전을 찾을 수 없습니다.');
    store.transaction(() => {
      store.run(
        "UPDATE stickers SET current_version = ?, status = 'pending', feedback = NULL WHERE id = ?",
        version,
        sticker.id,
      );
      store.activity(
        p.id,
        'restored',
        `“${sticker.title}”의 버전 ${version}을 복원했어요. 다시 검수해 주세요.`,
      );
    });
    res.json(store.detail(owned(req)));
  });
  app.post('/api/projects/:id/approve-all', (req, res) => {
    const p = owned(req);
    editable(p);
    if (!store.project(p).stickerCount) throw new HttpError(409, '먼저 이모티콘을 생성해 주세요.');
    store.transaction(() => {
      store.run(
        "UPDATE stickers SET status = 'approved', feedback = NULL WHERE project_id = ?",
        p.id,
      );
      store.activity(p.id, 'approved', '모든 이모티콘을 승인했어요.');
    });
    res.json(store.detail(owned(req)));
  });
  app.post('/api/projects/:id/complete', (req, res) => {
    const p = owned(req);
    if (p.status === 'completed') return res.json(store.detail(p));
    editable(p);
    const project = store.project(p);
    if (project.stickerCount !== project.targetCount)
      throw new HttpError(
        409,
        `${project.targetCount}종 중 ${project.stickerCount}종만 준비됐어요. 전체 생성을 마친 후 완료해 주세요.`,
        'BATCH_INCOMPLETE',
      );
    if (!project.stickerCount || project.approvedCount !== project.stickerCount)
      throw new HttpError(
        409,
        '모든 이모티콘을 승인한 후 프로젝트를 완료해 주세요.',
        'REVIEW_REQUIRED',
      );
    if (incompleteBatch(p.id))
      throw new HttpError(
        409,
        '일부 이미지의 생성이 중단되었어요. 생성을 다시 시도한 후 프로젝트를 완료해 주세요.',
        'BATCH_INCOMPLETE',
      );
    store.transaction(() => {
      store.run("UPDATE projects SET status = 'completed' WHERE id = ?", p.id);
      store.activity(
        p.id,
        'completed',
        '최종 검수를 마치고 프로젝트를 완료했어요. 이미지 패키지를 내보낼 수 있어요.',
      );
    });
    res.json(store.detail(owned(req)));
  });
  app.post('/api/projects/:id/reopen', (req, res) => {
    const p = owned(req);
    if (active(p.id)) throw new HttpError(409, '진행 중인 이미지 작업이 있어요.');
    if (p.status !== 'completed')
      throw new HttpError(409, '완료한 프로젝트만 검수를 다시 열 수 있습니다.');
    store.transaction(() => {
      store.run("UPDATE projects SET status = 'review' WHERE id = ?", p.id);
      store.activity(p.id, 'reopened', '프로젝트 검수를 다시 열었어요.');
    });
    res.json(store.detail(owned(req)));
  });
  const exportOptions = (req: Request) => {
    const project = readyForExport(owned(req));
    const size = Number(z.enum(['360', '720', '1024']).parse(req.query.size || '360'));
    if (project.format === 'animated' && size !== 360)
      throw new HttpError(400, '움직이는 이모티콘은 360px 원본 애니메이션으로 내보냅니다.');
    const format =
      project.format === 'animated'
        ? z.enum(['webp', 'gif']).parse(req.query.format || 'webp')
        : z.literal('png').parse(req.query.format || 'png');
    return { project, size, format };
  };
  const exportManifest = (req: Request) => {
    const { project, size, format } = exportOptions(req);
    return {
      formatVersion: 4,
      exportedAt: now(),
      app: 'EmotiStudio',
      project: {
        id: project.id,
        name: project.name,
        characterName: project.characterName,
        concept: project.concept,
        direction: project.direction,
        format: project.format,
        targetCount: project.targetCount,
        isLegacy: project.isLegacy,
        actionPrompt: project.actionPrompt,
        conceptId: project.conceptId,
        builtinCharacter: project.builtinCharacter,
        captionsEnabled: project.captionsEnabled,
      },
      image: { format, width: size, height: size, background: 'transparent' },
      containsPresetSamples: project.containsPresetSamples,
      note: '완료된 사용자 검수 결과이며 카카오 제출 적합 판정이 아닙니다. 카카오의 AI 생성 이모티콘 제안 제한과 공식 WebP Animator 제작 규정을 확인하고 필요한 경우 해당 도구로 재제작해야 합니다. sample 결과는 준비된 캐릭터의 독립된 포즈 라이브러리이며 자유 입력을 AI로 해석한 결과가 아닙니다. 기존 데모 버전의 샘플 출처는 각 버전 prompt를 확인해 주세요.',
      stickers: project.stickers.map((sticker, index) => {
        const current = sticker.versions.find(
          (version) => version.version === sticker.currentVersion,
        )!;
        const stem = `${String(index + 1).padStart(2, '0')}-${
          sticker.title
            .replace(/[^\p{L}\p{N} _-]/gu, '')
            .trim()
            .slice(0, 60) || 'sticker'
        }`;
        return {
          filename: project.format === 'animated' ? `animations/${stem}.${format}` : `${stem}.png`,
          posterFilename: project.format === 'animated' ? `posters/${stem}.png` : null,
          id: sticker.id,
          title: sticker.title,
          emotion: sticker.emotion,
          approved: sticker.status === 'approved',
          version: sticker.currentVersion,
          provider: current.provider,
          prompt: current.prompt,
          imageUrl: format === 'gif' ? sticker.gifUrl! : sticker.imageUrl,
          posterUrl: sticker.posterUrl,
          motionPreset: sticker.motionPreset,
          caption: sticker.caption,
          poseId: sticker.poseId,
          cleanImageUrl: current.cleanImageUrl,
          animation: sticker.animation,
          frameCount: sticker.frameCount,
          durationMs: sticker.durationMs,
        };
      }),
    };
  };
  const inspectAnimation = async (buffer: Buffer) => {
    const metadata = await sharp(buffer, { animated: true }).metadata();
    return {
      frameCount: metadata.pages || 1,
      durationMs: metadata.delay?.reduce((sum, delay) => sum + delay, 0) || 0,
    };
  };
  app.get('/api/projects/:id/export-manifest', async (req, res) => {
    const manifest = exportManifest(req);
    if (manifest.project.format === 'animated') {
      for (const sticker of manifest.stickers)
        Object.assign(
          sticker,
          await inspectAnimation(
            await readFile(resolveImageFile(sticker.imageUrl, publicDir, assetsDir)),
          ),
        );
    }
    res.json(manifest);
  });
  app.get('/api/projects/:id/export', async (req, res, next) => {
    const manifest = exportManifest(req);
    const files: { name: string; buffer: Buffer }[] = [];
    for (const sticker of manifest.stickers) {
      const original = await readFile(resolveImageFile(sticker.imageUrl, publicDir, assetsDir));
      if (manifest.project.format === 'animated') {
        Object.assign(sticker, await inspectAnimation(original));
        files.push({ name: sticker.filename, buffer: original });
        files.push({
          name: sticker.posterFilename!,
          buffer: await readFile(resolveImageFile(sticker.posterUrl, publicDir, assetsDir)),
        });
      } else {
        files.push({
          name: sticker.filename,
          buffer: await sharp(original)
            .resize(manifest.image.width, manifest.image.height, {
              fit: 'contain',
              background: { r: 0, g: 0, b: 0, alpha: 0 },
            })
            .ensureAlpha()
            .png()
            .toBuffer(),
        });
      }
    }
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', next);
    res
      .type('zip')
      .attachment(
        `emotistudio-${req.params.id}-${manifest.image.width}px-${manifest.image.format}.zip`,
      );
    res.on('close', () => archive.abort());
    archive.pipe(res);
    for (const file of files) archive.append(file.buffer, { name: file.name });
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
    await archive.finalize();
    store.activity(
      String(req.params.id),
      'exported',
      `${manifest.image.width}px ${manifest.image.format.toUpperCase()} ${manifest.stickers.length}종을 ZIP으로 내보냈어요.`,
    );
  });

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'API 경로를 찾을 수 없습니다.')));
  app.use(
    '/samples',
    express.static(path.join(publicDir, 'samples'), {
      maxAge: '1d',
      fallthrough: false,
      index: false,
      dotfiles: 'deny',
    }),
  );
  if (process.env.NODE_ENV === 'production' && existsSync(path.join(distDir, 'index.html'))) {
    app.use(express.static(distDir, { index: false, maxAge: '1h' }));
    app.get(/.*/, (req, res, next) =>
      req.accepts('html') ? res.sendFile('index.html', { root: distDir }) : next(),
    );
  }
  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(error);
    if (error instanceof HttpError)
      return res
        .status(error.status)
        .json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
    if (error instanceof z.ZodError)
      return res.status(400).json({
        error: `입력 내용을 확인해 주세요: ${error.issues[0]?.path.join('.') || '요청 형식'}`,
        code: 'VALIDATION_ERROR',
      });
    if (error instanceof multer.MulterError)
      return res.status(400).json({
        error:
          error.code === 'LIMIT_FILE_SIZE'
            ? '이미지는 최대 10MB까지 업로드할 수 있습니다.'
            : '하나의 이미지 파일만 업로드해 주세요.',
        code: 'UPLOAD_ERROR',
      });
    if (error instanceof SyntaxError && 'body' in error)
      return res.status(400).json({ error: '올바른 JSON 요청이 아닙니다.' });
    if (typeof error === 'object' && error !== null && 'status' in error && error.status === 413)
      return res.status(413).json({ error: '요청 내용이 너무 큽니다.' });
    if (typeof error === 'object' && error !== null && 'status' in error && error.status === 404)
      return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
    if (
      typeof error === 'object' &&
      error !== null &&
      (('errcode' in error && error.errcode === 13) || ('code' in error && error.code === 'ENOSPC'))
    )
      return res.status(507).json({
        error:
          '서버 저장 공간이 부족해 저장하지 못했어요. 기존 작업은 보존되어 있습니다. 운영자에게 문의해 주세요.',
        code: 'STORAGE_FULL',
      });
    console.error(
      '[EmotiStudio] Request failed:',
      error instanceof Error ? error.message : 'unknown error',
    );
    return res.status(500).json({
      error: '서버에서 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      code: 'INTERNAL_ERROR',
    });
  });
  let closed = false;
  return {
    app,
    db: store.db,
    close: async () => {
      if (closed) return;
      closed = true;
      await queue.close();
      store.db.close();
    },
  };
}
