import { describe, expect, it } from 'vitest';

import { createReadinessProbes } from './readiness.js';

describe('createReadinessProbes', () => {
  it('checks PostgreSQL, Redis and MinIO from validated service URLs', async () => {
    const calls: string[] = [];
    const probes = createReadinessProbes(
      {
        databaseUrl: 'postgresql://europa:secret@localhost:5434/europa',
        redisUrl: 'redis://localhost:6380',
        s3Endpoint: 'http://localhost:9002',
      },
      {
        checkPostgres: async (url) => {
          calls.push(`postgres:${url}`);
        },
        checkRedis: async (url) => {
          calls.push(`redis:${url}`);
        },
        checkMinio: async (url) => {
          calls.push(`minio:${url}`);
        },
      },
    );

    await expect(Promise.all(probes.map((probe) => probe.check()))).resolves.toEqual(
      [true, true, true],
    );
    expect(calls).toEqual([
      'postgres:postgresql://europa:secret@localhost:5434/europa',
      'redis:redis://localhost:6380',
      'minio:http://localhost:9002',
    ]);
  });

  it('returns false when a dependency check fails', async () => {
    const probes = createReadinessProbes(
      {
        databaseUrl: 'postgresql://europa:secret@localhost:5434/europa',
        redisUrl: 'redis://localhost:6380',
        s3Endpoint: 'http://localhost:9002',
      },
      {
        checkPostgres: async () => undefined,
        checkRedis: async () => {
          throw new Error('unavailable');
        },
        checkMinio: async () => undefined,
      },
    );

    await expect(probes[1]?.check()).resolves.toBe(false);
  });
});
