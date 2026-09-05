import { createConnection } from 'node:net';

import { Client } from 'pg';

import type { ReadinessProbe } from './app.js';

export interface ServiceUrls {
  databaseUrl: string;
  redisUrl: string;
  s3Endpoint: string;
}

interface ReadinessDependencies {
  checkPostgres(url: string): Promise<void>;
  checkRedis(url: string): Promise<void>;
  checkMinio(url: string): Promise<void>;
}

const defaultDependencies: ReadinessDependencies = {
  checkPostgres: async (url) => {
    const client = new Client({ connectionString: url });
    try {
      await client.connect();
      await client.query('SELECT 1');
    } finally {
      await client.end();
    }
  },
  checkRedis: async (url) => {
    const endpoint = new URL(url);
    await new Promise<void>((resolve, reject) => {
      const socket = createConnection({
        host: endpoint.hostname,
        port: Number(endpoint.port || '6379'),
      });
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error('Redis readiness timeout'));
      }, 2_000);

      socket.once('connect', () => socket.write('*1\r\n$4\r\nPING\r\n'));
      socket.once('data', (data: Buffer) => {
        clearTimeout(timeout);
        socket.end();
        data.toString() === '+PONG\r\n'
          ? resolve()
          : reject(new Error('Redis readiness ping failed'));
      });
      socket.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  },
  checkMinio: async (url) => {
    const response = await fetch(new URL('/minio/health/ready', url));
    if (!response.ok) throw new Error('MinIO readiness check failed');
  },
};

export function createReadinessProbes(
  urls: ServiceUrls,
  dependencies: ReadinessDependencies = defaultDependencies,
): readonly ReadinessProbe[] {
  return [
    asProbe('postgres', () => dependencies.checkPostgres(urls.databaseUrl)),
    asProbe('redis', () => dependencies.checkRedis(urls.redisUrl)),
    asProbe('minio', () => dependencies.checkMinio(urls.s3Endpoint)),
  ];
}

function asProbe(name: string, check: () => Promise<void>): ReadinessProbe {
  return {
    name,
    async check(): Promise<boolean> {
      try {
        await check();
        return true;
      } catch {
        return false;
      }
    },
  };
}
