import { describe, expect, it } from 'vitest';

import { createAuditEventRepository } from './audit-event-repository.js';

describe('audit event repository', () => {
  it('takes tenant and actor only from TenantContext', async () => {
    let receivedData: unknown;
    const repository = createAuditEventRepository({
      auditEvent: {
        async create({ data }: { data: unknown }) { receivedData = data; return {}; },
      },
    });

    await repository.append(
      { requestId: 'r', userId: 'u', membershipId: 'membership-a', tenantId: 'tenant-a' },
      { id: 'audit-1', action: 'production.created', subjectType: 'production', subjectId: 'production-1', changes: {} },
    );

    expect(receivedData).toMatchObject({
      tenantId: 'tenant-a', actorMembershipId: 'membership-a', action: 'production.created',
    });
  });
});
