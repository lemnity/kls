import { describe, expect, it } from 'vitest';

import { createApiApp } from './app.js';
import type { SessionAuthenticator } from './session.js';
import type { PermissionResolver } from '@europa/domain/permission-authorizer';

describe('API health endpoints', () => {
  it('returns the liveness contract without exposing infrastructure details', async () => {
    const app = await createApiApp();

    try {
      const response = await app.inject({ method: 'GET', url: '/health' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok' });
    } finally {
      await app.close();
    }
  });

  it('returns unavailable when a required dependency probe fails', async () => {
    const app = await createApiApp({
      readinessProbes: [
        { name: 'postgres', check: async () => true },
        { name: 'redis', check: async () => false },
      ],
    });

    try {
      const response = await app.inject({ method: 'GET', url: '/ready' });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ status: 'unavailable' });
    } finally {
      await app.close();
    }
  });

  it('fails closed when readiness probes are not configured', async () => {
    const app = await createApiApp();

    try {
      const response = await app.inject({ method: 'GET', url: '/ready' });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ status: 'unavailable' });
    } finally {
      await app.close();
    }
  });

  it('returns unavailable when a readiness probe throws', async () => {
    const app = await createApiApp({
      readinessProbes: [
        {
          name: 'postgres',
          check: async () => {
            throw new Error('connection refused');
          },
        },
      ],
    });

    try {
      const response = await app.inject({ method: 'GET', url: '/ready' });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ status: 'unavailable' });
    } finally {
      await app.close();
    }
  });

  it('builds a session response from an authenticated membership', async () => {
    const authenticator: SessionAuthenticator = {
      async authenticate(accessToken) {
        return accessToken === 'valid-access-token'
          ? {
              userId: 'user-1',
              membership: {
                id: 'membership-1',
                tenantId: 'tenant-a',
                userId: 'user-1',
                isActive: true,
              },
            }
          : null;
      },
    };
    const app = await createApiApp({ sessionAuthenticator: authenticator });

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/session',
        headers: { authorization: 'Bearer valid-access-token' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        userId: 'user-1',
        membershipId: 'membership-1',
        tenantId: 'tenant-a',
      });
    } finally {
      await app.close();
    }
  });

  it('does not expose a session endpoint without configured authentication', async () => {
    const app = await createApiApp();

    try {
      const response = await app.inject({ method: 'GET', url: '/v1/session' });

      expect(response.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('creates a password-authenticated session without caching the access token', async () => {
    const localPasswordAuthenticator = {
      async login(input: { email: string; password: string }) {
        return input.email === 'admin@example.test' && input.password === 'correct password'
          ? {
              accessToken: 'opaque-access-token',
              expiresAt: new Date('2026-09-03T13:00:00.000Z'),
            }
          : null;
      },
      async authenticate() {
        return null;
      },
    };
    const app = await createApiApp({ localPasswordAuthenticator });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email: 'admin@example.test', password: 'correct password' },
      });

      expect(response.statusCode).toBe(201);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json()).toEqual({
        accessToken: 'opaque-access-token',
        expiresAt: '2026-09-03T13:00:00.000Z',
      });
    } finally {
      await app.close();
    }
  });

  it('protects the admin session endpoint with backend permission authorization', async () => {
    const authenticator: SessionAuthenticator = {
      async authenticate(accessToken) {
        return accessToken === 'valid-access-token'
          ? {
              userId: 'user-1',
              membership: {
                id: 'membership-1',
                tenantId: 'tenant-a',
                userId: 'user-1',
                isActive: true,
              },
            }
          : null;
      },
    };
    const permissionResolver: PermissionResolver = {
      async hasPermission(_, permission) {
        return permission === 'platform.admin';
      },
    };
    const app = await createApiApp({ sessionAuthenticator: authenticator, permissionResolver });
    const deniedApp = await createApiApp({
      sessionAuthenticator: authenticator,
      permissionResolver: { async hasPermission() { return false; } },
    });

    try {
      const allowed = await app.inject({
        method: 'GET',
        url: '/v1/admin/session',
        headers: { authorization: 'Bearer valid-access-token' },
      });
      const denied = await deniedApp.inject({
        method: 'GET',
        url: '/v1/admin/session',
        headers: { authorization: 'Bearer valid-access-token' },
      });

      expect(allowed.statusCode).toBe(200);
      expect(allowed.json()).toMatchObject({ tenantId: 'tenant-a' });
      expect(denied.statusCode).toBe(403);
    } finally {
      await app.close();
      await deniedApp.close();
    }
  });

  it('returns not found and does not rename a role outside the authenticated tenant', async () => {
    const authenticator: SessionAuthenticator = {
      async authenticate() {
        return {
          userId: 'user-a',
          membership: { id: 'membership-a', tenantId: 'tenant-a', userId: 'user-a', isActive: true },
        };
      },
    };
    let renameCalls = 0;
    const app = await createApiApp({
      sessionAuthenticator: authenticator,
      permissionResolver: { async hasPermission() { return true; } },
      roleRepository: {
        async findById(_, roleId) {
          return roleId === 'role-a' ? { id: 'role-a', name: 'admin' } : null;
        },
        async rename(_, roleId, name) {
          renameCalls += 1;
          return roleId === 'role-a' ? { id: 'role-a', name } : null;
        },
      },
    });

    try {
      const read = await app.inject({
        method: 'GET',
        url: '/v1/admin/roles/role-from-tenant-b',
        headers: { authorization: 'Bearer token-a' },
      });
      const rename = await app.inject({
        method: 'PATCH',
        url: '/v1/admin/roles/role-from-tenant-b',
        headers: { authorization: 'Bearer token-a' },
        payload: { name: 'forged name' },
      });
      const ownRead = await app.inject({
        method: 'GET',
        url: '/v1/admin/roles/role-a',
        headers: { authorization: 'Bearer token-a' },
      });
      const ownRename = await app.inject({
        method: 'PATCH',
        url: '/v1/admin/roles/role-a',
        headers: { authorization: 'Bearer token-a' },
        payload: { name: 'producer' },
      });

      expect(read.statusCode).toBe(404);
      expect(rename.statusCode).toBe(404);
      expect(ownRead.statusCode).toBe(200);
      expect(ownRename.statusCode).toBe(200);
      expect(renameCalls).toBe(2);
    } finally {
      await app.close();
    }
  });
});
