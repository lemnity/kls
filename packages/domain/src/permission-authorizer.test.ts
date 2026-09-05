import { describe, expect, it } from 'vitest';

import {
  PermissionDeniedError,
  requirePermission,
  type PermissionResolver,
} from './permission-authorizer.js';

const context = {
  requestId: 'request-1',
  userId: 'user-1',
  membershipId: 'membership-1',
  tenantId: 'tenant-a',
};

describe('requirePermission', () => {
  it('allows an explicitly granted permission', async () => {
    const resolver: PermissionResolver = { hasPermission: async () => true };

    await expect(
      requirePermission(context, 'production.create', resolver),
    ).resolves.toBeUndefined();
  });

  it('denies an absent permission', async () => {
    const resolver: PermissionResolver = { hasPermission: async () => false };

    await expect(
      requirePermission(context, 'production.create', resolver),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('denies when permission resolution fails', async () => {
    const resolver: PermissionResolver = {
      hasPermission: async () => {
        throw new Error('database unavailable');
      },
    };

    await expect(
      requirePermission(context, 'production.create', resolver),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});
