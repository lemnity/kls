import type { TenantContext } from './tenant-context.js';

export interface PermissionResolver {
  hasPermission(context: TenantContext, permission: string): Promise<boolean>;
}

export class PermissionDeniedError extends Error {
  public constructor() {
    super('Permission denied');
    this.name = 'PermissionDeniedError';
  }
}

export async function requirePermission(
  context: TenantContext,
  permission: string,
  resolver: PermissionResolver,
): Promise<void> {
  try {
    if (await resolver.hasPermission(context, permission)) return;
  } catch {
    // Fail closed when permission storage is unavailable.
  }

  throw new PermissionDeniedError();
}
