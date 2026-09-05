import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const keyLength = 64;
const saltLength = 16;
const workFactor = 16_384;
const blockSize = 8;
const parallelization = 1;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(saltLength);
  const derivedKey = await derive(password, salt);

  return [
    'scrypt',
    workFactor,
    blockSize,
    parallelization,
    salt.toString('base64url'),
    derivedKey.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  const parts = encodedHash.split('$');
  if (
    parts.length !== 6 ||
    parts[0] !== 'scrypt' ||
    parts[1] !== String(workFactor) ||
    parts[2] !== String(blockSize) ||
    parts[3] !== String(parallelization)
  ) {
    return false;
  }

  try {
    const salt = Buffer.from(parts[4]!, 'base64url');
    const expected = Buffer.from(parts[5]!, 'base64url');
    if (salt.length !== saltLength || expected.length !== keyLength) return false;

    const actual = await derive(password, salt);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

async function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      keyLength,
      { N: workFactor, r: blockSize, p: parallelization },
      (error, derivedKey) => (error ? reject(error) : resolve(derivedKey)),
    );
  });
}
