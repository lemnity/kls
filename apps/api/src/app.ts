import { Body,
  BadRequestException,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
  type DynamicModule,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PermissionResolver } from '@kulisa/domain/permission-authorizer';
import type { TenantContext } from '@kulisa/domain/tenant-context';
import type { StoredRole } from '@kulisa/db/role-repository';
import {
  OrgUnitCycleError,
  OrgUnitParentNotFoundError,
  type OrgUnitListItem,
  type StoredOrgUnit,
} from '@kulisa/db/organization-repository';
import {
  MembershipAlreadyExistsError,
  MembershipRoleNotFoundError,
  MembershipUserNotFoundError,
  type MembershipListItem,
  type StoredMembership,
} from '@kulisa/db/membership-repository';
import {
  ProductionProducerNotFoundError,
  type ProductionInput,
  type StoredProduction,
} from '@kulisa/db/production-repository';
import {
  BudgetAlreadyApprovedError,
  BudgetAlreadyExistsError,
  BudgetProductionNotFoundError,
  BudgetSectionWorkshopNotFoundError,
  type BudgetSectionInput,
  type CreateBudgetInput,
  type StoredBudget,
} from '@kulisa/db/budget-repository';
import {
  WorkshopManagerNotFoundError,
  WorkshopNameAlreadyExistsError,
  type StoredWorkshop,
} from '@kulisa/db/workshop-repository';
import {
  WorkshopTaskAlreadyExistsError,
  WorkshopTaskAssigneeNotFoundError,
  WorkshopTaskBudgetItemNotFoundError,
  WorkshopTaskBudgetNotApprovedError,
  WorkshopTaskClosedError,
  WorkshopTaskInvalidTransitionError,
  type CreateTaskFromBudgetItemInput,
  type StoredWorkshopTask,
} from '@kulisa/db/workshop-task-repository';

import {
  SessionAuthorizationError,
  SessionAuthenticationError,
  authorizeRequest,
  authenticateRequest,
  type SessionAuthenticator,
} from './session.js';

export interface ReadinessProbe {
  name: string;
  check(): Promise<boolean>;
}

export interface ApiAppOptions {
  readinessProbes?: readonly ReadinessProbe[];
  sessionAuthenticator?: SessionAuthenticator;
  localPasswordAuthenticator?: LocalPasswordAuthenticator;
  permissionResolver?: PermissionResolver;
  roleRepository?: RoleRepository;
  organizationRepository?: OrganizationRepository;
  membershipRepository?: MembershipRepository;
  productionRepository?: ProductionRepository;
  budgetRepository?: BudgetRepository;
  workshopRepository?: WorkshopRepository;
  workshopTaskRepository?: WorkshopTaskRepository;
  /**
   * Enables Fastify's built-in per-request pino logging with the
   * Authorization/cookie headers redacted (every request always gets a
   * random correlation id via `genReqId`, independent of this flag — it
   * is also what `TenantContext.requestId` carries). Off by default so
   * `app.inject()` in tests stays quiet. Pass `{ stream }` to send log
   * lines to a custom destination (tests, or a log aggregator) instead
   * of stdout.
   */
  requestLogging?: boolean | { stream: NodeJS.WritableStream };
}

export interface LocalPasswordAuthenticator extends SessionAuthenticator {
  login(input: {
    email: string;
    password: string;
  }): Promise<{ accessToken: string; expiresAt: Date } | null>;
}

export interface RoleRepository {
  findById(context: TenantContext, roleId: string): Promise<StoredRole | null>;
  rename(
    context: TenantContext,
    roleId: string,
    name: string,
  ): Promise<StoredRole | null>;
}

export interface OrganizationRepository {
  createOrgUnit(
    context: TenantContext,
    input: {
      name: string;
      type: string;
      parentId?: string;
      managerMembershipId?: string;
    },
  ): Promise<StoredOrgUnit>;
  moveOrgUnit(
    context: TenantContext,
    orgUnitId: string,
    newParentId: string | null,
  ): Promise<StoredOrgUnit | null>;
  deactivateOrgUnit(context: TenantContext, orgUnitId: string): Promise<StoredOrgUnit | null>;
  listOrgUnits(context: TenantContext): Promise<OrgUnitListItem[]>;
}

export interface MembershipRepository {
  createMembership(
    context: TenantContext,
    input: { userId: string; roleId?: string },
  ): Promise<StoredMembership>;
  deactivateMembership(
    context: TenantContext,
    membershipId: string,
  ): Promise<StoredMembership | null>;
  listMemberships(context: TenantContext): Promise<MembershipListItem[]>;
}

export interface ProductionRepository {
  createProduction(context: TenantContext, input: ProductionInput): Promise<StoredProduction>;
  getProduction(context: TenantContext, productionId: string): Promise<StoredProduction | null>;
  listProductions(context: TenantContext): Promise<StoredProduction[]>;
  updateProduction(
    context: TenantContext,
    productionId: string,
    input: ProductionInput,
  ): Promise<StoredProduction | null>;
}

export interface BudgetRepository {
  createBudget(context: TenantContext, input: CreateBudgetInput): Promise<StoredBudget>;
  getBudget(context: TenantContext, budgetId: string): Promise<StoredBudget | null>;
  getBudgetByProductionId(context: TenantContext, productionId: string): Promise<StoredBudget | null>;
  approveBudget(context: TenantContext, budgetId: string): Promise<StoredBudget | null>;
}

export interface WorkshopRepository {
  createWorkshop(
    context: TenantContext,
    input: { name: string; managerMembershipId?: string },
  ): Promise<StoredWorkshop>;
  assignWorkshopManager(
    context: TenantContext,
    workshopId: string,
    managerMembershipId: string | null,
  ): Promise<StoredWorkshop | null>;
  listWorkshops(context: TenantContext): Promise<StoredWorkshop[]>;
}

export interface WorkshopTaskRepository {
  createTaskFromBudgetItem(
    context: TenantContext,
    input: CreateTaskFromBudgetItemInput,
  ): Promise<StoredWorkshopTask>;
  listTasksByWorkshop(context: TenantContext, workshopId: string): Promise<StoredWorkshopTask[]>;
  assignTask(context: TenantContext, taskId: string, assigneeMembershipId: string): Promise<StoredWorkshopTask | null>;
  acceptTask(context: TenantContext, taskId: string): Promise<StoredWorkshopTask | null>;
  completeTask(context: TenantContext, taskId: string): Promise<StoredWorkshopTask | null>;
  closeTask(context: TenantContext, taskId: string): Promise<StoredWorkshopTask | null>;
  rescheduleTaskDeadline(
    context: TenantContext,
    taskId: string,
    newDeadlineAt: string | null,
    reason: string,
  ): Promise<StoredWorkshopTask | null>;
}

const READINESS_PROBES = Symbol('READINESS_PROBES');
const SESSION_AUTHENTICATOR = Symbol('SESSION_AUTHENTICATOR');
const LOCAL_PASSWORD_AUTHENTICATOR = Symbol('LOCAL_PASSWORD_AUTHENTICATOR');
const PERMISSION_RESOLVER = Symbol('PERMISSION_RESOLVER');
const ROLE_REPOSITORY = Symbol('ROLE_REPOSITORY');
const ORGANIZATION_REPOSITORY = Symbol('ORGANIZATION_REPOSITORY');
const MEMBERSHIP_REPOSITORY = Symbol('MEMBERSHIP_REPOSITORY');
const PRODUCTION_REPOSITORY = Symbol('PRODUCTION_REPOSITORY');
const BUDGET_REPOSITORY = Symbol('BUDGET_REPOSITORY');
const WORKSHOP_REPOSITORY = Symbol('WORKSHOP_REPOSITORY');
const WORKSHOP_TASK_REPOSITORY = Symbol('WORKSHOP_TASK_REPOSITORY');

@Controller()
class HealthController {
  public constructor(
    @Inject(READINESS_PROBES)
    private readonly readinessProbes: readonly ReadinessProbe[],
    @Inject(SESSION_AUTHENTICATOR)
    private readonly sessionAuthenticator: SessionAuthenticator | null,
    @Inject(LOCAL_PASSWORD_AUTHENTICATOR)
    private readonly localPasswordAuthenticator: LocalPasswordAuthenticator | null,
    @Inject(PERMISSION_RESOLVER)
    private readonly permissionResolver: PermissionResolver | null,
    @Inject(ROLE_REPOSITORY)
    private readonly roleRepository: RoleRepository | null,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository | null,
    @Inject(MEMBERSHIP_REPOSITORY)
    private readonly membershipRepository: MembershipRepository | null,
    @Inject(PRODUCTION_REPOSITORY)
    private readonly productionRepository: ProductionRepository | null,
    @Inject(BUDGET_REPOSITORY)
    private readonly budgetRepository: BudgetRepository | null,
    @Inject(WORKSHOP_REPOSITORY)
    private readonly workshopRepository: WorkshopRepository | null,
    @Inject(WORKSHOP_TASK_REPOSITORY)
    private readonly workshopTaskRepository: WorkshopTaskRepository | null,
  ) {}

  @Get('health')
  public health(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  public async ready(
    @Res({ passthrough: true }) response: { code(statusCode: number): void },
  ): Promise<{ status: 'ok' | 'unavailable' }> {
    const results = await Promise.all(
      this.readinessProbes.map(async (probe) => {
        try {
          return await probe.check();
        } catch {
          return false;
        }
      }),
    );
    const isReady =
      this.readinessProbes.length > 0 && results.every(Boolean);

    if (!isReady) {
      response.code(HttpStatus.SERVICE_UNAVAILABLE);
      return { status: 'unavailable' };
    }

    return { status: 'ok' };
  }

  @Get('v1/session')
  public async session(
    @Req() request: FastifyRequest,
  ): Promise<{
    requestId: string;
    userId: string;
    membershipId: string;
    tenantId: string;
  }> {
    if (!this.sessionAuthenticator) {
      throw new UnauthorizedException();
    }

    try {
      return await authenticateRequest({
        authorization: request.headers.authorization,
        requestId: request.id,
        authenticator: this.sessionAuthenticator,
      });
    } catch (error) {
      if (error instanceof SessionAuthenticationError) {
        throw new UnauthorizedException();
      }

      throw error;
    }
  }

  @Get('v1/admin/session')
  public async adminSession(
    @Req() request: FastifyRequest,
  ): Promise<{
    requestId: string;
    userId: string;
    membershipId: string;
    tenantId: string;
  }> {
    if (!this.sessionAuthenticator) throw new UnauthorizedException();
    if (!this.permissionResolver) throw new ForbiddenException();

    try {
      return await authorizeRequest({
        authorization: request.headers.authorization,
        requestId: request.id,
        authenticator: this.sessionAuthenticator,
        permission: 'platform.admin',
        resolver: this.permissionResolver,
      });
    } catch (error) {
      if (error instanceof SessionAuthenticationError) {
        throw new UnauthorizedException();
      }
      if (error instanceof SessionAuthorizationError) {
        throw new ForbiddenException();
      }

      throw error;
    }
  }

  @Get('v1/admin/roles/:roleId')
  public async role(
    @Req() request: FastifyRequest,
    @Param('roleId') roleId: string,
  ): Promise<StoredRole> {
    const context = await this.requirePlatformAdmin(request);
    const role = await this.roleRepository?.findById(context, roleId);
    if (!role) throw new NotFoundException();
    return role;
  }

  @Patch('v1/admin/roles/:roleId')
  public async renameRole(
    @Req() request: FastifyRequest,
    @Param('roleId') roleId: string,
    @Body() body: unknown,
  ): Promise<StoredRole> {
    const name = readRoleName(body);
    if (!name) throw new BadRequestException('Invalid role payload');

    const context = await this.requirePlatformAdmin(request);
    const role = await this.roleRepository?.rename(context, roleId, name);
    if (!role) throw new NotFoundException();
    return role;
  }

  @Post('v1/auth/login')
  @Header('cache-control', 'no-store')
  public async login(
    @Body() body: unknown,
  ): Promise<{ accessToken: string; expiresAt: Date }> {
    const input = readLoginInput(body);
    if (!input) throw new BadRequestException('Invalid login payload');
    if (!this.localPasswordAuthenticator) throw new UnauthorizedException();

    const session = await this.localPasswordAuthenticator.login(input);
    if (!session) throw new UnauthorizedException();
    return session;
  }

  @Post('v1/organization/org-units')
  public async createOrgUnit(
    @Req() request: FastifyRequest,
    @Body() body: unknown,
  ): Promise<StoredOrgUnit> {
    const input = readOrgUnitInput(body);
    if (!input) throw new BadRequestException('Invalid org unit payload');

    const context = await this.requirePlatformAdmin(request);
    if (!this.organizationRepository) {
      throw new ServiceUnavailableException('Organization service is not configured');
    }
    try {
      return await this.organizationRepository.createOrgUnit(context, input);
    } catch (error) {
      if (error instanceof OrgUnitParentNotFoundError) {
        throw new BadRequestException('Parent org unit not found in tenant');
      }
      throw error;
    }
  }

  @Patch('v1/organization/org-units/:orgUnitId/move')
  public async moveOrgUnit(
    @Req() request: FastifyRequest,
    @Param('orgUnitId') orgUnitId: string,
    @Body() body: unknown,
  ): Promise<StoredOrgUnit> {
    const input = readMoveOrgUnitInput(body);
    if (!input) throw new BadRequestException('Invalid move payload');

    const context = await this.requirePlatformAdmin(request);
    if (!this.organizationRepository) {
      throw new ServiceUnavailableException('Organization service is not configured');
    }
    if (!UUID_PATTERN.test(orgUnitId)) throw new NotFoundException();

    try {
      const orgUnit = await this.organizationRepository.moveOrgUnit(context, orgUnitId, input.parentId);
      if (!orgUnit) throw new NotFoundException();
      return orgUnit;
    } catch (error) {
      throw this.mapOrgUnitMoveError(error);
    }
  }

  private mapOrgUnitMoveError(error: unknown): Error {
    if (error instanceof OrgUnitParentNotFoundError) {
      return new BadRequestException('Parent org unit not found in tenant');
    }
    if (error instanceof OrgUnitCycleError) {
      return new BadRequestException('Moving this org unit under the given parent would create a cycle');
    }
    if (error instanceof NotFoundException) return error;
    return error instanceof Error ? error : new Error(String(error));
  }

  @Delete('v1/organization/org-units/:orgUnitId')
  @HttpCode(HttpStatus.OK)
  public async deactivateOrgUnit(
    @Req() request: FastifyRequest,
    @Param('orgUnitId') orgUnitId: string,
  ): Promise<StoredOrgUnit> {
    const context = await this.requirePlatformAdmin(request);
    if (!this.organizationRepository) {
      throw new ServiceUnavailableException('Organization service is not configured');
    }
    if (!UUID_PATTERN.test(orgUnitId)) throw new NotFoundException();

    const orgUnit = await this.organizationRepository.deactivateOrgUnit(context, orgUnitId);
    if (!orgUnit) throw new NotFoundException();
    return orgUnit;
  }

  @Get('v1/organization/org-units')
  public async listOrgUnits(
    @Req() request: FastifyRequest,
  ): Promise<OrgUnitListItem[]> {
    const context = await this.requirePlatformAdmin(request);
    if (!this.organizationRepository) {
      throw new ServiceUnavailableException('Organization service is not configured');
    }
    return this.organizationRepository.listOrgUnits(context);
  }

  @Post('v1/organization/workshops')
  public async createWorkshop(
    @Req() request: FastifyRequest,
    @Body() body: unknown,
  ): Promise<StoredWorkshop> {
    const input = readWorkshopInput(body);
    if (!input) throw new BadRequestException('Invalid workshop payload');

    const context = await this.requirePlatformAdmin(request);
    if (!this.workshopRepository) {
      throw new ServiceUnavailableException('Workshop service is not configured');
    }
    try {
      return await this.workshopRepository.createWorkshop(context, input);
    } catch (error) {
      throw this.mapWorkshopManagerError(error);
    }
  }

  @Patch('v1/organization/workshops/:workshopId/manager')
  public async assignWorkshopManager(
    @Req() request: FastifyRequest,
    @Param('workshopId') workshopId: string,
    @Body() body: unknown,
  ): Promise<StoredWorkshop> {
    const input = readAssignWorkshopManagerInput(body);
    if (!input) throw new BadRequestException('Invalid manager assignment payload');

    const context = await this.requirePlatformAdmin(request);
    if (!this.workshopRepository) {
      throw new ServiceUnavailableException('Workshop service is not configured');
    }
    if (!UUID_PATTERN.test(workshopId)) throw new NotFoundException();

    try {
      const workshop = await this.workshopRepository.assignWorkshopManager(
        context,
        workshopId,
        input.managerMembershipId,
      );
      if (!workshop) throw new NotFoundException();
      return workshop;
    } catch (error) {
      throw this.mapWorkshopManagerError(error);
    }
  }

  private mapWorkshopManagerError(error: unknown): Error {
    if (error instanceof WorkshopNameAlreadyExistsError) {
      return new ConflictException('Workshop with this name already exists in tenant');
    }
    if (error instanceof WorkshopManagerNotFoundError) {
      return new BadRequestException('Manager membership not found in tenant');
    }
    if (error instanceof NotFoundException) return error;
    return error instanceof Error ? error : new Error(String(error));
  }

  @Get('v1/organization/workshops')
  public async listWorkshops(
    @Req() request: FastifyRequest,
  ): Promise<StoredWorkshop[]> {
    const context = await this.requirePlatformAdmin(request);
    if (!this.workshopRepository) {
      throw new ServiceUnavailableException('Workshop service is not configured');
    }
    return this.workshopRepository.listWorkshops(context);
  }

  @Post('v1/budget-items/:budgetItemId/tasks')
  public async createTaskFromBudgetItem(
    @Req() request: FastifyRequest,
    @Param('budgetItemId') budgetItemId: string,
    @Body() body: unknown,
  ): Promise<StoredWorkshopTask> {
    const input = readCreateTaskInput(body);
    if (!input) throw new BadRequestException('Invalid task payload');
    if (!UUID_PATTERN.test(budgetItemId)) throw new NotFoundException();

    const context = await this.requirePlatformAdmin(request);
    if (!this.workshopTaskRepository) {
      throw new ServiceUnavailableException('Workshop task service is not configured');
    }
    try {
      return await this.workshopTaskRepository.createTaskFromBudgetItem(context, { budgetItemId, ...input });
    } catch (error) {
      if (error instanceof WorkshopTaskBudgetItemNotFoundError) throw new NotFoundException();
      if (error instanceof WorkshopTaskBudgetNotApprovedError) {
        throw new BadRequestException('Budget item belongs to a budget that is not approved');
      }
      if (error instanceof WorkshopTaskAlreadyExistsError) {
        throw new ConflictException('Budget item already has a workshop task');
      }
      if (error instanceof WorkshopTaskAssigneeNotFoundError) {
        throw new BadRequestException('Assignee not found in tenant');
      }
      throw error;
    }
  }

  @Get('v1/organization/workshops/:workshopId/tasks')
  public async listWorkshopTasks(
    @Req() request: FastifyRequest,
    @Param('workshopId') workshopId: string,
  ): Promise<StoredWorkshopTask[]> {
    const context = await this.requirePlatformAdmin(request);
    if (!this.workshopTaskRepository) {
      throw new ServiceUnavailableException('Workshop task service is not configured');
    }
    if (!UUID_PATTERN.test(workshopId)) return [];

    return this.workshopTaskRepository.listTasksByWorkshop(context, workshopId);
  }

  @Patch('v1/workshop-tasks/:taskId/assign')
  public async assignWorkshopTask(
    @Req() request: FastifyRequest,
    @Param('taskId') taskId: string,
    @Body() body: unknown,
  ): Promise<StoredWorkshopTask> {
    const assigneeMembershipId = readAssigneeMembershipId(body);
    if (!assigneeMembershipId) throw new BadRequestException('Invalid task payload');

    const context = await this.requirePlatformAdmin(request);
    if (!this.workshopTaskRepository) {
      throw new ServiceUnavailableException('Workshop task service is not configured');
    }
    if (!UUID_PATTERN.test(taskId)) throw new NotFoundException();

    try {
      const task = await this.workshopTaskRepository.assignTask(context, taskId, assigneeMembershipId);
      if (!task) throw new NotFoundException();
      return task;
    } catch (error) {
      throw this.mapTaskTransitionError(error);
    }
  }

  @Post('v1/workshop-tasks/:taskId/accept')
  @HttpCode(HttpStatus.OK)
  public async acceptWorkshopTask(
    @Req() request: FastifyRequest,
    @Param('taskId') taskId: string,
  ): Promise<StoredWorkshopTask> {
    const context = await this.requirePlatformAdmin(request);
    if (!this.workshopTaskRepository) {
      throw new ServiceUnavailableException('Workshop task service is not configured');
    }
    if (!UUID_PATTERN.test(taskId)) throw new NotFoundException();

    try {
      const task = await this.workshopTaskRepository.acceptTask(context, taskId);
      if (!task) throw new NotFoundException();
      return task;
    } catch (error) {
      throw this.mapTaskTransitionError(error);
    }
  }

  @Post('v1/workshop-tasks/:taskId/complete')
  @HttpCode(HttpStatus.OK)
  public async completeWorkshopTask(
    @Req() request: FastifyRequest,
    @Param('taskId') taskId: string,
  ): Promise<StoredWorkshopTask> {
    const context = await this.requirePlatformAdmin(request);
    if (!this.workshopTaskRepository) {
      throw new ServiceUnavailableException('Workshop task service is not configured');
    }
    if (!UUID_PATTERN.test(taskId)) throw new NotFoundException();

    try {
      const task = await this.workshopTaskRepository.completeTask(context, taskId);
      if (!task) throw new NotFoundException();
      return task;
    } catch (error) {
      throw this.mapTaskTransitionError(error);
    }
  }

  @Post('v1/workshop-tasks/:taskId/close')
  @HttpCode(HttpStatus.OK)
  public async closeWorkshopTask(
    @Req() request: FastifyRequest,
    @Param('taskId') taskId: string,
  ): Promise<StoredWorkshopTask> {
    const context = await this.requirePlatformAdmin(request);
    if (!this.workshopTaskRepository) {
      throw new ServiceUnavailableException('Workshop task service is not configured');
    }
    if (!UUID_PATTERN.test(taskId)) throw new NotFoundException();

    try {
      const task = await this.workshopTaskRepository.closeTask(context, taskId);
      if (!task) throw new NotFoundException();
      return task;
    } catch (error) {
      throw this.mapTaskTransitionError(error);
    }
  }

  @Patch('v1/workshop-tasks/:taskId/deadline')
  public async rescheduleWorkshopTaskDeadline(
    @Req() request: FastifyRequest,
    @Param('taskId') taskId: string,
    @Body() body: unknown,
  ): Promise<StoredWorkshopTask> {
    const input = readRescheduleInput(body);
    if (!input) throw new BadRequestException('Invalid reschedule payload');

    const context = await this.requirePlatformAdmin(request);
    if (!this.workshopTaskRepository) {
      throw new ServiceUnavailableException('Workshop task service is not configured');
    }
    if (!UUID_PATTERN.test(taskId)) throw new NotFoundException();

    try {
      const task = await this.workshopTaskRepository.rescheduleTaskDeadline(
        context,
        taskId,
        input.deadlineAt,
        input.reason,
      );
      if (!task) throw new NotFoundException();
      return task;
    } catch (error) {
      throw this.mapTaskTransitionError(error);
    }
  }

  private mapTaskTransitionError(error: unknown): Error {
    if (error instanceof WorkshopTaskInvalidTransitionError) {
      return new ConflictException('Task is not in the expected status for this transition');
    }
    if (error instanceof WorkshopTaskAssigneeNotFoundError) {
      return new BadRequestException('Assignee not found in tenant');
    }
    if (error instanceof WorkshopTaskClosedError) {
      return new ConflictException('Task is closed and cannot be modified');
    }
    if (error instanceof NotFoundException) return error;
    return error instanceof Error ? error : new Error(String(error));
  }

  @Post('v1/organization/memberships')
  public async createMembership(
    @Req() request: FastifyRequest,
    @Body() body: unknown,
  ): Promise<StoredMembership> {
    const input = readMembershipInput(body);
    if (!input) throw new BadRequestException('Invalid membership payload');

    const context = await this.requirePlatformAdmin(request);
    if (!this.membershipRepository) {
      throw new ServiceUnavailableException('Membership service is not configured');
    }
    try {
      return await this.membershipRepository.createMembership(context, input);
    } catch (error) {
      if (error instanceof MembershipUserNotFoundError) {
        throw new BadRequestException('User not found');
      }
      if (error instanceof MembershipRoleNotFoundError) {
        throw new BadRequestException('Role not found in tenant');
      }
      if (error instanceof MembershipAlreadyExistsError) {
        throw new ConflictException('User already has a membership in this tenant');
      }
      throw error;
    }
  }

  @Delete('v1/organization/memberships/:membershipId')
  @HttpCode(HttpStatus.OK)
  public async deactivateMembership(
    @Req() request: FastifyRequest,
    @Param('membershipId') membershipId: string,
  ): Promise<StoredMembership> {
    const context = await this.requirePlatformAdmin(request);
    if (!this.membershipRepository) {
      throw new ServiceUnavailableException('Membership service is not configured');
    }
    const membership = await this.membershipRepository.deactivateMembership(context, membershipId);
    if (!membership) throw new NotFoundException();
    return membership;
  }

  @Get('v1/organization/memberships')
  public async listMemberships(
    @Req() request: FastifyRequest,
  ): Promise<MembershipListItem[]> {
    const context = await this.requirePlatformAdmin(request);
    if (!this.membershipRepository) {
      throw new ServiceUnavailableException('Membership service is not configured');
    }
    return this.membershipRepository.listMemberships(context);
  }

  @Post('v1/productions')
  public async createProduction(
    @Req() request: FastifyRequest,
    @Body() body: unknown,
  ): Promise<StoredProduction> {
    const input = readProductionInput(body);
    if (!input) throw new BadRequestException('Invalid production payload');

    const context = await this.requirePlatformAdmin(request);
    if (!this.productionRepository) {
      throw new ServiceUnavailableException('Production service is not configured');
    }
    try {
      return await this.productionRepository.createProduction(context, input);
    } catch (error) {
      if (error instanceof ProductionProducerNotFoundError) {
        throw new BadRequestException('Producer membership not found in tenant');
      }
      throw error;
    }
  }

  @Get('v1/productions')
  public async listProductions(
    @Req() request: FastifyRequest,
  ): Promise<StoredProduction[]> {
    const context = await this.requirePlatformAdmin(request);
    if (!this.productionRepository) {
      throw new ServiceUnavailableException('Production service is not configured');
    }
    return this.productionRepository.listProductions(context);
  }

  @Get('v1/productions/:productionId')
  public async getProduction(
    @Req() request: FastifyRequest,
    @Param('productionId') productionId: string,
  ): Promise<StoredProduction> {
    const context = await this.requirePlatformAdmin(request);
    if (!this.productionRepository) {
      throw new ServiceUnavailableException('Production service is not configured');
    }
    if (!UUID_PATTERN.test(productionId)) throw new NotFoundException();

    const production = await this.productionRepository.getProduction(context, productionId);
    if (!production) throw new NotFoundException();
    return production;
  }

  @Patch('v1/productions/:productionId')
  public async updateProduction(
    @Req() request: FastifyRequest,
    @Param('productionId') productionId: string,
    @Body() body: unknown,
  ): Promise<StoredProduction> {
    const input = readProductionInput(body);
    if (!input) throw new BadRequestException('Invalid production payload');

    const context = await this.requirePlatformAdmin(request);
    if (!this.productionRepository) {
      throw new ServiceUnavailableException('Production service is not configured');
    }
    try {
      const production = await this.productionRepository.updateProduction(context, productionId, input);
      if (!production) throw new NotFoundException();
      return production;
    } catch (error) {
      if (error instanceof ProductionProducerNotFoundError) {
        throw new BadRequestException('Producer membership not found in tenant');
      }
      throw error;
    }
  }

  @Post('v1/productions/:productionId/budgets')
  public async createBudget(
    @Req() request: FastifyRequest,
    @Param('productionId') productionId: string,
    @Body() body: unknown,
  ): Promise<StoredBudget> {
    const input = readCreateBudgetInput(body);
    if (!input) throw new BadRequestException('Invalid budget payload');
    if (!UUID_PATTERN.test(productionId)) throw new NotFoundException();

    const context = await this.requirePlatformAdmin(request);
    if (!this.budgetRepository) {
      throw new ServiceUnavailableException('Budget service is not configured');
    }
    try {
      return await this.budgetRepository.createBudget(context, { productionId, sections: input.sections });
    } catch (error) {
      if (error instanceof BudgetProductionNotFoundError) throw new NotFoundException();
      if (error instanceof BudgetAlreadyExistsError) {
        throw new ConflictException('Production already has a budget');
      }
      if (error instanceof BudgetSectionWorkshopNotFoundError) {
        throw new BadRequestException('Workshop not found in tenant');
      }
      throw error;
    }
  }

  @Get('v1/budgets/:budgetId')
  public async getBudget(
    @Req() request: FastifyRequest,
    @Param('budgetId') budgetId: string,
  ): Promise<StoredBudget> {
    const context = await this.requirePlatformAdmin(request);
    if (!this.budgetRepository) {
      throw new ServiceUnavailableException('Budget service is not configured');
    }
    if (!UUID_PATTERN.test(budgetId)) throw new NotFoundException();

    const budget = await this.budgetRepository.getBudget(context, budgetId);
    if (!budget) throw new NotFoundException();
    return budget;
  }

  @Get('v1/productions/:productionId/budget')
  public async getBudgetByProduction(
    @Req() request: FastifyRequest,
    @Param('productionId') productionId: string,
  ): Promise<StoredBudget> {
    const context = await this.requirePlatformAdmin(request);
    if (!this.budgetRepository) {
      throw new ServiceUnavailableException('Budget service is not configured');
    }
    if (!UUID_PATTERN.test(productionId)) throw new NotFoundException();

    const budget = await this.budgetRepository.getBudgetByProductionId(context, productionId);
    if (!budget) throw new NotFoundException();
    return budget;
  }

  @Post('v1/budgets/:budgetId/approve')
  @HttpCode(HttpStatus.OK)
  public async approveBudget(
    @Req() request: FastifyRequest,
    @Param('budgetId') budgetId: string,
  ): Promise<StoredBudget> {
    const context = await this.requirePlatformAdmin(request);
    if (!this.budgetRepository) {
      throw new ServiceUnavailableException('Budget service is not configured');
    }
    if (!UUID_PATTERN.test(budgetId)) throw new NotFoundException();

    try {
      const budget = await this.budgetRepository.approveBudget(context, budgetId);
      if (!budget) throw new NotFoundException();
      return budget;
    } catch (error) {
      if (error instanceof BudgetAlreadyApprovedError) {
        throw new ConflictException('Budget is already approved');
      }
      throw error;
    }
  }

  private async requirePlatformAdmin(
    request: FastifyRequest,
  ): Promise<TenantContext> {
    if (!this.sessionAuthenticator) throw new UnauthorizedException();
    if (!this.permissionResolver) throw new ForbiddenException();

    try {
      return await authorizeRequest({
        authorization: request.headers.authorization,
        requestId: request.id,
        authenticator: this.sessionAuthenticator,
        permission: 'platform.admin',
        resolver: this.permissionResolver,
      });
    } catch (error) {
      if (error instanceof SessionAuthenticationError) {
        throw new UnauthorizedException();
      }
      if (error instanceof SessionAuthorizationError) {
        throw new ForbiddenException();
      }

      throw error;
    }
  }
}

@Module({})
class ApiModule {}

function createApiModule(
  readinessProbes: readonly ReadinessProbe[],
  sessionAuthenticator: SessionAuthenticator | null,
  localPasswordAuthenticator: LocalPasswordAuthenticator | null,
  permissionResolver: PermissionResolver | null,
  roleRepository: RoleRepository | null,
  organizationRepository: OrganizationRepository | null,
  membershipRepository: MembershipRepository | null,
  productionRepository: ProductionRepository | null,
  budgetRepository: BudgetRepository | null,
  workshopRepository: WorkshopRepository | null,
  workshopTaskRepository: WorkshopTaskRepository | null,
): DynamicModule {
  return {
    module: ApiModule,
    controllers: [HealthController],
    providers: [
      {
        provide: READINESS_PROBES,
        useValue: readinessProbes,
      },
      {
        provide: SESSION_AUTHENTICATOR,
        useValue: sessionAuthenticator,
      },
      {
        provide: LOCAL_PASSWORD_AUTHENTICATOR,
        useValue: localPasswordAuthenticator,
      },
      {
        provide: PERMISSION_RESOLVER,
        useValue: permissionResolver,
      },
      {
        provide: ROLE_REPOSITORY,
        useValue: roleRepository,
      },
      {
        provide: ORGANIZATION_REPOSITORY,
        useValue: organizationRepository,
      },
      {
        provide: MEMBERSHIP_REPOSITORY,
        useValue: membershipRepository,
      },
      {
        provide: PRODUCTION_REPOSITORY,
        useValue: productionRepository,
      },
      {
        provide: BUDGET_REPOSITORY,
        useValue: budgetRepository,
      },
      {
        provide: WORKSHOP_REPOSITORY,
        useValue: workshopRepository,
      },
      {
        provide: WORKSHOP_TASK_REPOSITORY,
        useValue: workshopTaskRepository,
      },
    ],
  };
}

export async function createApiApp(
  options: ApiAppOptions = {},
): Promise<FastifyInstance> {
  const application = await NestFactory.create<NestFastifyApplication>(
    createApiModule(
      options.readinessProbes ?? [],
      options.sessionAuthenticator ?? options.localPasswordAuthenticator ?? null,
      options.localPasswordAuthenticator ?? null,
      options.permissionResolver ?? null,
      options.roleRepository ?? null,
      options.organizationRepository ?? null,
      options.membershipRepository ?? null,
      options.productionRepository ?? null,
      options.budgetRepository ?? null,
      options.workshopRepository ?? null,
      options.workshopTaskRepository ?? null,
    ),
    new FastifyAdapter({
      genReqId: () => randomUUID(),
      ...(options.requestLogging
        ? {
            logger: {
              level: process.env.LOG_LEVEL ?? 'info',
              serializers: {
                req(request: { method: string; url: string; hostname: string; headers: unknown }) {
                  return {
                    method: request.method,
                    url: request.url,
                    hostname: request.hostname,
                    headers: request.headers,
                  };
                },
              },
              redact: ['req.headers.authorization', 'req.headers.cookie'],
              ...(typeof options.requestLogging === 'object' ? { stream: options.requestLogging.stream } : {}),
            },
          }
        : { logger: false }),
    }),
    { logger: false },
  );

  await application.init();

  return application.getHttpAdapter().getInstance() as FastifyInstance;
}

function readLoginInput(
  body: unknown,
): { email: string; password: string } | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const { email, password } = body as Record<string, unknown>;
  return typeof email === 'string' && typeof password === 'string'
    ? { email, password }
    : null;
}

function readRoleName(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const name = (body as Record<string, unknown>).name;
  if (typeof name !== 'string') return null;
  const normalized = name.trim();
  return normalized.length > 0 && normalized.length <= 100 ? normalized : null;
}

function readOrgUnitInput(
  body: unknown,
): {
  name: string;
  type: string;
  parentId?: string;
  managerMembershipId?: string;
} | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const input = body as Record<string, unknown>;
  const name = normalizeString(input.name, 200);
  const type = normalizeString(input.type, 100);
  const parentId = readOptionalUuid(input.parentId);
  const managerMembershipId = readOptionalUuid(input.managerMembershipId);
  if (!name || !type || parentId === null || managerMembershipId === null) return null;
  return {
    name,
    type,
    ...(parentId ? { parentId } : {}),
    ...(managerMembershipId ? { managerMembershipId } : {}),
  };
}

function readMoveOrgUnitInput(body: unknown): { parentId: string | null } | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const input = body as Record<string, unknown>;
  if (!('parentId' in input)) return null;

  const parentId = readNullableUuid(input.parentId);
  return parentId === 'invalid' ? null : { parentId };
}

function readNullableUuid(value: unknown): string | null | 'invalid' {
  if (value === null) return null;
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : 'invalid';
}

function normalizeString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : null;
}

function readWorkshopInput(body: unknown): { name: string; managerMembershipId?: string } | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const input = body as Record<string, unknown>;
  const name = normalizeString(input.name, 200);
  const managerMembershipId = readOptionalUuid(input.managerMembershipId);
  if (!name || managerMembershipId === null) return null;
  return { name, ...(managerMembershipId ? { managerMembershipId } : {}) };
}

function readAssignWorkshopManagerInput(body: unknown): { managerMembershipId: string | null } | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const input = body as Record<string, unknown>;
  if (!('managerMembershipId' in input)) return null;

  const managerMembershipId = readNullableUuid(input.managerMembershipId);
  return managerMembershipId === 'invalid' ? null : { managerMembershipId };
}

function readCreateTaskInput(body: unknown): {
  description?: string;
  assigneeMembershipId?: string;
  deadlineAt?: string;
} | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const input = body as Record<string, unknown>;

  const description = input.description === undefined ? undefined : normalizeString(input.description, 1000);
  if (input.description !== undefined && !description) return null;

  const assigneeMembershipId = readOptionalUuid(input.assigneeMembershipId);
  if (assigneeMembershipId === null) return null;

  const deadlineAt = readNullableIsoDate(input.deadlineAt);
  if (deadlineAt === 'invalid') return null;

  return {
    ...(description ? { description } : {}),
    ...(assigneeMembershipId ? { assigneeMembershipId } : {}),
    ...(deadlineAt ? { deadlineAt } : {}),
  };
}

function readAssigneeMembershipId(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  return readOptionalUuid((body as Record<string, unknown>).assigneeMembershipId) ?? null;
}

function readRescheduleInput(body: unknown): { deadlineAt: string | null; reason: string } | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const input = body as Record<string, unknown>;
  if (!('deadlineAt' in input)) return null;

  const deadlineAt = readNullableIsoDate(input.deadlineAt);
  if (deadlineAt === 'invalid') return null;

  const reason = normalizeString(input.reason, 500);
  if (!reason) return null;

  return { deadlineAt, reason };
}

function readMembershipInput(
  body: unknown,
): { userId: string; roleId?: string } | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const input = body as Record<string, unknown>;
  const userId = readOptionalUuid(input.userId);
  const roleId = readOptionalUuid(input.roleId);
  if (!userId || roleId === null) return null;
  return { userId, ...(roleId ? { roleId } : {}) };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function readOptionalUuid(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  return UUID_PATTERN.test(value) ? value : null;
}

function readProductionInput(body: unknown): {
  title: string;
  status: string;
  premiereDate: string | null;
  producerMembershipId: string | null;
} | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const input = body as Record<string, unknown>;
  const title = normalizeString(input.title, 300);
  const status = normalizeString(input.status, 100);
  if (!title || !status) return null;

  const premiereDate = readNullableIsoDate(input.premiereDate);
  if (premiereDate === 'invalid') return null;

  const producerMembershipIdRaw = input.producerMembershipId;
  const producerMembershipId =
    producerMembershipIdRaw === undefined || producerMembershipIdRaw === null
      ? null
      : typeof producerMembershipIdRaw === 'string' && UUID_PATTERN.test(producerMembershipIdRaw)
        ? producerMembershipIdRaw
        : 'invalid';
  if (producerMembershipId === 'invalid') return null;

  return { title, status, premiereDate, producerMembershipId };
}

function readNullableIsoDate(value: unknown): string | null | 'invalid' {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) return 'invalid';
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : 'invalid';
}

const NON_NEGATIVE_DECIMAL_PATTERN = /^\d+(\.\d+)?$/;

function readNonNegativeDecimal(value: unknown, maxScale: number): string | null {
  if (typeof value !== 'string' || !NON_NEGATIVE_DECIMAL_PATTERN.test(value)) return null;
  const [, fraction = ''] = value.split('.');
  return fraction.length <= maxScale ? value : null;
}

function readCreateBudgetInput(body: unknown): { sections: BudgetSectionInput[] } | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const sectionsRaw = (body as Record<string, unknown>).sections;
  if (!Array.isArray(sectionsRaw)) return null;

  const sections: BudgetSectionInput[] = [];
  for (const sectionRaw of sectionsRaw) {
    if (!sectionRaw || typeof sectionRaw !== 'object' || Array.isArray(sectionRaw)) return null;
    const section = sectionRaw as Record<string, unknown>;
    const workshopId = readOptionalUuid(section.workshopId);
    const title = normalizeString(section.title, 200);
    const itemsRaw = section.items;
    if (!workshopId || !title || !Array.isArray(itemsRaw)) return null;

    const items = [];
    for (const itemRaw of itemsRaw) {
      if (!itemRaw || typeof itemRaw !== 'object' || Array.isArray(itemRaw)) return null;
      const item = itemRaw as Record<string, unknown>;
      const description = normalizeString(item.description, 500);
      const unit = normalizeString(item.unit, 50);
      const quantity = readNonNegativeDecimal(item.quantity, 3);
      const unitPrice = readNonNegativeDecimal(item.unitPrice, 2);
      if (!description || !unit || quantity === null || unitPrice === null) return null;
      items.push({ description, unit, quantity, unitPrice });
    }
    sections.push({ workshopId, title, items });
  }

  return { sections };
}
