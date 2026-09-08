import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createApiApp } from './app.js';
import type { SessionAuthenticator } from './session.js';
import type { PermissionResolver } from '@kulisa/domain/permission-authorizer';
import { OrgUnitCycleError, OrgUnitParentNotFoundError } from '@kulisa/db/organization-repository';
import {
  MembershipAlreadyExistsError,
  MembershipRoleNotFoundError,
  MembershipUserNotFoundError,
} from '@kulisa/db/membership-repository';
import { ProductionProducerNotFoundError } from '@kulisa/db/production-repository';
import {
  BudgetAlreadyApprovedError,
  BudgetAlreadyExistsError,
  BudgetProductionNotFoundError,
  BudgetSectionWorkshopNotFoundError,
} from '@kulisa/db/budget-repository';
import { WorkshopManagerNotFoundError, WorkshopNameAlreadyExistsError } from '@kulisa/db/workshop-repository';
import {
  WorkshopTaskAlreadyExistsError,
  WorkshopTaskAssigneeNotFoundError,
  WorkshopTaskBudgetItemNotFoundError,
  WorkshopTaskBudgetNotApprovedError,
  WorkshopTaskClosedError,
  WorkshopTaskInvalidTransitionError,
} from '@kulisa/db/workshop-task-repository';

describe('API health endpoints', () => {
  it('returns the liveness contract without exposing infrastructure details', async () => {
    const app = await createApiApp();

    try {
      const response = await app.inject({ method: 'GET', url: '/health' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok' });
    } finally {
      await app.close();
    }
  });

  it('returns unavailable when a required dependency probe fails', async () => {
    const app = await createApiApp({
      readinessProbes: [
        { name: 'postgres', check: async () => true },
        { name: 'redis', check: async () => false },
      ],
    });

    try {
      const response = await app.inject({ method: 'GET', url: '/ready' });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ status: 'unavailable' });
    } finally {
      await app.close();
    }
  });

  it('fails closed when readiness probes are not configured', async () => {
    const app = await createApiApp();

    try {
      const response = await app.inject({ method: 'GET', url: '/ready' });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ status: 'unavailable' });
    } finally {
      await app.close();
    }
  });

  it('returns unavailable when a readiness probe throws', async () => {
    const app = await createApiApp({
      readinessProbes: [
        {
          name: 'postgres',
          check: async () => {
            throw new Error('connection refused');
          },
        },
      ],
    });

    try {
      const response = await app.inject({ method: 'GET', url: '/ready' });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ status: 'unavailable' });
    } finally {
      await app.close();
    }
  });

  it('builds a session response from an authenticated membership', async () => {
    const authenticator: SessionAuthenticator = {
      async authenticate(accessToken) {
        return accessToken === 'valid-access-token'
          ? {
              userId: 'user-1',
              membership: {
                id: 'membership-1',
                tenantId: 'tenant-a',
                userId: 'user-1',
                isActive: true,
              },
            }
          : null;
      },
    };
    const app = await createApiApp({ sessionAuthenticator: authenticator });

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/session',
        headers: { authorization: 'Bearer valid-access-token' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        userId: 'user-1',
        membershipId: 'membership-1',
        tenantId: 'tenant-a',
      });
    } finally {
      await app.close();
    }
  });

  it('does not expose a session endpoint without configured authentication', async () => {
    const app = await createApiApp();

    try {
      const response = await app.inject({ method: 'GET', url: '/v1/session' });

      expect(response.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('rejects unauthenticated org-unit creation', async () => {
    const app = await createApiApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/organization/org-units',
        payload: { name: 'Workshop', type: 'workshop' },
      });

      expect(response.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('creates an org unit within the authenticated tenant', async () => {
    const authenticator: SessionAuthenticator = {
      async authenticate() {
        return {
          userId: 'user-a',
          membership: { id: 'membership-a', tenantId: 'tenant-a', userId: 'user-a', isActive: true },
        };
      },
    };
    const createCalls: unknown[] = [];
    const app = await createApiApp({
      sessionAuthenticator: authenticator,
      permissionResolver: { async hasPermission() { return true; } },
      organizationRepository: {
        async createOrgUnit(context: unknown, input: unknown) {
          createCalls.push({ context, input });
          return { id: 'org-unit-a', name: 'Workshop', type: 'workshop' };
        },
      },
    } as never);

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/organization/org-units',
        headers: { authorization: 'Bearer token-a' },
        payload: { name: '  Workshop  ', type: 'workshop' },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual({ id: 'org-unit-a', name: 'Workshop', type: 'workshop' });
      expect(createCalls).toEqual([{
        context: expect.objectContaining({ tenantId: 'tenant-a', membershipId: 'membership-a' }),
        input: { name: 'Workshop', type: 'workshop' },
      }]);
    } finally {
      await app.close();
    }
  });

  it('rejects creating an org unit with a parentId outside the tenant', async () => {
    const authenticator: SessionAuthenticator = {
      async authenticate() {
        return {
          userId: 'user-a',
          membership: { id: 'membership-a', tenantId: 'tenant-a', userId: 'user-a', isActive: true },
        };
      },
    };
    const app = await createApiApp({
      sessionAuthenticator: authenticator,
      permissionResolver: { async hasPermission() { return true; } },
      organizationRepository: {
        async createOrgUnit() {
          throw new OrgUnitParentNotFoundError('11111111-1111-4111-8111-111111111111');
        },
        async listOrgUnits() {
          return [];
        },
      },
    } as never);

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/organization/org-units',
        headers: { authorization: 'Bearer token-a' },
        payload: {
          name: 'Workshop',
          type: 'workshop',
          parentId: '11111111-1111-4111-8111-111111111111',
        },
      });

      expect(response.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('rejects unauthenticated org-unit move', async () => {
    const app = await createApiApp();

    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/v1/organization/org-units/11111111-1111-4111-8111-111111111111/move',
        payload: { parentId: null },
      });

      expect(response.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('moves an org unit to a new parent within the tenant', async () => {
    const authenticator: SessionAuthenticator = {
      async authenticate() {
        return {
          userId: 'user-a',
          membership: { id: 'membership-a', tenantId: 'tenant-a', userId: 'user-a', isActive: true },
        };
      },
    };
    const orgUnitId = '33333333-3333-4333-8333-333333333333';
    const newParentId = '11111111-1111-4111-8111-111111111111';
    const moveCalls: unknown[] = [];
    const app = await createApiApp({
      sessionAuthenticator: authenticator,
      permissionResolver: { async hasPermission() { return true; } },
      organizationRepository: {
        async createOrgUnit() {
          throw new Error('not used in this test');
        },
        async listOrgUnits() {
          return [];
        },
        async moveOrgUnit(context: unknown, movedOrgUnitId: unknown, movedNewParentId: unknown) {
          moveCalls.push({ context, orgUnitId: movedOrgUnitId, newParentId: movedNewParentId });
          return { id: orgUnitId, name: 'Scenic workshop', type: 'workshop' };
        },
      },
    } as never);

    try {
      const response = await app.inject({
        method: 'PATCH',
        url: `/v1/organization/org-units/${orgUnitId}/move`,
        headers: { authorization: 'Bearer token-a' },
        payload: { parentId: newParentId },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ id: orgUnitId, name: 'Scenic workshop', type: 'workshop' });
      expect(moveCalls).toEqual([{
        context: expect.objectContaining({ tenantId: 'tenant-a', membershipId: 'membership-a' }),
        orgUnitId,
        newParentId,
      }]);
    } finally {
      await app.close();
    }
  });

  it('returns 404 when the moved org unit is not in the tenant', async () => {
    const authenticator: SessionAuthenticator = {
      async authenticate() {
        return {
          userId: 'user-a',
          membership: { id: 'membership-a', tenantId: 'tenant-a', userId: 'user-a', isActive: true },
        };
      },
    };
    const app = await createApiApp({
      sessionAuthenticator: authenticator,
      permissionResolver: { async hasPermission() { return true; } },
      organizationRepository: {
        async createOrgUnit() {
          throw new Error('not used in this test');
        },
        async listOrgUnits() {
          return [];
        },
        async moveOrgUnit() {
          return null;
        },
      },
    } as never);

    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/v1/organization/org-units/33333333-3333-4333-8333-333333333333/move',
        headers: { authorization: 'Bearer token-a' },
        payload: { parentId: null },
      });

      expect(response.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('rejects an org-unit move that would create a cycle', async () => {
    const authenticator: SessionAuthenticator = {
      async authenticate() {
        return {
          userId: 'user-a',
          membership: { id: 'membership-a', tenantId: 'tenant-a', userId: 'user-a', isActive: true },
        };
      },
    };
    const app = await createApiApp({
      sessionAuthenticator: authenticator,
      permissionResolver: { async hasPermission() { return true; } },
      organizationRepository: {
        async createOrgUnit() {
          throw new Error('not used in this test');
        },
        async listOrgUnits() {
          return [];
        },
        async moveOrgUnit() {
          throw new OrgUnitCycleError(
            '33333333-3333-4333-8333-333333333333',
            '44444444-4444-4444-8444-444444444444',
          );
        },
      },
    } as never);

    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/v1/organization/org-units/33333333-3333-4333-8333-333333333333/move',
        headers: { authorization: 'Bearer token-a' },
        payload: { parentId: '44444444-4444-4444-8444-444444444444' },
      });

      expect(response.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('rejects an org-unit move payload missing the parentId key', async () => {
    const authenticator: SessionAuthenticator = {
      async authenticate() {
        return {
          userId: 'user-a',
          membership: { id: 'membership-a', tenantId: 'tenant-a', userId: 'user-a', isActive: true },
        };
      },
    };
    const app = await createApiApp({
      sessionAuthenticator: authenticator,
      permissionResolver: { async hasPermission() { return true; } },
    });

    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/v1/organization/org-units/org-unit-a/move',
        headers: { authorization: 'Bearer token-a' },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('rejects unauthenticated org-unit deactivation', async () => {
    const app = await createApiApp();

    try {
      const response = await app.inject({
        method: 'DELETE',
        url: '/v1/organization/org-units/11111111-1111-4111-8111-111111111111',
      });

      expect(response.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('deactivates an org unit within the tenant and 404s for an unknown one', async () => {
    const authenticator: SessionAuthenticator = {
      async authenticate() {
        return {
          userId: 'user-a',
          membership: { id: 'membership-a', tenantId: 'tenant-a', userId: 'user-a', isActive: true },
        };
      },
    };
    const orgUnitId = '33333333-3333-4333-8333-333333333333';
    const deactivateCalls: unknown[] = [];
    const app = await createApiApp({
      sessionAuthenticator: authenticator,
      permissionResolver: { async hasPermission() { return true; } },
      organizationRepository: {
        async createOrgUnit() {
          throw new Error('not used in this test');
        },
        async listOrgUnits() {
          return [];
        },
        async deactivateOrgUnit(context: unknown, id: unknown) {
          deactivateCalls.push({ context, id });
          return id === orgUnitId ? { id: orgUnitId, name: 'Пошивочный цех', type: 'workshop' } : null;
        },
      },
    } as never);

    try {
      const deactivated = await app.inject({
        method: 'DELETE',
        url: `/v1/organization/org-units/${orgUnitId}`,
        headers: { authorization: 'Bearer token-a' },
      });
      const notFound = await app.inject({
        method: 'DELETE',
        url: '/v1/organization/org-units/44444444-4444-4444-8444-444444444444',
        headers: { authorization: 'Bearer token-a' },
      });

      expect(deactivated.statusCode).toBe(200);
      expect(deactivated.json()).toEqual({ id: orgUnitId, name: 'Пошивочный цех', type: 'workshop' });
      expect(notFound.statusCode).toBe(404);
      expect(deactivateCalls).toEqual([
        { context: expect.objectContaining({ tenantId: 'tenant-a' }), id: orgUnitId },
        { context: expect.objectContaining({ tenantId: 'tenant-a' }), id: '44444444-4444-4444-8444-444444444444' },
      ]);
    } finally {
      await app.close();
    }
  });

  it('rejects unauthenticated org-unit list retrieval', async () => {
    const app = await createApiApp();

    try {
      const response = await app.inject({ method: 'GET', url: '/v1/organization/org-units' });

      expect(response.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('rejects org-unit list retrieval without platform.admin permission', async () => {
    const authenticator: SessionAuthenticator = {
      async authenticate() {
        return {
          userId: 'user-a',
          membership: { id: 'membership-a', tenantId: 'tenant-a', userId: 'user-a', isActive: true },
        };
      },
    };
    const app = await createApiApp({
      sessionAuthenticator: authenticator,
      permissionResolver: { async hasPermission() { return false; } },
    });

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/organization/org-units',
        headers: { authorization: 'Bearer token-a' },
      });

      expect(response.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('returns the tenant org unit list', async () => {
    const authenticator: SessionAuthenticator = {
      async authenticate() {
        return {
          userId: 'user-a',
          membership: { id: 'membership-a', tenantId: 'tenant-a', userId: 'user-a', isActive: true },
        };
      },
    };
    const listCalls: unknown[] = [];
    const orgUnits = [
      { id: 'org-unit-a', name: 'Production', type: 'department', parentId: null, isActive: true },
      { id: 'org-unit-b', name: 'Scenic workshop', type: 'workshop', parentId: 'org-unit-a', isActive: true },
    ];
    const app = await createApiApp({
      sessionAuthenticator: authenticator,
      permissionResolver: { async hasPermission() { return true; } },
      organizationRepository: {
        async createOrgUnit() {
          throw new Error('not used in this test');
        },
        async listOrgUnits(context: unknown) {
          listCalls.push(context);
          return orgUnits;
        },
      },
    } as never);

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/organization/org-units',
        headers: { authorization: 'Bearer token-a' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(orgUnits);
      expect(listCalls).toEqual([
        expect.objectContaining({ tenantId: 'tenant-a', membershipId: 'membership-a' }),
      ]);
    } finally {
      await app.close();
    }
  });

  it('rejects unauthenticated workshop creation and listing', async () => {
    const app = await createApiApp();

    try {
      const create = await app.inject({
        method: 'POST',
        url: '/v1/organization/workshops',
        payload: { name: 'Пошивочный цех' },
      });
      const list = await app.inject({ method: 'GET', url: '/v1/organization/workshops' });

      expect(create.statusCode).toBe(401);
      expect(list.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('creates a workshop within the authenticated tenant and lists it', async () => {
    const authenticator: SessionAuthenticator = {
      async authenticate() {
        return {
          userId: 'user-a',
          membership: { id: 'membership-a', tenantId: 'tenant-a', userId: 'user-a', isActive: true },
        };
      },
    };
    const createCalls: unknown[] = [];
    const workshops = [{ id: 'workshop-a', name: 'Пошивочный цех', isActive: true }];
    const app = await createApiApp({
      sessionAuthenticator: authenticator,
      permissionResolver: { async hasPermission() { return true; } },
      workshopRepository: {
        async createWorkshop(context: unknown, input: unknown) {
          createCalls.push({ context, input });
          return workshops[0];
        },
        async listWorkshops() {
          return workshops;
        },
      },
    } as never);

    try {
      const create = await app.inject({
        method: 'POST',
        url: '/v1/organization/workshops',
        headers: { authorization: 'Bearer token-a' },
        payload: { name: '  Пошивочный цех  ' },
      });
      const list = await app.inject({
        method: 'GET',
        url: '/v1/organization/workshops',
        headers: { authorization: 'Bearer token-a' },
      });

      expect(create.statusCode).toBe(201);
      expect(create.json()).toEqual(workshops[0]);
      expect(createCalls).toEqual([{
        context: expect.objectContaining({ tenantId: 'tenant-a', membershipId: 'membership-a' }),
        input: { name: 'Пошивочный цех' },
      }]);
      expect(list.statusCode).toBe(200);
      expect(list.json()).toEqual(workshops);
    } finally {
      await app.close();
    }
  });

  it('rejects a duplicate workshop name with 409', async () => {
    const authenticator: SessionAuthenticator = {
      async authenticate() {
        return {
          userId: 'user-a',
          membership: { id: 'membership-a', tenantId: 'tenant-a', userId: 'user-a', isActive: true },
        };
      },
    };
    const app = await createApiApp({
      sessionAuthenticator: authenticator,
      permissionResolver: { async hasPermission() { return true; } },
      workshopRepository: {
        async createWorkshop() {
          throw new WorkshopNameAlreadyExistsError('Пошивочный цех');
        },
        async listWorkshops() {
          return [];
        },
      },
    } as never);

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/organization/workshops',
        headers: { authorization: 'Bearer token-a' },
        payload: { name: 'Пошивочный цех' },
      });

      expect(response.statusCode).toBe(409);
    } finally {
      await app.close();
    }
  });

  it('creates a workshop with a manager membership', async () => {
    const authenticator: SessionAuthenticator = {
      async authenticate() {
        return {
          userId: 'user-a',
          membership: { id: 'membership-a', tenantId: 'tenant-a', userId: 'user-a', isActive: true },
        };
      },
    };
    const managerMembershipId = '11111111-1111-4111-8111-111111111111';
    const createCalls: unknown[] = [];
    const app = await createApiApp({
      sessionAuthenticator: authenticator,
      permissionResolver: { async hasPermission() { return true; } },
      workshopRepository: {
        async createWorkshop(context: unknown, input: unknown) {
          createCalls.push({ context, input });
          return { id: 'workshop-a', name: 'Пошивочный цех', isActive: true, managerMembershipId };
        },
        async listWorkshops() {
          return [];
        },
      },
    } as never);

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/organization/workshops',
        headers: { authorization: 'Bearer token-a' },
        payload: { name: 'Пошивочный цех', managerMembershipId },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({ managerMembershipId });
      expect(createCalls).toEqual([{
        context: expect.objectContaining({ tenantId: 'tenant-a', membershipId: 'membership-a' }),
        input: { name: 'Пошивочный цех', managerMembershipId },
      }]);
    } finally {
      await app.close();
    }
  });

  it('rejects creating a workshop with a manager membership outside the tenant', async () => {
    const authenticator: SessionAuthenticator = {
      async authenticate() {
        return {
          userId: 'user-a',
          membership: { id: 'membership-a', tenantId: 'tenant-a', userId: 'user-a', isActive: true },
        };
      },
    };
    const app = await createApiApp({
      sessionAuthenticator: authenticator,
      permissionResolver: { async hasPermission() { return true; } },
      workshopRepository: {
        async createWorkshop() {
          throw new WorkshopManagerNotFoundError('11111111-1111-4111-8111-111111111111');
        },
        async listWorkshops() {
          return [];
        },
      },
    } as never);

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/organization/workshops',
        headers: { authorization: 'Bearer token-a' },
        payload: { name: 'Пошивочный цех', managerMembershipId: '11111111-1111-4111-8111-111111111111' },
      });

      expect(response.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('rejects unauthenticated workshop manager assignment', async () => {
    const app = await createApiApp();

    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/v1/organization/workshops/11111111-1111-4111-8111-111111111111/manager',
        payload: { managerMembershipId: null },
      });

      expect(response.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('assigns a workshop manager and allows clearing it with null', async () => {
    const authenticator: SessionAuthenticator = {
      async authenticate() {
        return {
          userId: 'user-a',
          membership: { id: 'membership-a', tenantId: 'tenant-a', userId: 'user-a', isActive: true },
        };
      },
    };
    const workshopId = '22222222-2222-4222-8222-222222222222';
    const managerMembershipId = '11111111-1111-4111-8111-111111111111';
    const assignCalls: unknown[] = [];
    const app = await createApiApp({
      sessionAuthenticator: authenticator,
      permissionResolver: { async hasPermission() { return true; } },
      workshopRepository: {
        async createWorkshop() {
          throw new Error('not used in this test');
        },
        async listWorkshops() {
          return [];
        },
        async assignWorkshopManager(context: unknown, id: unknown, managerId: unknown) {
          assignCalls.push({ context, id, managerId });
          return { id: workshopId, name: 'Пошивочный цех', isActive: true, managerMembershipId: managerId };
        },
      },
    } as never);

    try {
      const assign = await app.inject({
        method: 'PATCH',
        url: `/v1/organization/workshops/${workshopId}/manager`,
        headers: { authorization: 'Bearer token-a' },
        payload: { managerMembershipId },
      });
      const clear = await app.inject({
        method: 'PATCH',
        url: `/v1/organization/workshops/${workshopId}/manager`,
        headers: { authorization: 'Bearer token-a' },
        payload: { managerMembershipId: null },
      });

      expect(assign.statusCode).toBe(200);
      expect(assign.json()).toMatchObject({ managerMembershipId });
      expect(clear.statusCode).toBe(200);
      expect(clear.json()).toMatchObject({ managerMembershipId: null });
      expect(assignCalls).toEqual([
        { context: expect.objectContaining({ tenantId: 'tenant-a' }), id: workshopId, managerId: managerMembershipId },
        { context: expect.objectContaining({ tenantId: 'tenant-a' }), id: workshopId, managerId: null },
      ]);
    } finally {
      await app.close();
    }
  });

  it('returns 404 for an unknown workshop and 400 for a payload missing managerMembershipId', async () => {
    const authenticator: SessionAuthenticator = {
      async authenticate() {
        return {
          userId: 'user-a',
          membership: { id: 'membership-a', tenantId: 'tenant-a', userId: 'user-a', isActive: true },
        };
      },
    };
    const app = await createApiApp({
      sessionAuthenticator: authenticator,
      permissionResolver: { async hasPermission() { return true; } },
      workshopRepository: {
        async createWorkshop() {
          throw new Error('not used in this test');
        },
        async listWorkshops() {
          return [];
        },
        async assignWorkshopManager() {
          return null;
        },
      },
    } as never);

    try {
      const notFound = await app.inject({
        method: 'PATCH',
        url: '/v1/organization/workshops/22222222-2222-4222-8222-222222222222/manager',
        headers: { authorization: 'Bearer token-a' },
        payload: { managerMembershipId: null },
      });
      const invalidPayload = await app.inject({
        method: 'PATCH',
        url: '/v1/organization/workshops/22222222-2222-4222-8222-222222222222/manager',
        headers: { authorization: 'Bearer token-a' },
        payload: {},
      });

      expect(notFound.statusCode).toBe(404);
      expect(invalidPayload.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('rejects unauthenticated task creation and listing', async () => {
    const app = await createApiApp();

    try {
      const create = await app.inject({
        method: 'POST',
        url: '/v1/budget-items/11111111-1111-4111-8111-111111111111/tasks',
        payload: {},
      });
      const list = await app.inject({
        method: 'GET',
        url: '/v1/organization/workshops/11111111-1111-4111-8111-111111111111/tasks',
      });

      expect(create.statusCode).toBe(401);
      expect(list.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('creates a task from a budget item and lists tasks by workshop', async () => {
    const authenticator: SessionAuthenticator = {
      async authenticate() {
        return {
          userId: 'user-a',
          membership: { id: 'membership-a', tenantId: 'tenant-a', userId: 'user-a', isActive: true },
        };
      },
    };
    const budgetItemId = '11111111-1111-4111-8111-111111111111';
    const workshopId = '22222222-2222-4222-8222-222222222222';
    const createCalls: unknown[] = [];
    const task = {
      id: 'task-a',
      budgetItemId,
      productionId: 'production-a',
      workshopId,
      assigneeMembershipId: null,
      status: 'new',
      description: 'Сшить костюм',
      deadlineAt: null,
      completedAt: null,
    };
    const app = await createApiApp({
      sessionAuthenticator: authenticator,
      permissionResolver: { async hasPermission() { return true; } },
      workshopTaskRepository: {
        async createTaskFromBudgetItem(context: unknown, input: unknown) {
          createCalls.push({ context, input });
          return task;
        },
        async listTasksByWorkshop() {
          return [task];
        },
      },
    } as never);

    try {
      const create = await app.inject({
        method: 'POST',
        url: `/v1/budget-items/${budgetItemId}/tasks`,
        headers: { authorization: 'Bearer token-a' },
        payload: {},
      });
      const list = await app.inject({
        method: 'GET',
        url: `/v1/organization/workshops/${workshopId}/tasks`,
        headers: { authorization: 'Bearer token-a' },
      });

      expect(create.statusCode).toBe(201);
      expect(create.json()).toEqual(task);
      expect(createCalls).toEqual([{
        context: expect.objectContaining({ tenantId: 'tenant-a', membershipId: 'membership-a' }),
        input: { budgetItemId },
      }]);
      expect(list.statusCode).toBe(200);
      expect(list.json()).toEqual([task]);
    } finally {
      await app.close();
    }
  });

  it('maps task creation errors to the matching HTTP status', async () => {
    const authenticator: SessionAuthenticator = {
      async authenticate() {
        return {
          userId: 'user-a',
          membership: { id: 'membership-a', tenantId: 'tenant-a', userId: 'user-a', isActive: true },
        };
      },
    };
    const notFoundId = '11111111-1111-4111-8111-111111111111';
    const notApprovedId = '22222222-2222-4222-8222-222222222222';
    const duplicateId = '33333333-3333-4333-8333-333333333333';
    const badAssigneeId = '44444444-4444-4444-8444-444444444444';
    const app = await createApiApp({
      sessionAuthenticator: authenticator,
      permissionResolver: { async hasPermission() { return true; } },
      workshopTaskRepository: {
        async createTaskFromBudgetItem(_: unknown, input: { budgetItemId: string }) {
          if (input.budgetItemId === notFoundId) throw new WorkshopTaskBudgetItemNotFoundError(notFoundId);
          if (input.budgetItemId === notApprovedId) throw new WorkshopTaskBudgetNotApprovedError(notApprovedId);
          if (input.budgetItemId === duplicateId) throw new WorkshopTaskAlreadyExistsError(duplicateId);
          throw new WorkshopTaskAssigneeNotFoundError(badAssigneeId);
        },
        async listTasksByWorkshop() {
          return [];
        },
      },
    } as never);

    try {
      const notFound = await app.inject({
        method: 'POST',
        url: `/v1/budget-items/${notFoundId}/tasks`,
        headers: { authorization: 'Bearer token-a' },
        payload: {},
      });
      const notApproved = await app.inject({
        method: 'POST',
        url: `/v1/budget-items/${notApprovedId}/tasks`,
        headers: { authorization: 'Bearer token-a' },
        payload: {},
      });
      const duplicate = await app.inject({
        method: 'POST',
        url: `/v1/budget-items/${duplicateId}/tasks`,
        headers: { authorization: 'Bearer token-a' },
        payload: {},
      });
      const badAssignee = await app.inject({
        method: 'POST',
        url: `/v1/budget-items/${badAssigneeId}/tasks`,
        headers: { authorization: 'Bearer token-a' },
        payload: {},
      });

      expect(notFound.statusCode).toBe(404);
      expect(notApproved.statusCode).toBe(400);
      expect(duplicate.statusCode).toBe(409);
      expect(badAssignee.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('rejects unauthenticated task transitions', async () => {
    const app = await createApiApp();
    const taskId = '11111111-1111-4111-8111-111111111111';

    try {
      const assign = await app.inject({
        method: 'PATCH',
        url: `/v1/workshop-tasks/${taskId}/assign`,
        payload: { assigneeMembershipId: taskId },
      });
      const accept = await app.inject({ method: 'POST', url: `/v1/workshop-tasks/${taskId}/accept` });
      const complete = await app.inject({ method: 'POST', url: `/v1/workshop-tasks/${taskId}/complete` });
      const close = await app.inject({ method: 'POST', url: `/v1/workshop-tasks/${taskId}/close` });

      expect(assign.statusCode).toBe(401);
      expect(accept.statusCode).toBe(401);
      expect(complete.statusCode).toBe(401);
      expect(close.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('walks a task through assign, accept, complete and close', async () => {
    const authenticator: SessionAuthenticator = {
      async authenticate() {
        return {
          userId: 'user-a',
          membership: { id: 'membership-a', tenantId: 'tenant-a', userId: 'user-a', isActive: true },
        };
      },
    };
    const taskId = '11111111-1111-4111-8111-111111111111';
    const assigneeId = '22222222-2222-4222-8222-222222222222';
    const baseTask = {
      id: taskId,
      budgetItemId: 'item-a',
      productionId: 'production-a',
      workshopId: 'workshop-a',
      assigneeMembershipId: null as string | null,
      status: 'new',
      description: 'Сшить костюм',
      deadlineAt: null,
      completedAt: null as string | null,
    };
    const app = await createApiApp({
      sessionAuthenticator: authenticator,
      permissionResolver: { async hasPermission() { return true; } },
      workshopTaskRepository: {
        async createTaskFromBudgetItem() {
          throw new Error('not used in this test');
        },
        async listTasksByWorkshop() {
          return [];
        },
        async assignTask(_: unknown, id: string, assigneeMembershipId: string) {
          return { ...baseTask, status: 'assigned', assigneeMembershipId };
        },
        async acceptTask() {
          return { ...baseTask, status: 'accepted', assigneeMembershipId: assigneeId };
        },
        async completeTask() {
          return { ...baseTask, status: 'completed', assigneeMembershipId: assigneeId, completedAt: '2026-09-08T00:00:00Z' };
        },
        async closeTask() {
          return { ...baseTask, status: 'closed', assigneeMembershipId: assigneeId, completedAt: '2026-09-08T00:00:00Z' };
        },
      },
    } as never);

    try {
      const assign = await app.inject({
        method: 'PATCH',
        url: `/v1/workshop-tasks/${taskId}/assign`,
        headers: { authorization: 'Bearer token-a' },
        payload: { assigneeMembershipId: assigneeId },
      });
      const accept = await app.inject({
        method: 'POST',
        url: `/v1/workshop-tasks/${taskId}/accept`,
        headers: { authorization: 'Bearer token-a' },
      });
      const complete = await app.inject({
        method: 'POST',
        url: `/v1/workshop-tasks/${taskId}/complete`,
        headers: { authorization: 'Bearer token-a' },
      });
      const close = await app.inject({
        method: 'POST',
        url: `/v1/workshop-tasks/${taskId}/close`,
        headers: { authorization: 'Bearer token-a' },
      });

      expect(assign.statusCode).toBe(200);
      expect(assign.json()).toMatchObject({ status: 'assigned', assigneeMembershipId: assigneeId });
      expect(accept.statusCode).toBe(200);
      expect(accept.json()).toMatchObject({ status: 'accepted' });
      expect(complete.statusCode).toBe(200);
      expect(complete.json()).toMatchObject({ status: 'completed', completedAt: '2026-09-08T00:00:00Z' });
      expect(close.statusCode).toBe(200);
      expect(close.json()).toMatchObject({ status: 'closed' });
    } finally {
      await app.close();
    }
  });

  it('maps task transition errors and unknown tasks to the matching HTTP status', async () => {
    const authenticator: SessionAuthenticator = {
      async authenticate() {
        return {
          userId: 'user-a',
          membership: { id: 'membership-a', tenantId: 'tenant-a', userId: 'user-a', isActive: true },
        };
      },
    };
    const wrongStatusId = '11111111-1111-4111-8111-111111111111';
    const unknownAssigneeId = '22222222-2222-4222-8222-222222222222';
    const missingId = '33333333-3333-4333-8333-333333333333';
    const app = await createApiApp({
      sessionAuthenticator: authenticator,
      permissionResolver: { async hasPermission() { return true; } },
      workshopTaskRepository: {
        async createTaskFromBudgetItem() {
          throw new Error('not used in this test');
        },
        async listTasksByWorkshop() {
          return [];
        },
        async assignTask(_: unknown, id: string, assigneeMembershipId: string) {
          if (id === missingId) return null;
          if (assigneeMembershipId === unknownAssigneeId) throw new WorkshopTaskAssigneeNotFoundError(unknownAssigneeId);
          throw new WorkshopTaskInvalidTransitionError(id, 'new', 'assigned');
        },
        async acceptTask(_: unknown, id: string) {
          if (id === missingId) return null;
          throw new WorkshopTaskInvalidTransitionError(id, 'assigned', 'new');
        },
        async completeTask() {
          throw new Error('not used in this test');
        },
        async closeTask() {
          throw new Error('not used in this test');
        },
      },
    } as never);

    try {
      const invalidTransition = await app.inject({
        method: 'PATCH',
        url: `/v1/workshop-tasks/${wrongStatusId}/assign`,
        headers: { authorization: 'Bearer token-a' },
        payload: { assigneeMembershipId: wrongStatusId },
      });
      const unknownAssignee = await app.inject({
        method: 'PATCH',
        url: `/v1/workshop-tasks/${wrongStatusId}/assign`,
        headers: { authorization: 'Bearer token-a' },
        payload: { assigneeMembershipId: unknownAssigneeId },
      });
      const assignMissing = await app.inject({
        method: 'PATCH',
        url: `/v1/workshop-tasks/${missingId}/assign`,
        headers: { authorization: 'Bearer token-a' },
        payload: { assigneeMembershipId: wrongStatusId },
      });
      const acceptInvalid = await app.inject({
        method: 'POST',
        url: `/v1/workshop-tasks/${wrongStatusId}/accept`,
        headers: { authorization: 'Bearer token-a' },
      });
      const invalidPayload = await app.inject({
        method: 'PATCH',
        url: `/v1/workshop-tasks/${wrongStatusId}/assign`,
        headers: { authorization: 'Bearer token-a' },
        payload: { assigneeMembershipId: 'not-a-uuid' },
      });

      expect(invalidTransition.statusCode).toBe(409);
      expect(unknownAssignee.statusCode).toBe(400);
      expect(assignMissing.statusCode).toBe(404);
      expect(acceptInvalid.statusCode).toBe(409);
      expect(invalidPayload.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('rejects unauthenticated deadline reschedule', async () => {
    const app = await createApiApp();

    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/v1/workshop-tasks/11111111-1111-4111-8111-111111111111/deadline',
        payload: { deadlineAt: '2026-12-24', reason: 'причина' },
      });

      expect(response.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('rejects a reschedule payload with a missing reason or deadlineAt key', async () => {
    const app = await createApiApp();
    const taskId = '11111111-1111-4111-8111-111111111111';

    try {
      const missingReason = await app.inject({
        method: 'PATCH',
        url: `/v1/workshop-tasks/${taskId}/deadline`,
        payload: { deadlineAt: '2026-12-24' },
      });
      const missingDeadlineKey = await app.inject({
        method: 'PATCH',
        url: `/v1/workshop-tasks/${taskId}/deadline`,
        payload: { reason: '  ' },
      });

      expect(missingReason.statusCode).toBe(400);
      expect(missingDeadlineKey.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('reschedules a task deadline, allows clearing it to null', async () => {
    const authenticator: SessionAuthenticator = {
      async authenticate() {
        return {
          userId: 'user-a',
          membership: { id: 'membership-a', tenantId: 'tenant-a', userId: 'user-a', isActive: true },
        };
      },
    };
    const taskId = '11111111-1111-4111-8111-111111111111';
    const rescheduleCalls: unknown[] = [];
    const app = await createApiApp({
      sessionAuthenticator: authenticator,
      permissionResolver: { async hasPermission() { return true; } },
      workshopTaskRepository: {
        async createTaskFromBudgetItem() {
          throw new Error('not used in this test');
        },
        async listTasksByWorkshop() {
          return [];
        },
        async assignTask() {
          throw new Error('not used in this test');
        },
        async acceptTask() {
          throw new Error('not used in this test');
        },
        async completeTask() {
          throw new Error('not used in this test');
        },
        async closeTask() {
          throw new Error('not used in this test');
        },
        async rescheduleTaskDeadline(context: unknown, id: string, deadlineAt: string | null, reason: string) {
          rescheduleCalls.push({ context, id, deadlineAt, reason });
          return {
            id,
            budgetItemId: 'item-a',
            productionId: 'production-a',
            workshopId: 'workshop-a',
            assigneeMembershipId: null,
            status: 'new',
            description: 'Сшить костюм',
            deadlineAt,
            completedAt: null,
          };
        },
      },
    } as never);

    try {
      const response = await app.inject({
        method: 'PATCH',
        url: `/v1/workshop-tasks/${taskId}/deadline`,
        headers: { authorization: 'Bearer token-a' },
        payload: { deadlineAt: '2026-12-24', reason: 'Поставщик задержал ткань' },
      });
      const cleared = await app.inject({
        method: 'PATCH',
        url: `/v1/workshop-tasks/${taskId}/deadline`,
        headers: { authorization: 'Bearer token-a' },
        payload: { deadlineAt: null, reason: 'Дедлайн больше не актуален' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ deadlineAt: '2026-12-24' });
      expect(cleared.statusCode).toBe(200);
      expect(cleared.json()).toMatchObject({ deadlineAt: null });
      expect(rescheduleCalls).toEqual([
        {
          context: expect.objectContaining({ tenantId: 'tenant-a', membershipId: 'membership-a' }),
          id: taskId,
          deadlineAt: '2026-12-24',
          reason: 'Поставщик задержал ткань',
        },
        {
          context: expect.objectContaining({ tenantId: 'tenant-a', membershipId: 'membership-a' }),
          id: taskId,
          deadlineAt: null,
          reason: 'Дедлайн больше не актуален',
        },
      ]);
    } finally {
      await app.close();
    }
  });

  it('maps a closed-task reschedule to 409 and an unknown task to 404', async () => {
    const authenticator: SessionAuthenticator = {
      async authenticate() {
        return {
          userId: 'user-a',
          membership: { id: 'membership-a', tenantId: 'tenant-a', userId: 'user-a', isActive: true },
        };
      },
    };
    const closedId = '11111111-1111-4111-8111-111111111111';
    const missingId = '22222222-2222-4222-8222-222222222222';
    const app = await createApiApp({
      sessionAuthenticator: authenticator,
      permissionResolver: { async hasPermission() { return true; } },
      workshopTaskRepository: {
        async createTaskFromBudgetItem() {
          throw new Error('not used in this test');
        },
        async listTasksByWorkshop() {
          return [];
        },
        async assignTask() {
          throw new Error('not used in this test');
        },
        async acceptTask() {
          throw new Error('not used in this test');
        },
        async completeTask() {
          throw new Error('not used in this test');
        },
        async closeTask() {
          throw new Error('not used in this test');
        },
        async rescheduleTaskDeadline(_: unknown, id: string) {
          if (id === missingId) return null;
          throw new WorkshopTaskClosedError(id);
        },
      },
    } as never);

    try {
      const closed = await app.inject({
        method: 'PATCH',
        url: `/v1/workshop-tasks/${closedId}/deadline`,
        headers: { authorization: 'Bearer token-a' },
        payload: { deadlineAt: '2026-12-24', reason: 'причина' },
      });
      const missing = await app.inject({
        method: 'PATCH',
        url: `/v1/workshop-tasks/${missingId}/deadline`,
        headers: { authorization: 'Bearer token-a' },
        payload: { deadlineAt: '2026-12-24', reason: 'причина' },
      });

      expect(closed.statusCode).toBe(409);
      expect(missing.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('rejects unauthenticated membership creation and deactivation', async () => {
    const app = await createApiApp();

    try {
      const create = await app.inject({
        method: 'POST',
        url: '/v1/organization/memberships',
        payload: { userId: '11111111-1111-4111-8111-111111111111' },
      });
      const deactivate = await app.inject({
        method: 'DELETE',
        url: '/v1/organization/memberships/11111111-1111-4111-8111-111111111111',
      });

      expect(create.statusCode).toBe(401);
      expect(deactivate.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('rejects membership creation without platform.admin permission', async () => {
    const authenticator: SessionAuthenticator = {
      async authenticate() {
        return {
          userId: 'user-a',
          membership: { id: 'membership-a', tenantId: 'tenant-a', userId: 'user-a', isActive: true },
        };
      },
    };
    const app = await createApiApp({
      sessionAuthenticator: authenticator,
      permissionResolver: { async hasPermission() { return false; } },
    });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/organization/memberships',
        headers: { authorization: 'Bearer token-a' },
        payload: { userId: '11111111-1111-4111-8111-111111111111' },
      });

      expect(response.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('creates a membership within the authenticated tenant', async () => {
    const authenticator: SessionAuthenticator = {
      async authenticate() {
        return {
          userId: 'user-a',
          membership: { id: 'membership-a', tenantId: 'tenant-a', userId: 'user-a', isActive: true },
        };
      },
    };
    const createCalls: unknown[] = [];
    const app = await createApiApp({
      sessionAuthenticator: authenticator,
      permissionResolver: { async hasPermission() { return true; } },
      membershipRepository: {
        async createMembership(context: unknown, input: unknown) {
          createCalls.push({ context, input });
          return { id: 'membership-b', userId: '11111111-1111-4111-8111-111111111111', roleId: null, status: 'ACTIVE' };
        },
        async deactivateMembership() {
          return null;
        },
      },
    } as never);

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/organization/memberships',
        headers: { authorization: 'Bearer token-a' },
        payload: { userId: '11111111-1111-4111-8111-111111111111' },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual({
        id: 'membership-b',
        userId: '11111111-1111-4111-8111-111111111111',
        roleId: null,
        status: 'ACTIVE',
      });
      expect(createCalls).toEqual([{
        context: expect.objectContaining({ tenantId: 'tenant-a', membershipId: 'membership-a' }),
        input: { userId: '11111111-1111-4111-8111-111111111111' },
      }]);
    } finally {
      await app.close();
    }
  });

  it('maps membership repository errors to the matching HTTP status', async () => {
    const authenticator: SessionAuthenticator = {
      async authenticate() {
        return {
          userId: 'user-a',
          membership: { id: 'membership-a', tenantId: 'tenant-a', userId: 'user-a', isActive: true },
        };
      },
    };
    const userNotFoundId = '11111111-1111-4111-8111-111111111111';
    const roleNotFoundId = '22222222-2222-4222-8222-222222222222';
    const alreadyMemberId = '33333333-3333-4333-8333-333333333333';
    const errorsByUserId: Record<string, Error> = {
      [userNotFoundId]: new MembershipUserNotFoundError(userNotFoundId),
      [roleNotFoundId]: new MembershipRoleNotFoundError(roleNotFoundId),
      [alreadyMemberId]: new MembershipAlreadyExistsError(alreadyMemberId),
    };
    const app = await createApiApp({
      sessionAuthenticator: authenticator,
      permissionResolver: { async hasPermission() { return true; } },
      membershipRepository: {
        async createMembership(_: unknown, input: { userId: string }) {
          throw errorsByUserId[input.userId];
        },
        async deactivateMembership() {
          return null;
        },
      },
    } as never);

    try {
      const userNotFound = await app.inject({
        method: 'POST',
        url: '/v1/organization/memberships',
        headers: { authorization: 'Bearer token-a' },
        payload: { userId: userNotFoundId },
      });
      const roleNotFound = await app.inject({
        method: 'POST',
        url: '/v1/organization/memberships',
        headers: { authorization: 'Bearer token-a' },
        payload: { userId: roleNotFoundId },
      });
      const alreadyMember = await app.inject({
        method: 'POST',
        url: '/v1/organization/memberships',
        headers: { authorization: 'Bearer token-a' },
        payload: { userId: alreadyMemberId },
      });

      expect(userNotFound.statusCode).toBe(400);
      expect(roleNotFound.statusCode).toBe(400);
      expect(alreadyMember.statusCode).toBe(409);
    } finally {
      await app.close();
    }
  });

  it('deactivates a membership within the authenticated tenant and 404s for an unknown one', async () => {
    const authenticator: SessionAuthenticator = {
      async authenticate() {
        return {
          userId: 'user-a',
          membership: { id: 'membership-a', tenantId: 'tenant-a', userId: 'user-a', isActive: true },
        };
      },
    };
    const app = await createApiApp({
      sessionAuthenticator: authenticator,
      permissionResolver: { async hasPermission() { return true; } },
      membershipRepository: {
        async createMembership() {
          throw new Error('not used in this test');
        },
        async deactivateMembership(_: unknown, membershipId: string) {
          return membershipId === 'membership-a'
            ? { id: 'membership-a', userId: 'user-b', roleId: null, status: 'INACTIVE' }
            : null;
        },
      },
    } as never);

    try {
      const found = await app.inject({
        method: 'DELETE',
        url: '/v1/organization/memberships/membership-a',
        headers: { authorization: 'Bearer token-a' },
      });
      const notFound = await app.inject({
        method: 'DELETE',
        url: '/v1/organization/memberships/membership-from-tenant-b',
        headers: { authorization: 'Bearer token-a' },
      });

      expect(found.statusCode).toBe(200);
      expect(found.json()).toEqual({ id: 'membership-a', userId: 'user-b', roleId: null, status: 'INACTIVE' });
      expect(notFound.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('rejects unauthenticated membership listing and returns the tenant list', async () => {
    const unauthApp = await createApiApp();

    try {
      const response = await unauthApp.inject({ method: 'GET', url: '/v1/organization/memberships' });
      expect(response.statusCode).toBe(401);
    } finally {
      await unauthApp.close();
    }

    const authenticator: SessionAuthenticator = {
      async authenticate() {
        return {
          userId: 'user-a',
          membership: { id: 'membership-a', tenantId: 'tenant-a', userId: 'user-a', isActive: true },
        };
      },
    };
    const memberships = [
      { id: 'membership-a', userId: 'user-a', userEmail: 'admin@example.test', roleId: 'role-a', status: 'ACTIVE' },
    ];
    const app = await createApiApp({
      sessionAuthenticator: authenticator,
      permissionResolver: { async hasPermission() { return true; } },
      membershipRepository: {
        async createMembership() {
          throw new Error('not used in this test');
        },
        async deactivateMembership() {
          throw new Error('not used in this test');
        },
        async listMemberships() {
          return memberships;
        },
      },
    } as never);

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/organization/memberships',
        headers: { authorization: 'Bearer token-a' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(memberships);
    } finally {
      await app.close();
    }
  });

  it('rejects unauthenticated production creation, listing and update', async () => {
    const app = await createApiApp();

    try {
      const create = await app.inject({
        method: 'POST',
        url: '/v1/productions',
        payload: { title: 'Ревизор', status: 'draft' },
      });
      const list = await app.inject({ method: 'GET', url: '/v1/productions' });
      const update = await app.inject({
        method: 'PATCH',
        url: '/v1/productions/11111111-1111-4111-8111-111111111111',
        payload: { title: 'Ревизор', status: 'draft' },
      });

      expect(create.statusCode).toBe(401);
      expect(list.statusCode).toBe(401);
      expect(update.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('rejects an invalid production payload before checking authorization', async () => {
    const app = await createApiApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/productions',
        payload: { title: 'Ревизор', status: 'draft', premiereDate: '2026-02-30' },
      });

      expect(response.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('creates a production within the authenticated tenant', async () => {
    const authenticator: SessionAuthenticator = {
      async authenticate() {
        return {
          userId: 'user-a',
          membership: { id: 'membership-a', tenantId: 'tenant-a', userId: 'user-a', isActive: true },
        };
      },
    };
    const createCalls: unknown[] = [];
    const app = await createApiApp({
      sessionAuthenticator: authenticator,
      permissionResolver: { async hasPermission() { return true; } },
      productionRepository: {
        async createProduction(context: unknown, input: unknown) {
          createCalls.push({ context, input });
          return {
            id: 'production-a',
            title: 'Ревизор',
            status: 'draft',
            premiereDate: '2026-12-01',
            producerMembershipId: null,
            healthStatus: 'neutral',
            healthReason: null,
          };
        },
        async listProductions() {
          return [];
        },
        async updateProduction() {
          return null;
        },
      },
    } as never);

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/productions',
        headers: { authorization: 'Bearer token-a' },
        payload: { title: '  Ревизор  ', status: 'draft', premiereDate: '2026-12-01' },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual({
        id: 'production-a',
        title: 'Ревизор',
        status: 'draft',
        premiereDate: '2026-12-01',
        producerMembershipId: null,
        healthStatus: 'neutral',
        healthReason: null,
      });
      expect(createCalls).toEqual([{
        context: expect.objectContaining({ tenantId: 'tenant-a', membershipId: 'membership-a' }),
        input: { title: 'Ревизор', status: 'draft', premiereDate: '2026-12-01', producerMembershipId: null },
      }]);
    } finally {
      await app.close();
    }
  });

  it('rejects a production producer outside the tenant on create and update', async () => {
    const authenticator: SessionAuthenticator = {
      async authenticate() {
        return {
          userId: 'user-a',
          membership: { id: 'membership-a', tenantId: 'tenant-a', userId: 'user-a', isActive: true },
        };
      },
    };
    const app = await createApiApp({
      sessionAuthenticator: authenticator,
      permissionResolver: { async hasPermission() { return true; } },
      productionRepository: {
        async createProduction() {
          throw new ProductionProducerNotFoundError('11111111-1111-4111-8111-111111111111');
        },
        async listProductions() {
          return [];
        },
        async updateProduction() {
          throw new ProductionProducerNotFoundError('11111111-1111-4111-8111-111111111111');
        },
      },
    } as never);

    try {
      const create = await app.inject({
        method: 'POST',
        url: '/v1/productions',
        headers: { authorization: 'Bearer token-a' },
        payload: {
          title: 'Ревизор',
          status: 'draft',
          producerMembershipId: '11111111-1111-4111-8111-111111111111',
        },
      });
      const update = await app.inject({
        method: 'PATCH',
        url: '/v1/productions/production-a',
        headers: { authorization: 'Bearer token-a' },
        payload: {
          title: 'Ревизор',
          status: 'draft',
          producerMembershipId: '11111111-1111-4111-8111-111111111111',
        },
      });

      expect(create.statusCode).toBe(400);
      expect(update.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('lists productions and updates one within the authenticated tenant, 404s for an unknown one', async () => {
    const authenticator: SessionAuthenticator = {
      async authenticate() {
        return {
          userId: 'user-a',
          membership: { id: 'membership-a', tenantId: 'tenant-a', userId: 'user-a', isActive: true },
        };
      },
    };
    const productions = [
      { id: 'production-a', title: 'Гроза', status: 'draft', premiereDate: null, producerMembershipId: null, healthStatus: 'neutral', healthReason: null },
    ];
    const app = await createApiApp({
      sessionAuthenticator: authenticator,
      permissionResolver: { async hasPermission() { return true; } },
      productionRepository: {
        async createProduction() {
          throw new Error('not used in this test');
        },
        async listProductions() {
          return productions;
        },
        async updateProduction(_: unknown, productionId: string) {
          return productionId === 'production-a'
            ? { ...productions[0], status: 'in_progress' }
            : null;
        },
      },
    } as never);

    try {
      const list = await app.inject({
        method: 'GET',
        url: '/v1/productions',
        headers: { authorization: 'Bearer token-a' },
      });
      const found = await app.inject({
        method: 'PATCH',
        url: '/v1/productions/production-a',
        headers: { authorization: 'Bearer token-a' },
        payload: { title: 'Гроза', status: 'in_progress' },
      });
      const notFound = await app.inject({
        method: 'PATCH',
        url: '/v1/productions/production-from-tenant-b',
        headers: { authorization: 'Bearer token-a' },
        payload: { title: 'Гроза', status: 'in_progress' },
      });

      expect(list.statusCode).toBe(200);
      expect(list.json()).toEqual(productions);
      expect(found.statusCode).toBe(200);
      expect(found.json()).toMatchObject({ id: 'production-a', status: 'in_progress' });
      expect(notFound.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('returns a single production by id, 404s for an unknown or malformed one', async () => {
    const authenticator: SessionAuthenticator = {
      async authenticate() {
        return {
          userId: 'user-a',
          membership: { id: 'membership-a', tenantId: 'tenant-a', userId: 'user-a', isActive: true },
        };
      },
    };
    const production = {
      id: '11111111-1111-4111-8111-111111111111',
      title: 'Гроза',
      status: 'draft',
      premiereDate: null,
      producerMembershipId: null,
      healthStatus: 'neutral',
      healthReason: null,
    };
    const app = await createApiApp({
      sessionAuthenticator: authenticator,
      permissionResolver: { async hasPermission() { return true; } },
      productionRepository: {
        async createProduction() {
          throw new Error('not used in this test');
        },
        async listProductions() {
          throw new Error('not used in this test');
        },
        async updateProduction() {
          throw new Error('not used in this test');
        },
        async getProduction(_: unknown, productionId: string) {
          return productionId === production.id ? production : null;
        },
      },
    } as never);

    try {
      const found = await app.inject({
        method: 'GET',
        url: `/v1/productions/${production.id}`,
        headers: { authorization: 'Bearer token-a' },
      });
      const notFound = await app.inject({
        method: 'GET',
        url: '/v1/productions/22222222-2222-4222-8222-222222222222',
        headers: { authorization: 'Bearer token-a' },
      });
      const malformed = await app.inject({
        method: 'GET',
        url: '/v1/productions/not-a-uuid',
        headers: { authorization: 'Bearer token-a' },
      });

      expect(found.statusCode).toBe(200);
      expect(found.json()).toEqual(production);
      expect(notFound.statusCode).toBe(404);
      expect(malformed.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('rejects unauthenticated budget creation and retrieval', async () => {
    const app = await createApiApp();

    try {
      const create = await app.inject({
        method: 'POST',
        url: '/v1/productions/11111111-1111-4111-8111-111111111111/budgets',
        payload: { sections: [] },
      });
      const read = await app.inject({
        method: 'GET',
        url: '/v1/budgets/11111111-1111-4111-8111-111111111111',
      });

      expect(create.statusCode).toBe(401);
      expect(read.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('rejects an invalid budget payload before checking authorization', async () => {
    const app = await createApiApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/productions/11111111-1111-4111-8111-111111111111/budgets',
        payload: { sections: [{ workshopId: 'not-a-uuid', title: 'Пошивочный', items: [] }] },
      });

      expect(response.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('creates a budget within the authenticated tenant', async () => {
    const authenticator: SessionAuthenticator = {
      async authenticate() {
        return {
          userId: 'user-a',
          membership: { id: 'membership-a', tenantId: 'tenant-a', userId: 'user-a', isActive: true },
        };
      },
    };
    const productionId = '11111111-1111-4111-8111-111111111111';
    const workshopId = '22222222-2222-4222-8222-222222222222';
    const createCalls: unknown[] = [];
    const app = await createApiApp({
      sessionAuthenticator: authenticator,
      permissionResolver: { async hasPermission() { return true; } },
      budgetRepository: {
        async createBudget(context: unknown, input: unknown) {
          createCalls.push({ context, input });
          return {
            id: 'budget-a',
            productionId,
            status: 'PRELIMINARY',
            versionId: 'version-a',
            revision: 1,
            sections: [{
              id: 'section-a',
              workshopId,
              title: 'Пошивочный цех',
              items: [{ id: 'item-a', description: 'Ткань', quantity: '2.5', unit: 'м', unitPrice: '150.00', total: '375.00' }],
              subtotal: '375.00',
            }],
            total: '375.00',
          };
        },
        async getBudget() {
          return null;
        },
      },
    } as never);

    try {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/productions/${productionId}/budgets`,
        headers: { authorization: 'Bearer token-a' },
        payload: {
          sections: [{
            workshopId,
            title: 'Пошивочный цех',
            items: [{ description: 'Ткань', quantity: '2.5', unit: 'м', unitPrice: '150.00' }],
          }],
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({ id: 'budget-a', total: '375.00' });
      expect(createCalls).toEqual([{
        context: expect.objectContaining({ tenantId: 'tenant-a', membershipId: 'membership-a' }),
        input: {
          productionId,
          sections: [{
            workshopId,
            title: 'Пошивочный цех',
            items: [{ description: 'Ткань', quantity: '2.5', unit: 'м', unitPrice: '150.00' }],
          }],
        },
      }]);
    } finally {
      await app.close();
    }
  });

  it('maps budget repository errors to the matching HTTP status', async () => {
    const authenticator: SessionAuthenticator = {
      async authenticate() {
        return {
          userId: 'user-a',
          membership: { id: 'membership-a', tenantId: 'tenant-a', userId: 'user-a', isActive: true },
        };
      },
    };
    const productionNotFoundId = '11111111-1111-4111-8111-111111111111';
    const alreadyExistsId = '22222222-2222-4222-8222-222222222222';
    const workshopNotFoundId = '33333333-3333-4333-8333-333333333333';
    const app = await createApiApp({
      sessionAuthenticator: authenticator,
      permissionResolver: { async hasPermission() { return true; } },
      budgetRepository: {
        async createBudget(_: unknown, input: { productionId: string }) {
          if (input.productionId === productionNotFoundId) throw new BudgetProductionNotFoundError(input.productionId);
          if (input.productionId === alreadyExistsId) throw new BudgetAlreadyExistsError(input.productionId);
          throw new BudgetSectionWorkshopNotFoundError(workshopNotFoundId);
        },
        async getBudget() {
          return null;
        },
      },
    } as never);

    try {
      const notFound = await app.inject({
        method: 'POST',
        url: `/v1/productions/${productionNotFoundId}/budgets`,
        headers: { authorization: 'Bearer token-a' },
        payload: { sections: [] },
      });
      const alreadyExists = await app.inject({
        method: 'POST',
        url: `/v1/productions/${alreadyExistsId}/budgets`,
        headers: { authorization: 'Bearer token-a' },
        payload: { sections: [] },
      });
      const workshopMissing = await app.inject({
        method: 'POST',
        url: `/v1/productions/${workshopNotFoundId}/budgets`,
        headers: { authorization: 'Bearer token-a' },
        payload: { sections: [] },
      });

      expect(notFound.statusCode).toBe(404);
      expect(alreadyExists.statusCode).toBe(409);
      expect(workshopMissing.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('returns a budget by id and 404s for an unknown or malformed one', async () => {
    const authenticator: SessionAuthenticator = {
      async authenticate() {
        return {
          userId: 'user-a',
          membership: { id: 'membership-a', tenantId: 'tenant-a', userId: 'user-a', isActive: true },
        };
      },
    };
    const budget = {
      id: '11111111-1111-4111-8111-111111111111',
      productionId: '22222222-2222-4222-8222-222222222222',
      status: 'PRELIMINARY',
      versionId: 'version-a',
      revision: 1,
      sections: [],
      total: '0.00',
    };
    const app = await createApiApp({
      sessionAuthenticator: authenticator,
      permissionResolver: { async hasPermission() { return true; } },
      budgetRepository: {
        async createBudget() {
          throw new Error('not used in this test');
        },
        async getBudget(_: unknown, budgetId: string) {
          return budgetId === budget.id ? budget : null;
        },
      },
    } as never);

    try {
      const found = await app.inject({
        method: 'GET',
        url: `/v1/budgets/${budget.id}`,
        headers: { authorization: 'Bearer token-a' },
      });
      const notFound = await app.inject({
        method: 'GET',
        url: '/v1/budgets/33333333-3333-4333-8333-333333333333',
        headers: { authorization: 'Bearer token-a' },
      });
      const malformed = await app.inject({
        method: 'GET',
        url: '/v1/budgets/not-a-uuid',
        headers: { authorization: 'Bearer token-a' },
      });

      expect(found.statusCode).toBe(200);
      expect(found.json()).toEqual(budget);
      expect(notFound.statusCode).toBe(404);
      expect(malformed.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('returns a budget by production id, 404s when the production has none', async () => {
    const authenticator: SessionAuthenticator = {
      async authenticate() {
        return {
          userId: 'user-a',
          membership: { id: 'membership-a', tenantId: 'tenant-a', userId: 'user-a', isActive: true },
        };
      },
    };
    const productionWithBudgetId = '11111111-1111-4111-8111-111111111111';
    const productionWithoutBudgetId = '22222222-2222-4222-8222-222222222222';
    const budget = {
      id: 'budget-a',
      productionId: productionWithBudgetId,
      status: 'PRELIMINARY',
      versionId: 'version-a',
      revision: 1,
      sections: [],
      total: '0.00',
    };
    const app = await createApiApp({
      sessionAuthenticator: authenticator,
      permissionResolver: { async hasPermission() { return true; } },
      budgetRepository: {
        async createBudget() {
          throw new Error('not used in this test');
        },
        async getBudget() {
          throw new Error('not used in this test');
        },
        async getBudgetByProductionId(_: unknown, productionId: string) {
          return productionId === productionWithBudgetId ? budget : null;
        },
      },
    } as never);

    try {
      const found = await app.inject({
        method: 'GET',
        url: `/v1/productions/${productionWithBudgetId}/budget`,
        headers: { authorization: 'Bearer token-a' },
      });
      const missing = await app.inject({
        method: 'GET',
        url: `/v1/productions/${productionWithoutBudgetId}/budget`,
        headers: { authorization: 'Bearer token-a' },
      });

      expect(found.statusCode).toBe(200);
      expect(found.json()).toEqual(budget);
      expect(missing.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('approves a budget, 409s if already approved, 404s for an unknown one', async () => {
    const authenticator: SessionAuthenticator = {
      async authenticate() {
        return {
          userId: 'user-a',
          membership: { id: 'membership-a', tenantId: 'tenant-a', userId: 'user-a', isActive: true },
        };
      },
    };
    const draftId = '11111111-1111-4111-8111-111111111111';
    const alreadyApprovedId = '22222222-2222-4222-8222-222222222222';
    const unknownId = '33333333-3333-4333-8333-333333333333';
    const app = await createApiApp({
      sessionAuthenticator: authenticator,
      permissionResolver: { async hasPermission() { return true; } },
      budgetRepository: {
        async createBudget() {
          throw new Error('not used in this test');
        },
        async getBudget() {
          throw new Error('not used in this test');
        },
        async getBudgetByProductionId() {
          throw new Error('not used in this test');
        },
        async approveBudget(_: unknown, budgetId: string) {
          if (budgetId === draftId) {
            return { id: draftId, productionId: 'production-a', status: 'APPROVED', versionId: 'v-1', revision: 1, sections: [], total: '0.00' };
          }
          if (budgetId === alreadyApprovedId) throw new BudgetAlreadyApprovedError(alreadyApprovedId);
          return null;
        },
      },
    } as never);

    try {
      const approved = await app.inject({
        method: 'POST',
        url: `/v1/budgets/${draftId}/approve`,
        headers: { authorization: 'Bearer token-a' },
      });
      const conflict = await app.inject({
        method: 'POST',
        url: `/v1/budgets/${alreadyApprovedId}/approve`,
        headers: { authorization: 'Bearer token-a' },
      });
      const notFound = await app.inject({
        method: 'POST',
        url: `/v1/budgets/${unknownId}/approve`,
        headers: { authorization: 'Bearer token-a' },
      });

      expect(approved.statusCode).toBe(200);
      expect(approved.json()).toMatchObject({ id: draftId, status: 'APPROVED' });
      expect(conflict.statusCode).toBe(409);
      expect(notFound.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('creates a password-authenticated session without caching the access token', async () => {
    const localPasswordAuthenticator = {
      async login(input: { email: string; password: string }) {
        return input.email === 'admin@example.test' && input.password === 'correct password'
          ? {
              accessToken: 'opaque-access-token',
              expiresAt: new Date('2026-09-03T13:00:00.000Z'),
            }
          : null;
      },
      async authenticate() {
        return null;
      },
    };
    const app = await createApiApp({ localPasswordAuthenticator });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email: 'admin@example.test', password: 'correct password' },
      });

      expect(response.statusCode).toBe(201);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json()).toEqual({
        accessToken: 'opaque-access-token',
        expiresAt: '2026-09-03T13:00:00.000Z',
      });
    } finally {
      await app.close();
    }
  });

  it('protects the admin session endpoint with backend permission authorization', async () => {
    const authenticator: SessionAuthenticator = {
      async authenticate(accessToken) {
        return accessToken === 'valid-access-token'
          ? {
              userId: 'user-1',
              membership: {
                id: 'membership-1',
                tenantId: 'tenant-a',
                userId: 'user-1',
                isActive: true,
              },
            }
          : null;
      },
    };
    const permissionResolver: PermissionResolver = {
      async hasPermission(_, permission) {
        return permission === 'platform.admin';
      },
    };
    const app = await createApiApp({ sessionAuthenticator: authenticator, permissionResolver });
    const deniedApp = await createApiApp({
      sessionAuthenticator: authenticator,
      permissionResolver: { async hasPermission() { return false; } },
    });

    try {
      const allowed = await app.inject({
        method: 'GET',
        url: '/v1/admin/session',
        headers: { authorization: 'Bearer valid-access-token' },
      });
      const denied = await deniedApp.inject({
        method: 'GET',
        url: '/v1/admin/session',
        headers: { authorization: 'Bearer valid-access-token' },
      });

      expect(allowed.statusCode).toBe(200);
      expect(allowed.json()).toMatchObject({ tenantId: 'tenant-a' });
      expect(denied.statusCode).toBe(403);
    } finally {
      await app.close();
      await deniedApp.close();
    }
  });

  it('returns not found and does not rename a role outside the authenticated tenant', async () => {
    const authenticator: SessionAuthenticator = {
      async authenticate() {
        return {
          userId: 'user-a',
          membership: { id: 'membership-a', tenantId: 'tenant-a', userId: 'user-a', isActive: true },
        };
      },
    };
    let renameCalls = 0;
    const app = await createApiApp({
      sessionAuthenticator: authenticator,
      permissionResolver: { async hasPermission() { return true; } },
      roleRepository: {
        async findById(_, roleId) {
          return roleId === 'role-a' ? { id: 'role-a', name: 'admin' } : null;
        },
        async rename(_, roleId, name) {
          renameCalls += 1;
          return roleId === 'role-a' ? { id: 'role-a', name } : null;
        },
      },
    });

    try {
      const read = await app.inject({
        method: 'GET',
        url: '/v1/admin/roles/role-from-tenant-b',
        headers: { authorization: 'Bearer token-a' },
      });
      const rename = await app.inject({
        method: 'PATCH',
        url: '/v1/admin/roles/role-from-tenant-b',
        headers: { authorization: 'Bearer token-a' },
        payload: { name: 'forged name' },
      });
      const ownRead = await app.inject({
        method: 'GET',
        url: '/v1/admin/roles/role-a',
        headers: { authorization: 'Bearer token-a' },
      });
      const ownRename = await app.inject({
        method: 'PATCH',
        url: '/v1/admin/roles/role-a',
        headers: { authorization: 'Bearer token-a' },
        payload: { name: 'producer' },
      });

      expect(read.statusCode).toBe(404);
      expect(rename.statusCode).toBe(404);
      expect(ownRead.statusCode).toBe(200);
      expect(ownRename.statusCode).toBe(200);
      expect(renameCalls).toBe(2);
    } finally {
      await app.close();
    }
  });
});

describe('request logging', () => {
  it('stays silent by default so app.inject() in tests does not emit log lines', async () => {
    const app = await createApiApp();

    try {
      expect(app.log.level).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('logs a per-request correlation id and redacts the Authorization header when enabled', async () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const authenticator: SessionAuthenticator = {
      async authenticate(accessToken) {
        return accessToken === 'super-secret-token'
          ? {
              userId: 'user-1',
              membership: { id: 'membership-1', tenantId: 'tenant-a', userId: 'user-1', isActive: true },
            }
          : null;
      },
    };
    const app = await createApiApp({
      sessionAuthenticator: authenticator,
      requestLogging: { stream },
    });

    let sessionRequestId: string;
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/session',
        headers: { authorization: 'Bearer super-secret-token' },
      });
      expect(response.statusCode).toBe(200);
      sessionRequestId = response.json<{ requestId: string }>().requestId;
    } finally {
      await app.close();
    }

    const logged = chunks.join('\n');
    const lines = logged
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(logged).not.toContain('super-secret-token');
    const withReqId = lines.filter((line) => typeof line.reqId === 'string' && line.reqId.length > 0);
    expect(withReqId.length).toBeGreaterThan(0);
    // TenantContext.requestId must be the real Fastify per-request id, not an
    // unrelated randomUUID() minted independently inside the auth path.
    expect(withReqId.every((line) => line.reqId === sessionRequestId)).toBe(true);

    const requestLine = lines.find(
      (line) => (line.req as Record<string, unknown> | undefined)?.headers !== undefined,
    );
    expect(requestLine).toBeDefined();
    expect((requestLine!.req as { headers: Record<string, unknown> }).headers.authorization).toBe('[Redacted]');
  });
});
