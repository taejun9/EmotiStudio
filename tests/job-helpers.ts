import { setTimeout } from 'node:timers/promises';
import type request from 'supertest';
import type { ProjectDetail } from '../shared/types.ts';

export async function waitForJob(
  client: ReturnType<typeof request.agent>,
  projectId: string,
  timeoutMs = 60_000,
): Promise<ProjectDetail & { job: NonNullable<ProjectDetail['job']> }> {
  const deadline = performance.now() + timeoutMs;
  let lastJob: ProjectDetail['job'] = null;
  while (performance.now() < deadline) {
    const remaining = Math.max(1, Math.ceil(deadline - performance.now()));
    const { body } = await client
      .get(`/api/projects/${projectId}`)
      .timeout({ response: Math.min(5_000, remaining), deadline: remaining })
      .expect(200);
    const project = body as ProjectDetail;
    lastJob = project.job;
    if (lastJob && !['queued', 'running'].includes(lastJob.status))
      return { ...project, job: lastJob };
    await setTimeout(Math.min(100, Math.max(0, deadline - performance.now())));
  }
  throw new Error(
    `Project ${projectId} job did not settle within ${timeoutMs}ms: ${JSON.stringify(lastJob ?? null)}`,
  );
}
