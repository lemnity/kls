import { describe, expect, it } from 'vitest';

import { loadEnvironment } from './environment.js';

describe('loadEnvironment', () => {
  it('loads required service URLs and defaults API port', () => {
    expect(loadEnvironment({
      DATABASE_URL: 'postgresql://user:secret@db:5432/europa',
      REDIS_URL: 'redis://redis:6379',
      S3_ENDPOINT: 'http://minio:9000',
      S3_REGION: 'us-east-1',
      S3_ACCESS_KEY: 'access',
      S3_SECRET_KEY: 'secret',
      S3_BUCKET: 'kulisa-assets',
    })).toEqual({
      apiPort: 3000,
      databaseUrl: 'postgresql://user:secret@db:5432/europa',
      redisUrl: 'redis://redis:6379',
      s3Endpoint: 'http://minio:9000',
      s3Region: 'us-east-1',
      s3AccessKey: 'access',
      s3SecretKey: 'secret',
      s3Bucket: 'kulisa-assets',
    });
  });

  it('rejects a missing required URL', () => {
    expect(() => loadEnvironment({
      DATABASE_URL: '',
      REDIS_URL: 'redis://redis:6379',
      S3_ENDPOINT: 'http://minio:9000',
      S3_REGION: 'us-east-1',
      S3_ACCESS_KEY: 'access',
      S3_SECRET_KEY: 'secret',
      S3_BUCKET: 'kulisa-assets',
    })).toThrow('DATABASE_URL is required');
  });

  it('rejects a missing S3 bucket', () => {
    expect(() => loadEnvironment({
      DATABASE_URL: 'postgresql://user:secret@db:5432/europa',
      REDIS_URL: 'redis://redis:6379',
      S3_ENDPOINT: 'http://minio:9000',
      S3_REGION: 'us-east-1',
      S3_ACCESS_KEY: 'access',
      S3_SECRET_KEY: 'secret',
      S3_BUCKET: '',
    })).toThrow('S3_BUCKET is required');
  });
});
