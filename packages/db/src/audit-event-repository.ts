import type { TenantContext } from '@kulisa/domain/tenant-context';

export interface AuditEventPrismaClient {
  auditEvent: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
}

export function createAuditEventRepository(client: AuditEventPrismaClient) {
  return {
    append(
      context: TenantContext,
      input: { id: string; action: string; subjectType: string; subjectId: string; changes: Record<string, unknown> },
    ): Promise<unknown> {
      return client.auditEvent.create({
        data: {
          id: input.id,
          tenantId: context.tenantId,
          actorMembershipId: context.membershipId,
          action: input.action,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          changes: input.changes,
        },
      });
    },
  };
}
