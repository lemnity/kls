import type { TenantContext } from '@europa/domain/tenant-context';

export interface MembershipPrismaDelegate {
  findUnique(args: {
    where: { tenantId_id: { tenantId: string; id: string } };
  }): Promise<unknown>;
  create(args: {
    data: { tenantId: string; userId: string; roleId?: string };
  }): Promise<unknown>;
  update(args: {
    where: { tenantId_id: { tenantId: string; id: string } };
    data: { status: 'INACTIVE' };
  }): Promise<unknown>;
}

export interface MembershipPrismaClient {
  membership: MembershipPrismaDelegate;
}

export function createMembershipRepository(client: MembershipPrismaClient) {
  return {
    findById(context: TenantContext, id: string): Promise<unknown> {
      return client.membership.findUnique({
        where: { tenantId_id: { tenantId: context.tenantId, id } },
      });
    },

    create(
      context: TenantContext,
      input: { userId: string; roleId?: string },
    ): Promise<unknown> {
      return client.membership.create({
        data: {
          tenantId: context.tenantId,
          userId: input.userId,
          ...(input.roleId === undefined ? {} : { roleId: input.roleId }),
        },
      });
    },

    deactivate(context: TenantContext, id: string): Promise<unknown> {
      return client.membership.update({
        where: { tenantId_id: { tenantId: context.tenantId, id } },
        data: { status: 'INACTIVE' },
      });
    },
  };
}
