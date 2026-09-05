import { Body,
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
  HttpStatus,
  Inject,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Res,
  UnauthorizedException,
  type DynamicModule,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import type { PermissionResolver } from '@europa/domain/permission-authorizer';
import type { TenantContext } from '@europa/domain/tenant-context';
import type { StoredRole } from '@europa/db/role-repository';

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

const READINESS_PROBES = Symbol('READINESS_PROBES');
const SESSION_AUTHENTICATOR = Symbol('SESSION_AUTHENTICATOR');
const LOCAL_PASSWORD_AUTHENTICATOR = Symbol('LOCAL_PASSWORD_AUTHENTICATOR');
const PERMISSION_RESOLVER = Symbol('PERMISSION_RESOLVER');
const ROLE_REPOSITORY = Symbol('ROLE_REPOSITORY');

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
    @Headers('authorization') authorization: string | undefined,
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
        authorization,
        requestId: randomUUID(),
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
    @Headers('authorization') authorization: string | undefined,
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
        authorization,
        requestId: randomUUID(),
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
    @Headers('authorization') authorization: string | undefined,
    @Param('roleId') roleId: string,
  ): Promise<StoredRole> {
    const context = await this.requirePlatformAdmin(authorization);
    const role = await this.roleRepository?.findById(context, roleId);
    if (!role) throw new NotFoundException();
    return role;
  }

  @Patch('v1/admin/roles/:roleId')
  public async renameRole(
    @Headers('authorization') authorization: string | undefined,
    @Param('roleId') roleId: string,
    @Body() body: unknown,
  ): Promise<StoredRole> {
    const name = readRoleName(body);
    if (!name) throw new BadRequestException('Invalid role payload');

    const context = await this.requirePlatformAdmin(authorization);
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

  private async requirePlatformAdmin(
    authorization: string | undefined,
  ): Promise<TenantContext> {
    if (!this.sessionAuthenticator) throw new UnauthorizedException();
    if (!this.permissionResolver) throw new ForbiddenException();

    try {
      return await authorizeRequest({
        authorization,
        requestId: randomUUID(),
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
    ),
    new FastifyAdapter({ logger: false }),
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
