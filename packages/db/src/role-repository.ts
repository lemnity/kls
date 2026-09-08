import type { TenantContext } from '@kulisa/domain/tenant-context';

export interface RolePrismaClient {
  role: {
    findUnique(args: {
      where: { tenantId_id: { tenantId: string; id: string } };
    }): Promise<unknown>;
    create(args: { data: { tenantId: string; name: string } }): Promise<unknown>;
  };
}

export function createRoleRepository(client: RolePrismaClient) {
  return {
    findById(context: TenantContext, id: string): Promise<unknown> {
      return client.role.findUnique({ where: { tenantId_id: { tenantId: context.tenantId, id } } });
    },
    create(context: TenantContext, input: { name: string }): Promise<unknown> {
      return client.role.create({ data: { tenantId: context.tenantId, name: input.name } });
    },
  };
}
