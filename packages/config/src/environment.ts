export interface Environment {
  apiPort: number;
  databaseUrl: string;
  redisUrl: string;
  s3Endpoint: string;
  s3Region: string;
  s3AccessKey: string;
  s3SecretKey: string;
  s3Bucket: string;
}

export function loadEnvironment(
  source: Record<string, string | undefined>,
): Environment {
  const databaseUrl = requiredUrl(source, 'DATABASE_URL');
  const redisUrl = requiredUrl(source, 'REDIS_URL');
  const s3Endpoint = requiredUrl(source, 'S3_ENDPOINT');
  const s3Region = requiredValue(source, 'S3_REGION');
  const s3AccessKey = requiredValue(source, 'S3_ACCESS_KEY');
  const s3SecretKey = requiredValue(source, 'S3_SECRET_KEY');
  const s3Bucket = requiredValue(source, 'S3_BUCKET');
  const apiPort = parsePort(source.PORT ?? '3000');

  return { apiPort, databaseUrl, redisUrl, s3Endpoint, s3Region, s3AccessKey, s3SecretKey, s3Bucket };
}

function requiredUrl(
  source: Record<string, string | undefined>,
  name: 'DATABASE_URL' | 'REDIS_URL' | 'S3_ENDPOINT',
): string {
  const value = requiredValue(source, name);

  try {
    new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }

  return value;
}

function requiredValue(
  source: Record<string, string | undefined>,
  name: 'DATABASE_URL' | 'REDIS_URL' | 'S3_ENDPOINT' | 'S3_REGION' | 'S3_ACCESS_KEY' | 'S3_SECRET_KEY' | 'S3_BUCKET',
): string {
  const value = source[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  return port;
}
