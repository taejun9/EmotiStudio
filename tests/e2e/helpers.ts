import { expect, type Page } from '@playwright/test';
import type { CharacterConcept, ProjectDetail } from '../../shared/types.ts';

export async function openSeed(page: Page) {
  await page.getByRole('button', { name: '늘보군 컨셉 열기', exact: true }).click();
  await page.getByRole('button', { name: '늘보군의 느긋한 하루 세트 열기', exact: true }).click();
}
export async function createConcept(
  page: Page,
  name: string,
  character: '늘보군' | '토끼찬구' = '늘보군',
) {
  await page.getByRole('button', { name: '새 캐릭터 컨셉', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: character, exact: true }).check();
  await dialog.getByLabel('컨셉 이름', { exact: true }).fill(name);
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/api/concepts') && r.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: '캐릭터 컨셉 만들기', exact: true }).click();
  const concept = (await (await response).json()) as CharacterConcept;
  await expect(dialog).toBeHidden();
  return concept;
}
export async function createSet(
  page: Page,
  name: string,
  format: 'static' | 'animated' = 'static',
  caption = false,
) {
  await page.getByRole('button', { name: '새 세트 추가', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('세트 이름', { exact: true }).fill(name);
  await dialog
    .getByRole('radio', {
      name: format === 'animated' ? '움직이는 이모티콘 24개' : '정지 이모티콘 32개',
      exact: true,
    })
    .check();
  await dialog.getByRole('checkbox', { name: /상황에 맞는 대사 넣기/ }).setChecked(caption);
  const response = page.waitForResponse(
    (r) => /\/api\/concepts\/[^/]+\/projects$/.test(r.url()) && r.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: '세트 만들기', exact: true }).click();
  const project = (await (await response).json()) as ProjectDetail;
  await expect(dialog).toBeHidden();
  return project;
}
