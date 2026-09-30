import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createConcept, createSet } from './helpers.ts';
import AxeBuilder from '@axe-core/playwright';
import type { ProjectDetail } from '../../shared/types.ts';

test('animated 24-piece set supports pose-frame review, action history, reload and GIF export', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await createConcept(page, '토끼찬구의 다정한 일상', '토끼찬구');
  const project = await createSet(page, '토끼찬구의 움직이는 하루', 'animated', true);
  let dialog = page.getByRole('dialog');
  expect(project.format).toBe('animated');
  expect(project.targetCount).toBe(24);
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: /직접 입력하기/ }).click();
  await page
    .getByLabel('원하는 방향', { exact: true })
    .fill('늘보군의 따뜻한 인사와 응원을 담은 포근한 일상.');
  await page.getByRole('button', { name: '이 방향 선택', exact: true }).click();
  await page.getByRole('button', { name: '이모티콘 생성', exact: true }).click();
  const detail = async () =>
    (await (await page.request.get(`/api/projects/${project.id}`)).json()) as ProjectDetail;
  await expect
    .poll(async () => (await detail()).job?.status, { timeout: 120_000 })
    .toBe('completed');
  await expect(page.getByRole('button', { name: / 검수$/ })).toHaveCount(24);
  let saved = await detail();
  expect(
    saved.stickers.every(
      (sticker) => sticker.imageUrl.endsWith('.webp') && sticker.gifUrl?.endsWith('.gif'),
    ),
  ).toBe(true);
  expect(new Set(saved.stickers.map((s) => s.poseId)).size).toBe(24);
  expect(saved.stickers.every((s) => s.caption && s.animation && s.animation.frameCount > 1)).toBe(
    true,
  );
  const hashes = new Set<string>();
  for (const sticker of saved.stickers)
    hashes.add(
      createHash('sha256')
        .update(await (await page.request.get(sticker.imageUrl)).body())
        .digest('hex'),
    );
  expect(hashes.size).toBe(24);
  const unaffected = saved.stickers.slice(1).map((s) => [s.id, s.currentVersion, s.imageUrl]);
  const first = saved.stickers[0]!;
  const review = page.getByRole('button', { name: `${first.title} 검수`, exact: true }).first();
  await review.click();
  dialog = page.getByRole('dialog', { name: '이모티콘 검수', exact: true });
  expect(first.animation?.kind).toBe('frames');
  expect(first.motionPreset).toBeNull();
  const slider = dialog.getByRole('slider', { name: '프레임 선택', exact: true });
  await expect(slider).toBeEnabled();
  await dialog.getByRole('button', { name: '3번 프레임 보기', exact: true }).click();
  await expect(slider).toHaveValue('2');
  await expect(
    dialog.getByRole('img', { name: `${first.title} 프레임 3`, exact: true }),
  ).toHaveAttribute('data-frame', String(first.animation!.sequence[2]));
  await expect(
    dialog.getByRole('button', { name: `${first.title} 재생`, exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
  await dialog.getByRole('button', { name: '다음 프레임', exact: true }).click();
  await expect(slider).toHaveValue('3');
  await dialog.getByRole('button', { name: '이전 프레임', exact: true }).click();
  await expect(slider).toHaveValue('2');
  await slider.press('Home');
  await expect(slider).toHaveValue('0');
  await dialog.getByRole('button', { name: `${first.title} 재생`, exact: true }).click();
  await expect(
    dialog.getByRole('button', { name: `${first.title} 일시정지`, exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: `${first.title} 일시정지`, exact: true }).click();
  const pausedAt = await slider.inputValue();
  await page.waitForTimeout(300);
  await expect(slider).toHaveValue(pausedAt);
  await dialog.getByRole('button', { name: '첫·마지막 프레임 비교', exact: true }).click();
  await expect(dialog.getByRole('img', { name: '첫 프레임', exact: true })).toBeVisible();
  await expect(dialog.getByRole('img', { name: '마지막 프레임', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/animation-editor.png' });
  await expect(dialog.getByRole('textbox', { name: '원하는 동작', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '프리셋 동작 적용', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(async () => (await detail()).stickers[0]?.currentVersion, { timeout: 30_000 })
    .toBe(2);
  await expect(review).toBeEnabled();
  await review.click();
  await expect(dialog.getByText('v2', { exact: true })).toBeVisible();
  saved = await detail();
  expect(saved.stickers.slice(1).map((s) => [s.id, s.currentVersion, s.imageUrl])).toEqual(
    unaffected,
  );
  expect(saved.stickers[0]?.motionPreset).toBeNull();
  expect(saved.stickers[0]?.animation?.kind).toBe('frames');
  expect(saved.stickers[0]?.versions[0]?.sourceUrl).toBe(first.versions[0]?.sourceUrl);
  await dialog.getByRole('button', { name: /^버전 기록/ }).click();
  await dialog.getByRole('button', { name: '복원', exact: true }).click();
  await expect(dialog.getByText('v1', { exact: true })).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(
    dialog.getByRole('button', { name: `${first.title} 재생`, exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await page.screenshot({ path: 'test-results/animation-editor-mobile.png' });
  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    accessibility.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => ({ target: node.target, summary: node.failureSummary })),
    })),
  ).toEqual([]);
  await dialog.getByRole('button', { name: '닫기', exact: true }).click();

  await page.reload();
  await page.getByRole('button', { name: '토끼찬구의 다정한 일상 컨셉 열기', exact: true }).click();
  await page
    .getByRole('button', { name: '토끼찬구의 움직이는 하루 세트 열기', exact: true })
    .click();
  await expect(page.getByRole('button', { name: / 검수$/ })).toHaveCount(24);
  await expect(page.getByRole('img', { name: first.title, exact: true }).first()).toHaveAttribute(
    'src',
    first.posterUrl,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await page.getByRole('button', { name: '전체 승인', exact: true }).click();
  const approveConfirm = page
    .getByRole('dialog')
    .getByRole('button', { name: /전체 승인|승인하기/ });
  if (await approveConfirm.isVisible().catch(() => false)) await approveConfirm.click();
  await page.getByRole('button', { name: '검수 완료', exact: true }).click();
  const completeConfirm = page
    .getByRole('dialog')
    .getByRole('button', { name: /완료하기|검수 완료/ });
  if (await completeConfirm.isVisible().catch(() => false)) await completeConfirm.click();
  await page.getByRole('button', { name: '다운로드', exact: true }).first().click();
  await page.getByLabel('애니메이션 형식', { exact: true }).selectOption('gif');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'ZIP 다운로드', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('gif-360px.zip');
  expect(await download.failure()).toBeNull();
  expect((await detail()).approvedCount).toBe(24);
  expect(errors).toEqual([]);
});

test('AI action editor sends bounded regions and preserves feedback after a failed request', async ({
  page,
}) => {
  // Exercise the editing UI without making a paid provider call.
  await page.route('**/api/bootstrap', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.capabilities.liveGeneration = true;
    await route.fulfill({ response, json: body });
  });
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: '새 캐릭터 컨셉', exact: true }).first(),
  ).toBeVisible();
  const created = await page.request.post('/api/projects', {
    data: {
      name: '늘보군 부위 동작 검수',
      characterName: '늘보군',
      concept: '가방을 멘 나무늘보의 다정한 손 인사',
      format: 'animated',
    },
  });
  expect(created.status()).toBe(201);
  const project = (await created.json()) as ProjectDetail;
  await page.request.put(`/api/projects/${project.id}/direction`, {
    data: {
      direction: {
        id: 'wave',
        title: '다정한 인사',
        description: '손과 손목의 작은 인사',
        tags: ['인사'],
        color: '#A8BC94',
        prompts: ['손을 흔들어요'],
      },
    },
  });
  expect(
    (
      await page.request.post(`/api/projects/${project.id}/generate`, {
        data: { provider: 'sample' },
      })
    ).status(),
  ).toBe(202);
  const detail = async () =>
    (await (await page.request.get(`/api/projects/${project.id}`)).json()) as ProjectDetail;
  await expect
    .poll(async () => (await detail()).job?.status, { timeout: 30_000 })
    .toBe('completed');
  const first = (await detail()).stickers[0]!;
  await page.reload();
  await page
    .getByRole('button', { name: '늘보군 컨셉 열기', exact: true })
    .filter({ hasText: '24개 이모티콘' })
    .click();
  await page.getByRole('button', { name: '늘보군 부위 동작 검수 세트 열기', exact: true }).click();
  await page
    .getByRole('button', { name: `${first.title} 검수`, exact: true })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: '이모티콘 검수', exact: true });
  await dialog.getByLabel('동작 생성 방식', { exact: true }).selectOption('openai');
  await dialog.getByRole('button', { name: '눈 깜빡임', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: '원하는 동작', exact: true })).toHaveValue(
    /눈꺼풀/,
  );
  await dialog.getByRole('button', { name: '움직일 영역 확인', exact: true }).click();
  const canvas = dialog.getByRole('group', { name: '움직일 영역 미리보기', exact: true });
  await canvas.focus();
  await canvas.press('ArrowRight');
  await dialog.getByRole('button', { name: '좌표로 영역 조정', exact: true }).click();
  await expect(dialog.getByLabel('가로 위치 (%)', { exact: true })).toHaveValue('25');
  // Drag into the bottom/right edge: the rectangle must still fit inside the canvas.
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width * 0.995, box!.y + box!.height * 0.995);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width, box!.y + box!.height);
  await page.mouse.up();
  const action = '몸과 고개는 고정하고 눈꺼풀만 닫았다 열어요.';
  await dialog.getByRole('textbox', { name: '원하는 동작', exact: true }).fill(action);
  let sent:
    | {
        provider: string;
        actionPrompt: string;
        region: { x: number; y: number; width: number; height: number };
      }
    | undefined;
  await page.route(`**/api/projects/${project.id}/stickers/${first.id}/animate`, async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({ status: 503, json: { error: '테스트: 잠시 후 다시 시도해 주세요.' } });
  });
  await dialog.getByRole('button', { name: '동작 만들기', exact: true }).click();
  await expect(
    dialog.getByText('테스트: 잠시 후 다시 시도해 주세요.', { exact: true }),
  ).toBeVisible();
  expect(sent?.provider).toBe('openai');
  expect(sent?.actionPrompt).toBe(action);
  expect(sent!.region.x + sent!.region.width).toBeLessThanOrEqual(1.000001);
  expect(sent!.region.y + sent!.region.height).toBeLessThanOrEqual(1.000001);
  await expect(dialog.getByRole('textbox', { name: '원하는 동작', exact: true })).toHaveValue(
    action,
  );
  let revision: { provider: string; feedback: string } | undefined;
  await page.route(`**/api/projects/${project.id}/stickers/${first.id}/revise`, async (route) => {
    revision = route.request().postDataJSON();
    await route.fulfill({ status: 503, json: { error: '테스트: 수정 연결을 확인해 주세요.' } });
  });
  await dialog
    .getByRole('textbox', { name: '수정 의견', exact: true })
    .fill('세 번째 프레임의 손가락 연결을 자연스럽게 고쳐주세요.');
  await dialog.getByRole('button', { name: '의견 반영해 수정', exact: true }).click();
  await expect(
    dialog.getByText('테스트: 수정 연결을 확인해 주세요.', { exact: true }),
  ).toBeVisible();
  expect(revision?.provider).toBe('openai');
  expect(revision?.feedback).toContain('세 번째 프레임');
  await expect(dialog.getByRole('textbox', { name: '수정 의견', exact: true })).toHaveValue(
    revision!.feedback,
  );
});
