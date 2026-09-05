import { describe, expect, it } from 'vitest';

import {
  createMembershipRepository,
  type MembershipPrismaClient,
} from './membership-repository.js';

const context = {
  requestId: 'request-1',
  userId: 'user-1',
  membershipId: 'membership-1',
  tenantId: 'tenant-a',
};

function createClient(
  membership: Partial<MembershipPrismaClient['membership']>,
): MembershipPrismaClient {
  return {
    membership: {
      async findUnique() {
        return null;
      },
      async create() {
        return {};
      },
      async update() {
        return {};
      },
      ...membership,
    },
  };
}

describe('membership repository', () => {
  it('adds the context tenant to a membership lookup', async () => {
    let receivedWhere: unknown;
    const repository = createMembershipRepository(
      createClient({
        async findUnique({ where }: { where: unknown }) {
          receivedWhere = where;
          return null;
        },
      }),
    );

    await repository.findById(context, 'membership-2');

    expect(receivedWhere).toEqual({
      tenantId_id: { tenantId: 'tenant-a', id: 'membership-2' },
    });
  });

  it('sets the context tenant when creating a membership', async () => {
    let receivedData: unknown;
    const repository = createMembershipRepository(
      createClient({
        async create({ data }: { data: unknown }) {
          receivedData = data;
          return {};
        },
      }),
    );

    await repository.create(context, {
      userId: 'user-2',
      roleId: 'role-1',
    });

    expect(receivedData).toEqual({
      tenantId: 'tenant-a',
      userId: 'user-2',
      roleId: 'role-1',
    });
  });

  it('adds the context tenant to a membership deactivation', async () => {
    let receivedArguments: unknown;
    const repository = createMembershipRepository(
      createClient({
        async update({ where, data }: { where: unknown; data: unknown }) {
          receivedArguments = { where, data };
          return {};
        },
      }),
    );

    await repository.deactivate(context, 'membership-2');

    expect(receivedArguments).toEqual({
      where: { tenantId_id: { tenantId: 'tenant-a', id: 'membership-2' } },
      data: { status: 'INACTIVE' },
    });
  });
});
