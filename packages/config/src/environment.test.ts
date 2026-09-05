import { describe, expect, it } from 'vitest';

import { loadEnvironment } from './environment.js';

describe('loadEnvironment', () => {
  it('loads required service URLs and defaults API port', () => {
    expect(loadEnvironment({
      DATABASE_URL: 'postgresql://user:secret@db:5432/europa',
      REDIS_URL: 'redis://redis:6379',
      S3_ENDPOINT: 'http://minio:9000',
    })).toEqual({
      apiPort: 3000,
      databaseUrl: 'postgresql://user:secret@db:5432/europa',
      redisUrl: 'redis://redis:6379',
      s3Endpoint: 'http://minio:9000',
    });
  });

  it('rejects a missing required URL', () => {
    expect(() => loadEnvironment({
      DATABASE_URL: '', REDIS_URL: 'redis://redis:6379', S3_ENDPOINT: 'http://minio:9000',
    })).toThrow('DATABASE_URL is required');
  });
});
