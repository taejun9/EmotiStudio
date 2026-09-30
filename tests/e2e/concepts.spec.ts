import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { createConcept, createSet } from './helpers.ts';
import type { ProjectDetail } from '../../shared/types.ts';

test('rabbit concept groups sets, has 32 distinct scenes, and edits only one sticker with reversible dark-mode captions', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const concept = await createConcept(page, '토끼찬구의 다정한 하루', '토끼찬구');
  const project = await createSet(page, '토끼찬구의 32가지 마음', 'static', false);
  await page.getByRole('button', { name: /직접 입력하기/ }).click();
  await page
    .getByLabel('원하는 방향', { exact: true })
    .fill('장난기 많고 다정한 토끼찬구의 소소한 하루, 민트 스카프와 당근 가방을 유지해요.');
  await page.getByRole('button', { name: '이 방향 선택', exact: true }).click();
  await page.getByRole('button', { name: '이모티콘 생성', exact: true }).click();
  const detail = async () =>
    (await (await page.request.get(`/api/projects/${project.id}`)).json()) as ProjectDetail;
  await expect
    .poll(async () => (await detail()).job?.status, { timeout: 60_000 })
    .toBe('completed');
  await expect(page.getByRole('button', { name: / 검수$/ })).toHaveCount(32);
  let saved = await detail();
  expect(saved.conceptId).toBe(concept.id);
  expect(saved.stickers.every((s) => s.caption === null)).toBe(true);
  const hashes = new Set<string>();
  for (const sticker of saved.stickers) {
    const image = await page.request.get(sticker.imageUrl);
    expect(image.status()).toBe(200);
    hashes.add(
      createHash('sha256')
        .update(await image.body())
        .digest('hex'),
    );
  }
  expect(hashes.size).toBe(32);
  const target = saved.stickers[13]!;
  const unaffected = saved.stickers
    .filter((s) => s.id !== target.id)
    .map((s) => [s.id, s.currentVersion, s.imageUrl]);
  const original = await (await page.request.get(target.versions[0]!.cleanImageUrl)).body();
  const open = () =>
    page.getByRole('button', { name: `${target.title} 검수`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '이모티콘 검수', exact: true });
  await open();
  await dialog.getByLabel('대사 넣기', { exact: true }).check();
  await dialog.getByLabel('대사 내용', { exact: true }).fill('밥 먹으러 가자!');
  await dialog.getByRole('button', { name: '대사 적용', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await detail()).stickers[13]?.currentVersion).toBe(2);
  await open();
  await dialog.getByRole('button', { name: '어두운 배경', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '어두운 배경', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(dialog.getByLabel('대사 내용', { exact: true })).toHaveValue('밥 먹으러 가자!');
  await page.screenshot({ path: 'test-results/rabbit-caption-dark.png' });
  await dialog.getByLabel('대사 넣기', { exact: true }).uncheck();
  await dialog.getByRole('button', { name: '대사 적용', exact: true }).click();
  await expect.poll(async () => (await detail()).stickers[13]?.currentVersion).toBe(3);
  saved = await detail();
  expect(saved.stickers[13]?.caption).toBeNull();
  expect(
    (await (await page.request.get(saved.stickers[13]!.imageUrl)).body()).equals(original),
  ).toBe(true);
  await open();
  await dialog
    .getByLabel('수정 의견', { exact: true })
    .fill('이 한 장의 표정을 다른 포즈로 바꿔 주세요.');
  await dialog.getByRole('button', { name: '다른 포즈로 수정', exact: true }).click();
  await expect.poll(async () => (await detail()).stickers[13]?.currentVersion).toBe(4);
  saved = await detail();
  expect(saved.stickers[13]?.poseId).toBe(target.poseId);
  expect(
    saved.stickers
      .filter((s) => s.id !== target.id)
      .map((s) => [s.id, s.currentVersion, s.imageUrl]),
  ).toEqual(unaffected);
  expect(
    (await (await page.request.get(saved.stickers[13]!.imageUrl)).body()).equals(original),
  ).toBe(false);
  await page.reload();
  await page.getByRole('button', { name: '토끼찬구의 다정한 하루 컨셉 열기', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '토끼찬구의 32가지 마음 세트 열기', exact: true }),
  ).toBeVisible();
  await createSet(page, '토끼찬구의 작은 움직임', 'animated', true);
  await page.reload();
  await page.getByRole('button', { name: '토끼찬구의 다정한 하루 컨셉 열기', exact: true }).click();
  await expect(page.getByRole('button', { name: / 세트 열기$/ })).toHaveCount(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await page.screenshot({ path: 'test-results/rabbit-concept-mobile.png', fullPage: true });
  const boot = await (await page.request.get('/api/bootstrap')).json();
  expect(boot.concepts.find((c: { id: string }) => c.id === concept.id).projectCount).toBe(2);
  expect(errors).toEqual([]);
});
