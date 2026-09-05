export interface Environment {
  apiPort: number;
  databaseUrl: string;
  redisUrl: string;
  s3Endpoint: string;
}

export function loadEnvironment(
  source: Record<string, string | undefined>,
): Environment {
  const databaseUrl = requiredUrl(source, 'DATABASE_URL');
  const redisUrl = requiredUrl(source, 'REDIS_URL');
  const s3Endpoint = requiredUrl(source, 'S3_ENDPOINT');
  const apiPort = parsePort(source.PORT ?? '3000');

  return { apiPort, databaseUrl, redisUrl, s3Endpoint };
}

function requiredUrl(
  source: Record<string, string | undefined>,
  name: 'DATABASE_URL' | 'REDIS_URL' | 'S3_ENDPOINT',
): string {
  const value = source[name]?.trim();
  if (!value) throw new Error(`${name} is required`);

  try {
    new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }

  return value;
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  return port;
}
