import { describe, expect, it } from 'vitest';

import { createRoleRepository } from './role-repository.js';

const context = { requestId: 'r', userId: 'u', membershipId: 'm', tenantId: 'tenant-a' };

describe('role repository', () => {
  it('scopes role reads and writes to TenantContext', async () => {
    const calls: unknown[] = [];
    const repository = createRoleRepository({
      role: {
        async findUnique(args: unknown) { calls.push(args); return null; },
        async create(args: unknown) { calls.push(args); return {}; },
      },
    });

    await repository.findById(context, 'role-1');
    await repository.create(context, { name: 'producer' });

    expect(calls).toEqual([
      { where: { tenantId_id: { tenantId: 'tenant-a', id: 'role-1' } } },
      { data: { tenantId: 'tenant-a', name: 'producer' } },
    ]);
  });
});
