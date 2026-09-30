import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { openSeed } from './helpers.ts';

async function createConcept(page: Page, name: string, uploadReference = false) {
  await page.getByRole('button', { name: '새 캐릭터 컨셉', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: /^컨셉 이름/ }).fill(name);
  await dialog.getByRole('textbox', { name: /^캐릭터 이름/ }).fill('늘보군');
  await dialog
    .getByRole('textbox', { name: /^캐릭터 컨셉/ })
    .fill('언제나 느긋하고 다정한 베이지색 나무늘보. 크림색 얼굴과 초록 크로스백이 특징이에요.');
  if (uploadReference) {
    await dialog
      .getByLabel('참고 이미지', { exact: true })
      .setInputFiles(path.resolve('public/samples/hello.png'));
    await expect(dialog.getByRole('img', { name: '캐릭터 참고 이미지 미리보기' })).toBeVisible();
  }
  await dialog.getByRole('button', { name: '캐릭터 컨셉 만들기', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

test('guest projects and private references survive registration, logout and existing-account login', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const firstProject = `늘보군 보관 테스트 ${suffix}`;
  const laterProject = `로그인 전 새 이야기 ${suffix}`;
  const email = `studio-browser-${suffix}@example.com`;
  const password = 'Browser-regression-2026!';
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await createConcept(page, firstProject, true);
  await page.getByRole('button', { name: '작업 보관하기', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('이름', { exact: true }).fill('늘보군 테스트 작가');
  await dialog.getByLabel('이메일', { exact: true }).fill(email);
  await dialog.getByLabel('비밀번호', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: '계정 만들고 작업 보관하기', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole('button', { name: `${firstProject} 컨셉 열기`, exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: '설정', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '로그아웃', exact: true }).click();
  await expect(page.getByRole('button', { name: '작업 보관하기', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: `${firstProject} 컨셉 열기`, exact: true }),
  ).toHaveCount(0);

  // A returning author may create work before logging in. That new guest work
  // must join the existing account instead of losing its only session.
  await createConcept(page, laterProject, true);
  await page.getByRole('button', { name: '작업 보관하기', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '로그인', exact: true }).click();
  await dialog.getByLabel('이메일', { exact: true }).fill(email);
  await dialog.getByLabel('비밀번호', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: '로그인', exact: true }).last().click();
  await expect(dialog).toBeHidden();

  for (const projectName of [firstProject, laterProject]) {
    await expect(
      page.getByRole('button', { name: `${projectName} 컨셉 열기`, exact: true }),
    ).toBeVisible();
  }
  await page.reload();
  for (const projectName of [firstProject, laterProject]) {
    await page.getByRole('button', { name: `${projectName} 컨셉 열기`, exact: true }).click();
    await expect(page.getByRole('heading', { name: projectName, exact: true })).toBeVisible();
    const reference = page.getByRole('img', { name: '늘보군', exact: true });
    await expect(reference).toHaveAttribute('src', /^\/api\/assets\//);
    await expect
      .poll(() =>
        reference.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
      )
      .toBe(true);
    await page.getByRole('button', { name: '내 작업실', exact: true }).click();
  }
  expect(pageErrors).toEqual([]);
});

test('sticker name, revision feedback, image versions and restoration persist through browser reload', async ({
  page,
}) => {
  const renamed = '다정하게 인사하는 늘보';
  const feedback = '눈웃음을 조금 더 크게 표현해 주세요. 이 의견이 버전 기록에 보관되어야 해요.';
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/');
  await openSeed(page);
  await page.getByRole('button', { name: '느긋한 인사 검수', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '이모티콘 검수', exact: true });
  const originalImage = await dialog
    .getByRole('img', { name: '느긋한 인사', exact: true })
    .getAttribute('src');
  await dialog.getByLabel('이모티콘 이름', { exact: true }).fill(renamed);
  await dialog.getByRole('button', { name: '이름 저장', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '이름 저장', exact: true })).toBeHidden();
  await expect(dialog.getByRole('img', { name: renamed, exact: true })).toHaveAttribute(
    'src',
    originalImage!,
  );
  await dialog.getByLabel('수정 의견', { exact: true }).fill(feedback);
  await dialog.getByRole('combobox', { name: '수정 방식', exact: true }).selectOption('sample');
  await dialog.getByRole('button', { name: '다른 포즈로 수정', exact: true }).click();
  await expect(dialog).toBeHidden();
  const stickerCard = page.getByRole('button', { name: `${renamed} 검수`, exact: true });
  await expect(stickerCard).toBeEnabled();
  await stickerCard.click();
  dialog = page.getByRole('dialog', { name: '이모티콘 검수', exact: true });
  await expect(dialog.getByText('v2', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('img', { name: renamed, exact: true })).not.toHaveAttribute(
    'src',
    originalImage!,
  );
  await dialog.getByRole('button', { name: /^버전 기록/ }).click();
  await expect(dialog.getByText(feedback, { exact: true })).toBeVisible();
  await expect(dialog.getByRole('img', { name: '버전 1', exact: true })).toBeVisible();
  await expect(dialog.getByRole('img', { name: '버전 2', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '복원', exact: true }).click();
  await expect(dialog.getByText('v1', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('img', { name: renamed, exact: true })).toHaveAttribute(
    'src',
    originalImage!,
  );
  await dialog.getByRole('button', { name: '닫기', exact: true }).click();

  await page.reload();
  await openSeed(page);
  await page.getByRole('button', { name: `${renamed} 검수`, exact: true }).click();
  dialog = page.getByRole('dialog', { name: '이모티콘 검수', exact: true });
  await expect(dialog.getByLabel('이모티콘 이름', { exact: true })).toHaveValue(renamed);
  await expect(dialog.getByText('v1', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('img', { name: renamed, exact: true })).toHaveAttribute(
    'src',
    originalImage!,
  );
  await dialog.getByRole('button', { name: /^버전 기록/ }).click();
  await expect(dialog.getByText(feedback, { exact: true })).toBeVisible();
  await expect(dialog.getByRole('img', { name: '버전 2', exact: true })).toBeVisible();
  expect(pageErrors).toEqual([]);
});
