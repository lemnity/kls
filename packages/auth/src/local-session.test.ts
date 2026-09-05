import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { hashPassword } from './password.js';
import {
  LocalPasswordAuthService,
  type LocalAuthRepository,
} from './local-session.js';

describe('LocalPasswordAuthService', () => {
  it('creates a hashed opaque session token for one active membership', async () => {
    const repository = new MemoryAuthRepository({
      email: 'admin@example.test',
      passwordHash: await hashPassword('correct horse battery staple'),
      memberships: [activeMembership],
    });
    const service = new LocalPasswordAuthService({
      repository,
      sessionTtlMs: 60 * 60 * 1000,
      now: () => new Date('2026-09-03T12:00:00.000Z'),
    });

    const result = await service.login({
      email: ' ADMIN@example.test ',
      password: 'correct horse battery staple',
    });

    expect(result).toMatchObject({
      accessToken: expect.any(String),
      expiresAt: new Date('2026-09-03T13:00:00.000Z'),
    });
    expect(repository.createdSessions).toHaveLength(1);
    expect(repository.createdSessions[0]!.tokenHash).toBe(
      sha256(result!.accessToken),
    );
    expect(repository.createdSessions[0]!.tokenHash).not.toBe(result!.accessToken);
  });

  it('rejects login when credentials are invalid or tenant selection is ambiguous', async () => {
    const repository = new MemoryAuthRepository({
      email: 'admin@example.test',
      passwordHash: await hashPassword('correct horse battery staple'),
      memberships: [activeMembership, { ...activeMembership, id: 'membership-b', tenantId: 'tenant-b' }],
    });
    const service = new LocalPasswordAuthService({ repository });

    await expect(
      service.login({ email: 'admin@example.test', password: 'wrong password' }),
    ).resolves.toBeNull();
    await expect(
      service.login({
        email: 'admin@example.test',
        password: 'correct horse battery staple',
      }),
    ).resolves.toBeNull();
    expect(repository.createdSessions).toEqual([]);
  });

  it('authenticates only an active, unexpired stored session', async () => {
    const repository = new MemoryAuthRepository({
      email: 'admin@example.test',
      passwordHash: await hashPassword('correct horse battery staple'),
      memberships: [activeMembership],
    });
    const service = new LocalPasswordAuthService({ repository });
    const login = await service.login({
      email: 'admin@example.test',
      password: 'correct horse battery staple',
    });

    await expect(service.authenticate(login!.accessToken)).resolves.toEqual({
      userId: 'user-a',
      membership: activeMembership,
    });
    await expect(service.authenticate('unknown-token')).resolves.toBeNull();
  });
});

const activeMembership = {
  id: 'membership-a',
  tenantId: 'tenant-a',
  userId: 'user-a',
  isActive: true,
};

class MemoryAuthRepository implements LocalAuthRepository {
  public readonly createdSessions: Array<{
    membershipId: string;
    tokenHash: string;
    expiresAt: Date;
  }> = [];

  public constructor(
    private readonly credential: {
      email: string;
      passwordHash: string;
      memberships: typeof activeMembership[];
    },
  ) {}

  public async findCredentialByEmail(email: string) {
    return email === this.credential.email ? this.credential : null;
  }

  public async createSession(input: {
    membershipId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    this.createdSessions.push(input);
  }

  public async findVerifiedSession(tokenHash: string) {
    const session = this.createdSessions.find((item) => item.tokenHash === tokenHash);
    return session
      ? { userId: activeMembership.userId, membership: activeMembership }
      : null;
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
