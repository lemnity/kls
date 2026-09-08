import {
  createTenantContext,
  TenantAccessDeniedError,
  type MembershipIdentity,
  type TenantContext,
} from '@kulisa/domain/tenant-context';
import {
  PermissionDeniedError,
  requirePermission,
  type PermissionResolver,
} from '@kulisa/domain/permission-authorizer';

export interface VerifiedSession {
  userId: string;
  membership: MembershipIdentity;
}

export interface SessionAuthenticator {
  authenticate(accessToken: string): Promise<VerifiedSession | null>;
}

export class SessionAuthenticationError extends Error {
  public constructor(message = 'Authentication required') {
    super(message);
    this.name = 'SessionAuthenticationError';
  }
}

export class SessionAuthorizationError extends Error {
  public constructor() {
    super('Permission denied');
    this.name = 'SessionAuthorizationError';
  }
}

function extractBearerToken(authorization: string | undefined): string {
  const matched = authorization?.match(/^Bearer ([^\s]+)$/i);
  const accessToken = matched?.[1];
  if (!accessToken) {
    throw new SessionAuthenticationError();
  }

  return accessToken;
}

export async function authenticateRequest(input: {
  authorization: string | undefined;
  requestId: string;
  authenticator: SessionAuthenticator;
}): Promise<TenantContext> {
  const session = await input.authenticator.authenticate(
    extractBearerToken(input.authorization),
  );
  if (!session) {
    throw new SessionAuthenticationError();
  }

  try {
    return createTenantContext({
      requestId: input.requestId,
      userId: session.userId,
      membership: session.membership,
    });
  } catch (error) {
    if (error instanceof TenantAccessDeniedError) {
      throw new SessionAuthenticationError('Session is no longer valid');
    }

    throw error;
  }
}

export async function authorizeRequest(input: {
  authorization: string | undefined;
  requestId: string;
  authenticator: SessionAuthenticator;
  permission: string;
  resolver: PermissionResolver;
}): Promise<TenantContext> {
  const context = await authenticateRequest(input);

  try {
    await requirePermission(context, input.permission, input.resolver);
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      throw new SessionAuthorizationError();
    }

    throw error;
  }

  return context;
}
