import { describe, expect, it } from 'vitest';

import {
  TenantAccessDeniedError,
  assertTenantAccess,
  createTenantContext,
} from './tenant-context.js';

describe('tenant context', () => {
  it('creates a context only when membership belongs to the requested tenant', () => {
    const context = createTenantContext({
      requestId: 'request-1',
      userId: 'user-1',
      membership: {
        id: 'membership-1',
        tenantId: 'tenant-a',
        userId: 'user-1',
        isActive: true,
      },
    });

    expect(context).toEqual({
      requestId: 'request-1',
      userId: 'user-1',
      membershipId: 'membership-1',
      tenantId: 'tenant-a',
    });
  });

  it('rejects access to a record from another tenant', () => {
    const context = createTenantContext({
      requestId: 'request-1',
      userId: 'user-1',
      membership: {
        id: 'membership-1',
        tenantId: 'tenant-a',
        userId: 'user-1',
        isActive: true,
      },
    });

    expect(() => assertTenantAccess(context, 'tenant-b')).toThrow(
      TenantAccessDeniedError,
    );
  });

  it('rejects an inactive membership', () => {
    expect(() =>
      createTenantContext({
        requestId: 'request-1',
        userId: 'user-1',
        membership: {
          id: 'membership-1',
          tenantId: 'tenant-a',
          userId: 'user-1',
          isActive: false,
        },
      }),
    ).toThrow(TenantAccessDeniedError);
  });
});
