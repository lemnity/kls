import { describe, expect, it } from 'vitest';

import { createAuditEvent } from './audit-event.js';

describe('audit event', () => {
  it('creates an immutable record scoped to the current tenant', () => {
    const changes = { deadlineAt: { from: '2026-09-01', to: '2026-09-02' } };

    const event = createAuditEvent({
      id: 'audit-1',
      tenantId: 'tenant-a',
      actorMembershipId: 'membership-1',
      action: 'workshop_task.deadline_changed',
      subjectType: 'workshop_task',
      subjectId: 'task-1',
      changes,
      occurredAt: new Date('2026-09-02T06:00:00.000Z'),
    });

    changes.deadlineAt.to = '2099-01-01';

    expect(event).toEqual({
      id: 'audit-1',
      tenantId: 'tenant-a',
      actorMembershipId: 'membership-1',
      action: 'workshop_task.deadline_changed',
      subjectType: 'workshop_task',
      subjectId: 'task-1',
      changes: { deadlineAt: { from: '2026-09-01', to: '2026-09-02' } },
      occurredAt: new Date('2026-09-02T06:00:00.000Z'),
    });
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.changes)).toBe(true);
  });

  it('rejects an event without a tenant or subject', () => {
    expect(() =>
      createAuditEvent({
        id: 'audit-1',
        tenantId: '',
        actorMembershipId: 'membership-1',
        action: 'workshop_task.deadline_changed',
        subjectType: 'workshop_task',
        subjectId: 'task-1',
        changes: {},
        occurredAt: new Date(),
      }),
    ).toThrow('tenantId is required');

    expect(() =>
      createAuditEvent({
        id: 'audit-1',
        tenantId: 'tenant-a',
        actorMembershipId: 'membership-1',
        action: 'workshop_task.deadline_changed',
        subjectType: 'workshop_task',
        subjectId: '',
        changes: {},
        occurredAt: new Date(),
      }),
    ).toThrow('subjectId is required');
  });
});
