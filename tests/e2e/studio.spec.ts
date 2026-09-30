import { test, expect } from '@playwright/test';
import { openSeed, createConcept, createSet } from './helpers.ts';

test('studio loads cleanly, preserves work on reload and allows review to export', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/');
  await expect(page.getByText('EmotiStudio').first()).toBeVisible();
  await expect(page.getByRole('button', { name: '늘보군 컨셉 열기', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/studio-desktop.png', fullPage: true });
  await openSeed(page);
  await expect(page.getByRole('button', { name: '전체 승인', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '전체 승인', exact: true }).click();
  // Confirmation is optional; the action always ends in six approved stickers.
  const confirm = page.getByRole('dialog').getByRole('button', { name: /전체 승인|승인하기/ });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await expect(page.getByRole('button', { name: '검수 완료', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '검수 완료', exact: true }).click();
  const finishConfirm = page
    .getByRole('dialog')
    .getByRole('button', { name: /완료하기|검수 완료/ });
  if (await finishConfirm.isVisible().catch(() => false)) await finishConfirm.click();
  await expect(page.getByRole('button', { name: /다운로드/ }).first()).toBeVisible();
  await page.getByRole('button', { name: '다운로드', exact: true }).first().click();
  await page.getByLabel('이미지 크기', { exact: true }).selectOption('720');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'ZIP 다운로드', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('720px.zip');
  expect(await download.failure()).toBeNull();
  await page.reload();
  await expect(page.getByRole('button', { name: '늘보군 컨셉 열기', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('new concept and custom direction survive reload', async ({ page }) => {
  await page.goto('/');
  await createConcept(page, '늘보군 브라우저 컨셉');
  await createSet(page, '늘보군 브라우저 테스트');
  await expect(page.getByText('늘보군 브라우저 테스트').first()).toBeVisible();
  await page.getByRole('button', { name: /직접 입력하기/ }).click();
  await page
    .getByLabel('원하는 방향', { exact: true })
    .fill('느긋하고 다정한 늘보군의 퇴근 후 소소한 하루를 포근한 색감으로 표현해 주세요.');
  await page.getByRole('button', { name: '이 방향 선택', exact: true }).click();
  await expect(page.getByText('선택한 방향').first()).toBeVisible();
  await page.getByRole('button', { name: '이모티콘 생성', exact: true }).click();
  await expect(page.getByRole('button', { name: '전체 승인', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: / 검수$/ })).toHaveCount(32);
  await page.reload();
  await page.getByRole('button', { name: '늘보군 브라우저 컨셉 컨셉 열기', exact: true }).click();
  await page.getByRole('button', { name: '늘보군 브라우저 테스트 세트 열기', exact: true }).click();
  await expect(page.getByRole('button', { name: / 검수$/ })).toHaveCount(32);
  await expect(page.getByText('내가 정한 방향').first()).toBeVisible();
});

test('mobile layout has no horizontal overflow and navigation works', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /반가워요/ })).toBeVisible();
  await expect(page.getByRole('button', { name: '늘보군 컨셉 열기', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await openSeed(page);
  await expect(page.getByRole('button', { name: '전체 승인', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('a failed save keeps the typed concept and can be retried', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '새 캐릭터 컨셉', exact: true }).first().click();
  await page.getByLabel(/^컨셉 이름/).fill('저장 재시도 테스트');
  await page.getByLabel(/^캐릭터 이름/).fill('늘보군');
  await page.getByLabel(/^캐릭터 컨셉/).fill('느긋하고 따뜻한 나무늘보 캐릭터');
  await page.route('**/api/concepts', async (route) => {
    if (route.request().method() === 'POST')
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: '테스트용 일시적인 연결 오류' }),
      });
    else await route.continue();
  });
  await page.getByRole('button', { name: '캐릭터 컨셉 만들기', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('일시적인 연결 오류');
  await expect(page.getByLabel(/^캐릭터 컨셉/)).toHaveValue('느긋하고 따뜻한 나무늘보 캐릭터');
  await page.unroute('**/api/concepts');
  await page.getByRole('button', { name: '캐릭터 컨셉 만들기', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '저장 재시도 테스트', exact: true }),
  ).toBeVisible();
});
