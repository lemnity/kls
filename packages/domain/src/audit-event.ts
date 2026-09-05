export interface AuditObject {
  readonly [key: string]: AuditValue;
}

export type AuditValue =
  | null
  | boolean
  | number
  | string
  | readonly AuditValue[]
  | AuditObject;

export interface AuditEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly actorMembershipId: string;
  readonly action: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly changes: AuditObject;
  readonly occurredAt: Date;
}

export interface CreateAuditEventInput {
  id: string;
  tenantId: string;
  actorMembershipId: string;
  action: string;
  subjectType: string;
  subjectId: string;
  changes: Record<string, AuditValue>;
  occurredAt: Date;
}

export function createAuditEvent(input: CreateAuditEventInput): AuditEvent {
  requireValue('id', input.id);
  requireValue('tenantId', input.tenantId);
  requireValue('actorMembershipId', input.actorMembershipId);
  requireValue('action', input.action);
  requireValue('subjectType', input.subjectType);
  requireValue('subjectId', input.subjectId);

  return Object.freeze({
    id: input.id,
    tenantId: input.tenantId,
    actorMembershipId: input.actorMembershipId,
    action: input.action,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    changes: deepFreeze(structuredClone(input.changes)),
    occurredAt: new Date(input.occurredAt.getTime()),
  });
}

function requireValue(name: string, value: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
}

function deepFreeze<T extends AuditValue>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) {
      deepFreeze(item);
    }
  }

  return value;
}
