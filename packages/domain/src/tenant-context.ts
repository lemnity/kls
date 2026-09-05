export interface MembershipIdentity {
  id: string;
  tenantId: string;
  userId: string;
  isActive: boolean;
}

export interface TenantContext {
  requestId: string;
  userId: string;
  membershipId: string;
  tenantId: string;
}

export class TenantAccessDeniedError extends Error {
  public constructor(message = 'Tenant access denied') {
    super(message);
    this.name = 'TenantAccessDeniedError';
  }
}

export function createTenantContext(input: {
  requestId: string;
  userId: string;
  membership: MembershipIdentity;
}): TenantContext {
  if (!input.membership.isActive || input.membership.userId !== input.userId) {
    throw new TenantAccessDeniedError();
  }

  return {
    requestId: input.requestId,
    userId: input.userId,
    membershipId: input.membership.id,
    tenantId: input.membership.tenantId,
  };
}

export function assertTenantAccess(
  context: TenantContext,
  resourceTenantId: string,
): void {
  if (context.tenantId !== resourceTenantId) {
    throw new TenantAccessDeniedError();
  }
}
