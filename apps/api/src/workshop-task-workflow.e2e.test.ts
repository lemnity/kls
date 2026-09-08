import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LocalPasswordAuthService } from '@kulisa/auth/local-session';
import { hashPassword } from '@kulisa/auth/password';
import { PostgresPermissionResolver } from '@kulisa/db/permission-resolver';
import { PostgresProductionRepository } from '@kulisa/db/production-repository';
import { PostgresBudgetRepository } from '@kulisa/db/budget-repository';
import { PostgresWorkshopRepository } from '@kulisa/db/workshop-repository';
import { PostgresWorkshopTaskRepository } from '@kulisa/db/workshop-task-repository';

import { createApiApp } from './app.js';
import { PostgresLocalAuthRepository } from './postgres-local-auth-repository.js';

const databaseUrl = process.env.DATABASE_URL;
const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration('workshop task workflow E2E', () => {
  const client = new Client({ connectionString: databaseUrl });

  beforeAll(async () => {
    await client.connect();
    await client.query('BEGIN');
  });

  afterAll(async () => {
    await client.query('ROLLBACK');
    await client.end();
  });

  it('walks a budget item from approval through a task to close, and rejects a reschedule without a reason', async () => {
    const tenant = await createTenantAdmin(client, 'Tenant Workflow');
    const app = await createApiApp({
      localPasswordAuthenticator: new LocalPasswordAuthService({
        repository: new PostgresLocalAuthRepository(client),
      }),
      permissionResolver: new PostgresPermissionResolver(client),
      productionRepository: new PostgresProductionRepository(client),
      budgetRepository: new PostgresBudgetRepository(client),
      workshopRepository: new PostgresWorkshopRepository(client),
      workshopTaskRepository: new PostgresWorkshopTaskRepository(client),
    });

    try {
      const token = await login(app, tenant.email, tenant.password);
      const authorization = `Bearer ${token}`;

      const workshop = await inject(app, 'POST', '/v1/organization/workshops', authorization, {
        name: 'Пошивочный цех',
      });
      expect(workshop.statusCode).toBe(201);
      const workshopId = workshop.json<{ id: string }>().id;

      const production = await inject(app, 'POST', '/v1/productions', authorization, {
        title: 'Ревизор',
        status: 'draft',
      });
      expect(production.statusCode).toBe(201);
      const productionId = production.json<{ id: string }>().id;

      const budget = await inject(app, 'POST', `/v1/productions/${productionId}/budgets`, authorization, {
        sections: [{
          workshopId,
          title: 'Пошивочный цех',
          items: [{ description: 'Сшить костюм', quantity: '1', unit: 'шт', unitPrice: '5000.00' }],
        }],
      });
      expect(budget.statusCode).toBe(201);
      const budgetBody = budget.json<{ id: string; sections: { items: { id: string }[] }[] }>();
      const budgetItemId = budgetBody.sections[0]!.items[0]!.id;

      const beforeApproval = await inject(app, 'POST', `/v1/budget-items/${budgetItemId}/tasks`, authorization, {});
      expect(beforeApproval.statusCode).toBe(400);

      const approved = await inject(app, 'POST', `/v1/budgets/${budgetBody.id}/approve`, authorization, {});
      expect(approved.statusCode).toBe(200);
      expect(approved.json<{ status: string }>().status).toBe('APPROVED');

      const createdTask = await inject(app, 'POST', `/v1/budget-items/${budgetItemId}/tasks`, authorization, {});
      expect(createdTask.statusCode).toBe(201);
      const taskId = createdTask.json<{ id: string; status: string }>().id;
      expect(createdTask.json<{ status: string }>().status).toBe('new');

      const assigned = await inject(app, 'PATCH', `/v1/workshop-tasks/${taskId}/assign`, authorization, {
        assigneeMembershipId: tenant.membershipId,
      });
      expect(assigned.statusCode).toBe(200);
      expect(assigned.json<{ status: string }>().status).toBe('assigned');

      const accepted = await inject(app, 'POST', `/v1/workshop-tasks/${taskId}/accept`, authorization, {});
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json<{ status: string }>().status).toBe('accepted');

      const rescheduleWithoutReason = await inject(app, 'PATCH', `/v1/workshop-tasks/${taskId}/deadline`, authorization, {
        deadlineAt: '2026-12-24',
      });
      expect(rescheduleWithoutReason.statusCode).toBe(400);

      const rescheduleWithReason = await inject(app, 'PATCH', `/v1/workshop-tasks/${taskId}/deadline`, authorization, {
        deadlineAt: '2026-12-24',
        reason: 'Поставщик задержал ткань',
      });
      expect(rescheduleWithReason.statusCode).toBe(200);
      expect(rescheduleWithReason.json<{ deadlineAt: string }>().deadlineAt).toBe('2026-12-24T00:00:00Z');

      const completed = await inject(app, 'POST', `/v1/workshop-tasks/${taskId}/complete`, authorization, {});
      expect(completed.statusCode).toBe(200);
      expect(completed.json<{ status: string }>().status).toBe('completed');

      const closed = await inject(app, 'POST', `/v1/workshop-tasks/${taskId}/close`, authorization, {});
      expect(closed.statusCode).toBe(200);
      expect(closed.json<{ status: string }>().status).toBe('closed');

      const list = await app.inject({
        method: 'GET',
        url: `/v1/organization/workshops/${workshopId}/tasks`,
        headers: { authorization },
      });
      expect(list.statusCode).toBe(200);
      expect(list.json<{ id: string }[]>()).toEqual([expect.objectContaining({ id: taskId, status: 'closed' })]);

      await expect(
        client.query(
          "SELECT action FROM audit_events WHERE subject_id = $1 AND action LIKE 'workshop_task.%' ORDER BY action",
          [taskId],
        ),
      ).resolves.toMatchObject({
        rows: [
          { action: 'workshop_task.accepted' },
          { action: 'workshop_task.assigned' },
          { action: 'workshop_task.closed' },
          { action: 'workshop_task.completed' },
          { action: 'workshop_task.created' },
          { action: 'workshop_task.deadline_changed' },
        ],
      });
    } finally {
      await app.close();
    }
  });
});

async function createTenantAdmin(client: Client, name: string) {
  const tenantId = randomUUID();
  const userId = randomUUID();
  const roleId = randomUUID();
  const membershipId = randomUUID();
  const permissionId = randomUUID();
  const email = `${userId}@example.test`;
  const password = 'correct password';

  await client.query('INSERT INTO tenants (id, name, updated_at) VALUES ($1, $2, NOW())', [tenantId, name]);
  await client.query(
    'INSERT INTO users (id, email, "displayName", updated_at) VALUES ($1, $2, $3, NOW())',
    [userId, email, name],
  );
  await client.query(
    'INSERT INTO roles (id, tenant_id, name, updated_at) VALUES ($1, $2, $3, NOW())',
    [roleId, tenantId, 'theatre_admin'],
  );
  await client.query(
    'INSERT INTO memberships (id, tenant_id, user_id, role_id, updated_at) VALUES ($1, $2, $3, $4, NOW())',
    [membershipId, tenantId, userId, roleId],
  );
  await client.query(
    `INSERT INTO permissions (id, code, description) VALUES ($1, $2, $3)
     ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description
     RETURNING id`,
    [permissionId, 'platform.admin', 'Workflow test permission'],
  );
  await client.query(
    'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, (SELECT id FROM permissions WHERE code = $2))',
    [roleId, 'platform.admin'],
  );
  await client.query(
    'INSERT INTO password_credentials (user_id, password_hash, updated_at) VALUES ($1, $2, NOW())',
    [userId, await hashPassword(password)],
  );

  return { tenantId, membershipId, email, password };
}

async function login(
  app: Awaited<ReturnType<typeof createApiApp>>,
  email: string,
  password: string,
): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: { email, password },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ accessToken: string }>().accessToken;
}

async function inject(
  app: Awaited<ReturnType<typeof createApiApp>>,
  method: 'POST' | 'PATCH',
  url: string,
  authorization: string,
  payload: Record<string, unknown>,
) {
  return await app.inject({ method, url, headers: { authorization }, payload });
}
