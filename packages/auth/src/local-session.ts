import { createHash, randomBytes } from 'node:crypto';

import type { MembershipIdentity } from '@europa/domain/tenant-context';

import { verifyPassword } from './password.js';

const defaultSessionTtlMs = 8 * 60 * 60 * 1000;

export interface LocalAuthRepository {
  findCredentialByEmail(email: string): Promise<{
    passwordHash: string;
    memberships: readonly MembershipIdentity[];
  } | null>;
  createSession(input: {
    membershipId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void>;
  findVerifiedSession(tokenHash: string): Promise<{
    userId: string;
    membership: MembershipIdentity;
  } | null>;
}

export interface LocalPasswordAuthServiceOptions {
  repository: LocalAuthRepository;
  sessionTtlMs?: number;
  now?: () => Date;
}

export class LocalPasswordAuthService {
  private readonly sessionTtlMs: number;
  private readonly now: () => Date;

  public constructor(private readonly options: LocalPasswordAuthServiceOptions) {
    this.sessionTtlMs = options.sessionTtlMs ?? defaultSessionTtlMs;
    this.now = options.now ?? (() => new Date());
  }

  public async login(input: {
    email: string;
    password: string;
  }): Promise<{ accessToken: string; expiresAt: Date } | null> {
    const email = normalizeEmail(input.email);
    if (!email || !input.password) return null;

    const credential = await this.options.repository.findCredentialByEmail(email);
    if (!credential || !(await verifyPassword(input.password, credential.passwordHash))) {
      return null;
    }

    const memberships = credential.memberships.filter(
      (membership) => membership.isActive,
    );
    if (memberships.length !== 1) return null;

    const accessToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(this.now().getTime() + this.sessionTtlMs);
    await this.options.repository.createSession({
      membershipId: memberships[0]!.id,
      tokenHash: hashAccessToken(accessToken),
      expiresAt,
    });

    return { accessToken, expiresAt };
  }

  public authenticate(accessToken: string): Promise<{
    userId: string;
    membership: MembershipIdentity;
  } | null> {
    if (!accessToken) return Promise.resolve(null);
    return this.options.repository.findVerifiedSession(hashAccessToken(accessToken));
  }
}

function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  return email.includes('@') ? email : null;
}

function hashAccessToken(accessToken: string): string {
  return createHash('sha256').update(accessToken).digest('hex');
}
