import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { id, now, Store, staticMedia, type Row, type VersionMedia } from './db.ts';
import type { Project, Provider, AnimationRegion } from '../shared/types.ts';
import { renderFrameAnimation, type FrameAnimationOptions } from './frame-animation.ts';
import { renderCharacterSticker } from './character-art.ts';
import { STICKER_PLANS } from '../shared/sticker-plans.ts';
import { applyCaption } from './captions.ts';

export interface JobPayload {
  userId: string;
  provider: Provider;
  project: Project;
  count: number;
  startIndex: number;
  stickerId?: string;
  feedback?: string;
  previousImage?: string;
  previousImageGrid?: { columns: number; rows: number; cellIndex: number };
  variant?: number;
  caption?: string | null;
  captionOnly?: boolean;
  cleanImageUrl?: string;
  poseId?: string | null;
  previousHash?: string | null;
  captionRegion?: AnimationRegion | null;
  originalSourceUrl?: string;
  previousSheetUrl?: string;
  previousTimeline?: { sequence: number[]; delaysMs: number[] };
  previousPrompt?: string;
  actionPrompt?: string;
  region?: AnimationRegion | null;
}
export interface GenerationOptions {
  assetsDir: string;
  publicDir: string;
  openaiApiKey: string;
  imageModel: string;
  maxConcurrentJobs: number;
  fetchImpl?: typeof fetch;
}

export function resolveImageFile(url: string, publicDir: string, assetsDir: string): string {
  if (/^\/api\/assets\/[a-f0-9-]+\.(png|webp|gif)$/.test(url))
    return path.join(assetsDir, path.basename(url));
  if (
    /^\/samples\/(reference|hello|love|sleepy|thanks|cheer|sorry|animations\/wave|characters\/neulbo|characters\/tokki)\.png$/.test(
      url,
    )
  )
    return path.join(publicDir, url.slice(1));
  throw new Error('허용되지 않은 이미지 경로입니다.');
}

export async function writeAsset(
  store: Store,
  assetsDir: string,
  userId: string,
  buffer: Buffer,
  projectId: string | null = null,
  createdAssets?: string[],
): Promise<string> {
  const normalized = await sharp(buffer, { limitInputPixels: 25_000_000, failOn: 'error' })
    .rotate()
    .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();
  return writeEncodedAsset(store, assetsDir, userId, normalized, 'png', projectId, createdAssets);
}

function checkAssetCapacity(store: Store, userId: string, slots: number) {
  const quota = store.one(
    'SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS bytes FROM assets WHERE user_id = ?',
    userId,
  )!;
  if (quota.n + slots > 300 || quota.bytes >= 500 * 1024 * 1024)
    throw new Error(
      '이미지 저장 한도에 도달했습니다. 불필요한 프로젝트를 정리한 뒤 다시 시도해 주세요.',
    );
}

async function writeEncodedAsset(
  store: Store,
  assetsDir: string,
  userId: string,
  buffer: Buffer,
  extension: 'png' | 'webp' | 'gif',
  projectId: string | null,
  createdAssets?: string[],
): Promise<string> {
  const checkQuota = () => {
    const quota = store.one(
      'SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS bytes FROM assets WHERE user_id = ?',
      userId,
    )!;
    if (quota.n >= 300 || quota.bytes + buffer.length > 500 * 1024 * 1024)
      throw new Error(
        '이미지 저장 한도에 도달했습니다. 불필요한 프로젝트를 정리한 뒤 다시 시도해 주세요.',
      );
  };
  checkQuota();
  await mkdir(assetsDir, { recursive: true, mode: 0o700 });
  const filename = `${id()}.${extension}`;
  const temp = path.join(assetsDir, `${filename}.tmp`);
  const output = path.join(assetsDir, filename);
  try {
    await writeFile(temp, buffer, { mode: 0o600 });
    await rename(temp, output);
    store.transaction(() => {
      // Recheck after asynchronous I/O so concurrent uploads and generation share one limit.
      checkQuota();
      store.run(
        'INSERT INTO assets VALUES (?, ?, ?, ?, ?)',
        filename,
        userId,
        projectId,
        buffer.length,
        now(),
      );
    });
  } catch (error) {
    await Promise.allSettled([unlink(temp), unlink(output)]);
    throw error;
  }
  const url = `/api/assets/${filename}`;
  createdAssets?.push(url);
  return url;
}

function stickerPlan(index: number) {
  const plan = STICKER_PLANS[index];
  if (!plan) throw new Error('이미지 생성 포즈 계획을 찾을 수 없습니다.');
  return plan;
}
function actionFor(payload: JobPayload, index: number) {
  // A set has a different scene/action in each slot. Per-sticker requests may override its own action.
  return payload.stickerId && payload.actionPrompt
    ? payload.actionPrompt
    : stickerPlan(index).actionPrompt;
}
function makePrompt(payload: JobPayload, index: number): string {
  const p = payload.project;
  const plan = stickerPlan(index);
  const animated = p.format === 'animated';
  return [
    animated
      ? 'Create ONE transparent PNG sprite sheet containing exactly 8 distinct temporal keyframes of ONE character performing the requested local action. Exact layout: 4 columns × 2 rows, 1536×768 canvas, eight 384×384 square cells in reading order, equal cell spacing, no gutters or visible grid.'
      : 'Create exactly ONE polished, commercially usable messenger sticker illustration on a genuinely transparent background.',
    animated
      ? 'Every cell has the same camera, scale, baseline, framing and character identity. Keep head/body/bag/feet and all unrequested parts pixel-aligned and stationary. Draw real anatomically plausible limb-joint and wrist articulation in each pose: no whole-character translation, rotation, zoom, squash or stretching. No captions, labels, numbered cells, text, watermark, border or shadows behind the canvas. Complete body visible with generous transparent padding in every cell.'
      : 'Square composition, crisp clean contours, complete body fully visible, generous 10% padding; no crop, sheet, border, watermark, labels, or typography.',
    'Preserve the reference character identity, anatomy, signature colors, face markings and illustration style consistently.',
    `Character: ${p.characterName}. Concept: ${p.concept}. Personality: ${p.personality}. Audience: ${p.audience}.`,
    `Set-wide nuance (never replace the slot-specific pose/action with this same action in every sticker): ${p.actionPrompt}.`,
    `Creative direction: ${p.direction?.title || ''}. ${p.direction?.description || ''}. Keywords: ${p.direction?.tags.join(', ') || ''}.`,
    payload.stickerId
      ? `${animated ? 'Input image 1 is the CURRENT SINGLE-FRAME POSTER. Preserve its exact placement, scale and body pose so the selected action region aligns.' : 'Use the first reference as the current sticker.'} ${payload.previousSheetUrl ? 'Input image 2 is the CURRENT 4×2 EIGHT-POSE TIMELINE SHEET TO REVISE, not a character identity reference. Interpret user frame numbers using the visible-review-frame mapping below, not atlas reading order. Apply the correction to the mapped atlas cell(s) while retaining the other poses and timing; return a complete corrected 4×2 sheet. Any additional image is only the original character identity reference.' : 'Any additional image is only the original character identity reference.'} Preserve identity and intended emotion. User correction: ${payload.feedback || 'Create the requested natural local animation.'}.`
      : `Emotion: ${plan.emotion}. Starting pose: ${plan.posePrompt}. Directional note: ${p.direction?.prompts[index % (p.direction?.prompts.length || 1)] || ''}.`,
    ...(animated
      ? [
          payload.previousTimeline
            ? `Existing visible review timeline (both review-frame and atlas-cell numbers are 1-based): ${payload.previousTimeline.sequence.map((cell, index) => `review frame ${index + 1} → atlas cell ${cell + 1} (${payload.previousTimeline!.delaysMs[index]}ms)`).join('; ')}. The user's frame numbers refer to REVIEW FRAMES. Repeated atlas cells are the same pose shown at multiple times; a correction to such a cell must remain consistent at all its repeated occurrences. Preserve all eight atlas positions and this exact playback order and timing.`
            : '',
          `Requested local action: ${actionFor(payload, index)}. Depict 8 progressive, visibly different hand-drawn poses; ease into the action and return naturally towards the starting pose for a seamless loop. Changes must arise from the requested body part, never moving the entire image.`,
          payload.region
            ? `Only animate this normalized region of EACH square cell: x=${payload.region.x}, y=${payload.region.y}, width=${payload.region.width}, height=${payload.region.height}. Everything outside remains identical to the first cell.`
            : 'Keep all unrequested parts fixed, including the character silhouette outside the moving part. No camera movement.',
        ]
      : []),
  ].join('\n');
}

export class JobQueue {
  private active = new Map<string, AbortController>();
  private scheduled: NodeJS.Immediate | null = null;
  private stopped = false;
  private tasks = new Set<Promise<void>>();
  constructor(
    private store: Store,
    private options: GenerationOptions,
  ) {
    const interrupted = store.all("SELECT * FROM jobs WHERE status IN ('queued', 'running')");
    for (const job of interrupted) {
      store.transaction(() => {
        const payload = JSON.parse(job.payload_json) as JobPayload;
        const project = store.one('SELECT * FROM projects WHERE id = ?', job.project_id)!;
        const fullySaved =
          job.completed >= job.total &&
          (Boolean(payload.stickerId) ||
            store.project(project).stickerCount >= project.target_count);
        if (fullySaved) {
          store.run(
            "UPDATE jobs SET status = 'completed', error = NULL, updated_at = ? WHERE id = ?",
            now(),
            job.id,
          );
          this.restoreProjectStatus(job.project_id);
          store.activity(
            job.project_id,
            'generation_recovered',
            '이미 저장을 마친 생성 결과를 복구했어요. 검수를 이어갈 수 있어요.',
          );
          return;
        }
        store.settleUsage(job.id, true);
        store.run(
          "UPDATE jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?",
          '서버가 재시작되어 작업이 중단됐습니다. 저장된 결과는 보존되었으며 다시 시도할 수 있습니다.',
          now(),
          job.id,
        );
        this.restoreProjectStatus(job.project_id);
        store.activity(
          job.project_id,
          'generation_failed',
          '서버 재시작으로 진행 중인 생성이 중단되었어요. 저장된 이미지는 보존했어요.',
        );
      });
    }
  }
  kick() {
    if (this.stopped || this.scheduled) return;
    this.scheduled = setImmediate(() => {
      this.scheduled = null;
      this.pump();
    });
  }
  private pump() {
    if (this.stopped) return;
    while (this.active.size < this.options.maxConcurrentJobs) {
      const job = this.store.one(
        "SELECT * FROM jobs WHERE status = 'queued' ORDER BY rowid LIMIT 1",
      );
      if (!job) break;
      const controller = new AbortController();
      this.active.set(job.id, controller);
      this.store.run(
        "UPDATE jobs SET status = 'running', updated_at = ? WHERE id = ?",
        now(),
        job.id,
      );
      const task = this.run(job, controller.signal).finally(() => {
        this.active.delete(job.id);
        this.tasks.delete(task);
        this.kick();
      });
      this.tasks.add(task);
    }
  }
  private restoreProjectStatus(projectId: string) {
    const count = this.store.one(
      'SELECT COUNT(*) AS n FROM stickers WHERE project_id = ?',
      projectId,
    )!.n;
    this.store.run(
      'UPDATE projects SET status = ?, updated_at = ? WHERE id = ?',
      count > 0 ? 'review' : 'direction',
      now(),
      projectId,
    );
  }
  private async liveImage(
    payload: JobPayload,
    prompt: string,
    signal: AbortSignal,
    createdAssets: string[],
  ): Promise<string | Buffer> {
    if (!this.options.openaiApiKey) throw new Error('실제 생성 API가 설정되지 않았습니다.');
    const form = new FormData();
    form.set('model', this.options.imageModel);
    form.set('prompt', prompt);
    form.set('size', payload.project.format === 'animated' ? '1536x768' : '1024x1024');
    form.set('quality', 'high');
    form.set('background', 'transparent');
    form.set('output_format', 'png');
    form.set('n', '1');
    const references: { url: string; kind: 'poster' | 'sheet' | 'identity' }[] = [];
    if (payload.previousImage) references.push({ url: payload.previousImage, kind: 'poster' });
    if (payload.previousSheetUrl) references.push({ url: payload.previousSheetUrl, kind: 'sheet' });
    if (
      payload.project.referenceUrl &&
      !references.some((r) => r.url === payload.project.referenceUrl)
    )
      references.push({ url: payload.project.referenceUrl, kind: 'identity' });
    let response: Response;
    const options = {
      headers: { Authorization: `Bearer ${this.options.openaiApiKey}` },
      signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]),
    };
    if (references.length) {
      for (const [index, reference] of references.entries()) {
        const { url, kind } = reference;
        const isAtlas = this.store.one(
          "SELECT id FROM versions WHERE json_extract(animation_json, '$.sheetUrl') = ? OR (animation_json IS NOT NULL AND clean_image_url = ?) LIMIT 1",
          url,
          url,
        );
        const isOwnedRevisionSheet =
          (kind === 'sheet' || (kind === 'poster' && payload.previousImageGrid)) &&
          payload.stickerId &&
          this.store.one(
            "SELECT v.id FROM versions v JOIN stickers s ON s.id = v.sticker_id JOIN projects p ON p.id = s.project_id WHERE v.sticker_id = ? AND p.id = ? AND p.user_id = ? AND (json_extract(v.animation_json, '$.sheetUrl') = ? OR v.clean_image_url = ?) LIMIT 1",
            payload.stickerId,
            payload.project.id,
            payload.userId,
            url,
            url,
          );
        if (isAtlas && !isOwnedRevisionSheet)
          throw new Error('이미지 생성 참조에는 프레임 시트 대신 캐릭터 원본 PNG가 필요합니다.');
        let buffer = await readFile(
          resolveImageFile(url, this.options.publicDir, this.options.assetsDir),
        );
        if (kind === 'poster' && payload.previousImageGrid) {
          const grid = payload.previousImageGrid;
          const meta = await sharp(buffer).metadata();
          const width = Math.floor(meta.width! / grid.columns),
            height = Math.floor(meta.height! / grid.rows);
          buffer = await sharp(buffer)
            .extract({
              left: (grid.cellIndex % grid.columns) * width,
              top: Math.floor(grid.cellIndex / grid.columns) * height,
              width,
              height,
            })
            .png()
            .toBuffer();
        }
        form.append(
          'image[]',
          new Blob([new Uint8Array(buffer)], { type: 'image/png' }),
          `reference-${index}.png`,
        );
      }
      response = await (this.options.fetchImpl || fetch)('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        body: form,
        ...options,
      });
    } else {
      response = await (this.options.fetchImpl || fetch)(
        'https://api.openai.com/v1/images/generations',
        {
          method: 'POST',
          body: JSON.stringify(
            Object.fromEntries([...form.entries()].map(([k, v]) => [k, k === 'n' ? 1 : v])),
          ),
          ...options,
          headers: { ...options.headers, 'Content-Type': 'application/json' },
        },
      );
    }
    if (!response.ok) {
      const failure = (await response.json().catch(() => ({}))) as { error?: { code?: string } };
      if (response.status === 429)
        throw new Error(
          '이미지 제공자의 사용량 또는 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.',
        );
      if (response.status === 401 || response.status === 403)
        throw new Error('이미지 제공자 인증 또는 모델 접근 권한을 확인해 주세요.');
      if (failure.error?.code === 'moderation_blocked')
        throw new Error('이미지 제공자가 요청을 거절했습니다. 컨셉이나 수정 내용을 확인해 주세요.');
      throw new Error(
        `이미지 제공자 요청이 실패했습니다 (HTTP ${response.status}). 다시 시도해 주세요.`,
      );
    }
    const result = (await response.json()) as { data?: { b64_json?: string }[] };
    const base64 = result.data?.[0]?.b64_json;
    if (!base64 || base64.length > 40_000_000)
      throw new Error('이미지 제공자가 유효한 이미지를 반환하지 않았습니다.');
    const buffer = Buffer.from(base64, 'base64');
    const image = sharp(buffer, { limitInputPixels: 25_000_000, failOn: 'error' });
    const metadata = await image.metadata();
    const stats = await image.stats();
    if (!metadata.hasAlpha || stats.isOpaque)
      throw new Error(
        '이미지 제공자가 투명 배경이 없는 이미지를 반환했습니다. 투명 PNG로 다시 생성해 주세요.',
      );
    if (payload.project.format === 'animated') {
      if (
        !metadata.width ||
        !metadata.height ||
        metadata.width !== metadata.height * 2 ||
        metadata.width % 4 ||
        metadata.height % 2
      )
        throw new Error(
          '이미지 제공자가 올바른 4×2 프레임 시트를 반환하지 않았습니다. 동작을 다시 생성해 주세요.',
        );
      return buffer;
    }
    return buffer;
  }
  private async mediaFor(
    input: string | Buffer,
    payload: JobPayload,
    createdAssets: string[],
    index: number,
    nativeOptions?: FrameAnimationOptions,
  ): Promise<VersionMedia> {
    const buffer =
      typeof input === 'string'
        ? await readFile(resolveImageFile(input, this.options.publicDir, this.options.assetsDir))
        : input;
    const plan = stickerPlan(index);
    const caption =
      payload.caption !== undefined
        ? payload.caption
        : payload.captionOnly || payload.project.captionsEnabled
          ? plan.caption
          : null;
    const save = (data: Buffer, extension: 'png' | 'webp' | 'gif') =>
      writeEncodedAsset(
        this.store,
        this.options.assetsDir,
        payload.userId,
        data,
        extension,
        payload.project.id,
        createdAssets,
      );
    let hash = payload.previousHash || null;
    if (!payload.captionOnly) {
      const raw = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      hash = createHash('sha256')
        .update(`${raw.info.width}x${raw.info.height}:`)
        .update(raw.data)
        .digest('hex');
      if (
        payload.provider === 'openai' &&
        this.store.one(
          'SELECT v.id FROM versions v JOIN stickers s ON s.id = v.sticker_id WHERE s.project_id = ? AND v.image_hash = ? AND s.id != ? LIMIT 1',
          payload.project.id,
          hash,
          payload.stickerId || '',
        )
      )
        throw new Error(
          '이미지 제공자가 이미 생성한 포즈와 동일한 이미지를 반환했습니다. 중복 결과를 저장하지 않았습니다. 다른 포즈로 다시 시도해 주세요.',
        );
    }
    if (payload.project.format !== 'animated') {
      const cleanImageUrl = payload.captionOnly
        ? payload.cleanImageUrl!
        : await writeAsset(
            this.store,
            this.options.assetsDir,
            payload.userId,
            buffer,
            payload.project.id,
            createdAssets,
          );
      const imageUrl = caption
        ? await save(await applyCaption(buffer, caption), 'png')
        : cleanImageUrl;
      return {
        ...staticMedia(imageUrl),
        cleanImageUrl,
        sourceUrl: payload.originalSourceUrl || cleanImageUrl,
        caption,
        poseId: payload.poseId || plan.id,
        imageHash: hash,
      };
    }
    const frameOptions: FrameAnimationOptions = payload.captionOnly
      ? {
          columns: 4,
          rows: 2,
          padding: 0,
          region: null,
          registerFrames: false,
          sequence: payload.previousTimeline?.sequence,
          delaysMs: payload.previousTimeline?.delaysMs,
        }
      : nativeOptions || {
          columns: 4,
          rows: 2,
          region: payload.region || null,
          sequence: payload.previousTimeline?.sequence,
          delaysMs: payload.previousTimeline?.delaysMs,
        };
    const rendered = await renderFrameAnimation(buffer, {
      ...frameOptions,
      caption: caption || undefined,
      durationMs: payload.previousTimeline?.delaysMs.reduce((sum, delay) => sum + delay, 0) || 2000,
    });
    const cleanImageUrl = payload.captionOnly
      ? payload.cleanImageUrl!
      : await save(rendered.cleanSheet, 'png');
    const sheetUrl = caption ? await save(rendered.sheet, 'png') : cleanImageUrl;
    const posterUrl = await save(rendered.poster, 'png');
    const imageUrl = await save(rendered.webp, 'webp');
    const gifUrl = await save(rendered.gif, 'gif');
    const sourceUrl =
      payload.originalSourceUrl ||
      payload.project.referenceUrl ||
      (await save(rendered.cleanPoster, 'png'));
    return {
      imageUrl,
      posterUrl,
      sourceUrl,
      cleanImageUrl,
      caption,
      poseId: payload.poseId || plan.id,
      imageHash: hash,
      gifUrl,
      motionPreset: null,
      frameCount: rendered.frameCount,
      durationMs: rendered.durationMs,
      animation: {
        kind: 'frames',
        sheetUrl,
        columns: rendered.columns,
        rows: rendered.rows,
        frameWidth: rendered.frameWidth,
        frameHeight: rendered.frameHeight,
        frameCount: rendered.frameCount,
        sequence: rendered.sequence,
        delaysMs: rendered.delaysMs,
        actionPrompt:
          payload.provider === 'sample' && !payload.captionOnly
            ? plan.actionPrompt
            : actionFor(payload, index),
        region: payload.captionOnly
          ? payload.captionRegion || null
          : nativeOptions
            ? null
            : payload.region || null,
        warnings: rendered.warnings,
      },
    };
  }
  private async discardUncommittedAssets(urls: string[]) {
    const filenames: string[] = [];
    this.store.transaction(() => {
      for (const url of urls) {
        const referenced =
          this.store.one(
            "SELECT id FROM versions WHERE image_url = ? OR poster_url = ? OR source_url = ? OR gif_url = ? OR json_extract(animation_json, '$.sheetUrl') = ? OR clean_image_url = ? LIMIT 1",
            url,
            url,
            url,
            url,
            url,
            url,
          ) ||
          this.store.one('SELECT id FROM projects WHERE reference_url = ? LIMIT 1', url) ||
          this.store.one('SELECT id FROM concepts WHERE reference_url = ? LIMIT 1', url);
        if (!referenced) {
          const filename = path.basename(url);
          this.store.run('DELETE FROM assets WHERE filename = ?', filename);
          filenames.push(filename);
        }
      }
    });
    await Promise.allSettled(
      filenames.map((filename) => unlink(path.join(this.options.assetsDir, filename))),
    );
  }
  private async run(job: Row, signal: AbortSignal) {
    const payload = JSON.parse(job.payload_json) as JobPayload;
    try {
      // Reuse the first single-character PNG; a sprite sheet must never become an identity reference.
      if (
        payload.provider === 'openai' &&
        !payload.stickerId &&
        !payload.project.referenceUrl &&
        payload.startIndex > 0
      ) {
        payload.project.referenceUrl =
          this.store.one(
            'SELECT v.source_url AS source_url FROM stickers s JOIN versions v ON v.sticker_id = s.id AND v.version = 1 WHERE s.project_id = ? ORDER BY s.sort_order LIMIT 1',
            job.project_id,
          )?.source_url || null;
      }
      for (let i = 0; i < job.total; i++) {
        if (signal.aborted) throw new Error('작업이 중단됐습니다. 저장된 이미지는 보존되었어요.');
        const createdAssets: string[] = [];
        try {
          const index = payload.startIndex + i;
          const prompt = makePrompt(payload, index);
          let input: string | Buffer;
          let nativeOptions: FrameAnimationOptions | undefined;
          const expectedCaption =
            payload.caption !== undefined
              ? payload.caption
              : payload.captionOnly || payload.project.captionsEnabled
                ? stickerPlan(index).caption
                : null;
          const slots =
            payload.project.format === 'animated'
              ? (payload.captionOnly ? 3 : 4) +
                (expectedCaption ? 1 : 0) +
                (!payload.originalSourceUrl && !payload.project.referenceUrl ? 1 : 0)
              : payload.captionOnly
                ? expectedCaption
                  ? 1
                  : 0
                : expectedCaption
                  ? 2
                  : 1;
          checkAssetCapacity(this.store, payload.userId, slots);
          if (payload.captionOnly) {
            if (!payload.cleanImageUrl) throw new Error('이미지 생성 원본을 찾을 수 없습니다.');
            input = payload.cleanImageUrl;
          } else if (payload.provider === 'sample') {
            const character = payload.project.builtinCharacter || 'neulbo';
            if (payload.project.format === 'animated') {
              const result = await renderCharacterSticker(character, index, {
                animated: true,
                variant: payload.variant || 0,
              });
              input = result.sheet;
              nativeOptions = result.options;
            } else
              input = (
                await renderCharacterSticker(character, index, {
                  animated: false,
                  variant: payload.variant || 0,
                })
              ).png;
          } else {
            this.store.run('UPDATE jobs SET attempted = attempted + 1 WHERE id = ?', job.id);
            input = await this.liveImage(payload, prompt, signal, createdAssets);
          }
          if (signal.aborted) throw new Error('작업이 중단됐습니다. 저장된 이미지는 보존되었어요.');
          const media = await this.mediaFor(input, payload, createdAssets, index, nativeOptions);
          if (signal.aborted) throw new Error('작업이 중단됐습니다. 저장된 이미지는 보존되었어요.');
          this.store.transaction(() => {
            const storedPrompt = payload.captionOnly
              ? `${payload.previousPrompt || ''}\n대사만 재합성: ${media.caption || '대사 없음'}. 깨끗한 원본에서 다시 합성했으며 AI 요청은 하지 않았습니다.`
              : payload.provider === 'sample'
                ? `준비된 ${payload.project.builtinCharacter === 'tokki' ? '토끼' : '늘보군'} 캐릭터의 독립 프리셋 포즈: ${stickerPlan(index).title} (${stickerPlan(index).id}). ${payload.project.builtinCharacter ? '' : '입력한 임의 캐릭터를 그린 결과가 아니라 늘보군으로 미리보는 예제입니다. '}프리셋 표정·자세 변주 ${payload.variant || 0}. 자유 입력 컨셉·수정 문장을 AI로 해석한 결과가 아닙니다.`
                : prompt;
            if (payload.stickerId) {
              const version =
                Number(
                  this.store.one(
                    'SELECT MAX(version) AS max FROM versions WHERE sticker_id = ?',
                    payload.stickerId,
                  )!.max,
                ) + 1;
              this.store.addVersion(
                payload.stickerId,
                version,
                media!,
                storedPrompt,
                payload.feedback || null,
                payload.provider,
              );
              this.store.run(
                "UPDATE stickers SET current_version = ?, status = 'pending', feedback = NULL WHERE id = ?",
                version,
                payload.stickerId,
              );
            } else {
              const plan = stickerPlan(index);
              const title = plan.title;
              this.store.addSticker(
                job.project_id,
                index,
                title,
                plan.emotion,
                media!.imageUrl,
                storedPrompt,
                payload.provider,
                media,
              );
            }
            this.store.run(
              'UPDATE jobs SET completed = ?, updated_at = ? WHERE id = ?',
              i + 1,
              now(),
              job.id,
            );
            this.store.run(
              'UPDATE projects SET updated_at = ? WHERE id = ?',
              now(),
              job.project_id,
            );
          });
          if (payload.provider === 'openai' && !payload.stickerId && !payload.project.referenceUrl)
            payload.project.referenceUrl = media.sourceUrl;
        } catch (error) {
          await this.discardUncommittedAssets(createdAssets);
          throw error;
        }
      }
      this.store.transaction(() => {
        this.store.run(
          "UPDATE jobs SET status = 'completed', updated_at = ? WHERE id = ?",
          now(),
          job.id,
        );
        this.restoreProjectStatus(job.project_id);
        this.store.activity(
          job.project_id,
          payload.stickerId ? 'revised' : 'generated',
          payload.captionOnly
            ? '깨끗한 원본에 대사를 다시 합성했어요. 새 버전을 검수해 주세요.'
            : payload.provider === 'sample'
              ? payload.stickerId
                ? '원래 포즈의 프리셋 표정·자세 변주를 만들었어요. 자유 수정 문장을 해석한 AI 결과는 아니에요.'
                : `준비된 ${payload.project.builtinCharacter === 'tokki' ? '토끼' : '늘보군'} 캐릭터로 ${job.total}개의 서로 다른 프리셋 포즈를 만들었어요. 자유 입력 컨셉을 해석한 AI 결과는 아니에요.`
              : payload.stickerId
                ? '수정 요청을 반영한 새 버전을 생성했어요. 다시 검수해 주세요.'
                : `${job.total}개의 서로 다른 포즈와 동작을 생성했어요. 캐릭터 일관성과 개별 동작을 검수해 주세요.`,
        );
      });
    } catch (error) {
      const message = signal.aborted
        ? '서버 종료로 작업이 중단되었습니다. 저장된 결과는 보존되었어요.'
        : error instanceof Error &&
            ((error as NodeJS.ErrnoException).code === 'ENOSPC' ||
              /database or disk is full/i.test(error.message))
          ? '이미지 저장 공간이 부족합니다. 저장 공간을 확보한 뒤 다시 시도해 주세요. 이전 이미지와 수정 의견은 보존했어요.'
          : error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
            ? '이미지 생성 응답 시간이 초과됐습니다. 저장된 결과를 확인하고 다시 시도해 주세요.'
            : error instanceof Error && error.message.startsWith('ENOENT')
              ? '샘플 또는 참조 이미지 파일을 찾을 수 없습니다. 서버 파일을 확인해 주세요.'
              : error instanceof Error &&
                  /^(이미지 제공자|이미지 생성|이미지 저장|실제 생성|작업이 중단|프레임 시트|프레임 간|프레임 사이|움직이는 영역|동작 프레임)/.test(
                    error.message,
                  )
                ? error.message.slice(0, 240)
                : '이미지를 처리하는 중 오류가 발생했습니다. 저장된 결과를 확인하고 다시 시도해 주세요.';
      this.store.transaction(() => {
        this.store.settleUsage(job.id);
        this.store.run(
          "UPDATE jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?",
          message,
          now(),
          job.id,
        );
        this.restoreProjectStatus(job.project_id);
        this.store.activity(job.project_id, 'generation_failed', message);
      });
    }
  }
  async close() {
    this.stopped = true;
    if (this.scheduled) clearImmediate(this.scheduled);
    for (const controller of this.active.values()) controller.abort();
    await Promise.allSettled([...this.tasks]);
  }
}
