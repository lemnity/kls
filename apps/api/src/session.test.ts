import { describe, expect, it } from 'vitest';
import {
  SessionAuthenticationError,
  SessionAuthorizationError,
  authorizeRequest,
  authenticateRequest,
  type SessionAuthenticator,
} from './session.js';
import type { PermissionResolver } from '@kulisa/domain/permission-authorizer';

const authenticator: SessionAuthenticator = {
  async authenticate(accessToken) {
    if (accessToken !== 'valid-access-token') {
      return null;
    }

    return {
      userId: 'user-1',
      membership: {
        id: 'membership-1',
        tenantId: 'tenant-a',
        userId: 'user-1',
        isActive: true,
      },
    };
  },
};

describe('authenticateRequest', () => {
  it('creates tenant context from the verified membership, not request input', async () => {
    await expect(
      authenticateRequest({
        authorization: 'Bearer valid-access-token',
        requestId: 'request-1',
        authenticator,
      }),
    ).resolves.toEqual({
      requestId: 'request-1',
      userId: 'user-1',
      membershipId: 'membership-1',
      tenantId: 'tenant-a',
    });
  });

  it('rejects a missing bearer token', async () => {
    await expect(
      authenticateRequest({
        authorization: undefined,
        requestId: 'request-1',
        authenticator,
      }),
    ).rejects.toBeInstanceOf(SessionAuthenticationError);
  });

  it('rejects a token whose verified session is unavailable', async () => {
    await expect(
      authenticateRequest({
        authorization: 'Bearer invalid-access-token',
        requestId: 'request-1',
        authenticator,
      }),
    ).rejects.toBeInstanceOf(SessionAuthenticationError);
  });

  it('rejects an inactive membership returned by an authenticator', async () => {
    const inactiveAuthenticator: SessionAuthenticator = {
      async authenticate() {
        return {
          userId: 'user-1',
          membership: {
            id: 'membership-1',
            tenantId: 'tenant-a',
            userId: 'user-1',
            isActive: false,
          },
        };
      },
    };

    await expect(
      authenticateRequest({
        authorization: 'Bearer valid-access-token',
        requestId: 'request-1',
        authenticator: inactiveAuthenticator,
      }),
    ).rejects.toBeInstanceOf(SessionAuthenticationError);
  });

  it('rejects a membership that belongs to another user', async () => {
    const mismatchedAuthenticator: SessionAuthenticator = {
      async authenticate() {
        return {
          userId: 'user-1',
          membership: {
            id: 'membership-2',
            tenantId: 'tenant-a',
            userId: 'user-2',
            isActive: true,
          },
        };
      },
    };

    await expect(
      authenticateRequest({
        authorization: 'Bearer valid-access-token',
        requestId: 'request-1',
        authenticator: mismatchedAuthenticator,
      }),
    ).rejects.toBeInstanceOf(SessionAuthenticationError);
  });
});

describe('authorizeRequest', () => {
  it('returns context only when the verified membership has the required permission', async () => {
    const resolver: PermissionResolver = {
      async hasPermission(context, permission) {
        return context.tenantId === 'tenant-a' && permission === 'platform.admin';
      },
    };

    await expect(
      authorizeRequest({
        authorization: 'Bearer valid-access-token',
        requestId: 'request-1',
        authenticator,
        permission: 'platform.admin',
        resolver,
      }),
    ).resolves.toMatchObject({ tenantId: 'tenant-a', membershipId: 'membership-1' });
  });

  it('fails closed when permission is missing', async () => {
    const resolver: PermissionResolver = { async hasPermission() { return false; } };

    await expect(
      authorizeRequest({
        authorization: 'Bearer valid-access-token',
        requestId: 'request-1',
        authenticator,
        permission: 'platform.admin',
        resolver,
      }),
    ).rejects.toBeInstanceOf(SessionAuthorizationError);
  });
});
