import 'reflect-metadata';

import { LocalPasswordAuthService } from '@kulisa/auth/local-session';
import { loadEnvironment } from '@kulisa/config/environment';
import { PostgresPermissionResolver } from '@kulisa/db/permission-resolver';
import { PostgresOrganizationRepository } from '@kulisa/db/organization-repository';
import { PostgresMembershipRepository } from '@kulisa/db/membership-repository';
import { PostgresProductionRepository } from '@kulisa/db/production-repository';
import { PostgresBudgetRepository } from '@kulisa/db/budget-repository';
import { PostgresWorkshopRepository } from '@kulisa/db/workshop-repository';
import { PostgresWorkshopTaskRepository } from '@kulisa/db/workshop-task-repository';
import { PostgresBudgetGraphRepository } from '@kulisa/db/budget-graph-repository';
import { S3NodeAttachmentRepository } from '@kulisa/db/node-attachment-repository';
import { PostgresRoleRepository } from '@kulisa/db/role-repository';
import { Pool } from 'pg';

import { createApiApp } from './app.js';
import { PostgresLocalAuthRepository } from './postgres-local-auth-repository.js';
import { createReadinessProbes } from './readiness.js';

const environment = loadEnvironment(process.env);
const port = environment.apiPort;
const host = process.env.HOST ?? '0.0.0.0';
const databasePool = new Pool({ connectionString: environment.databaseUrl });
const localPasswordAuthenticator = new LocalPasswordAuthService({
  repository: new PostgresLocalAuthRepository(databasePool),
});

const app = await createApiApp({
  requestLogging: true,
  readinessProbes: createReadinessProbes(environment),
  localPasswordAuthenticator,
  permissionResolver: new PostgresPermissionResolver(databasePool),
  roleRepository: new PostgresRoleRepository(databasePool),
  organizationRepository: new PostgresOrganizationRepository(databasePool),
  membershipRepository: new PostgresMembershipRepository(databasePool),
  productionRepository: new PostgresProductionRepository(databasePool),
  budgetRepository: new PostgresBudgetRepository(databasePool),
  workshopRepository: new PostgresWorkshopRepository(databasePool),
  workshopTaskRepository: new PostgresWorkshopTaskRepository(databasePool),
  budgetGraphRepository: new PostgresBudgetGraphRepository(databasePool),
  nodeAttachmentRepository: new S3NodeAttachmentRepository(databasePool, {
    endpoint: environment.s3Endpoint,
    region: environment.s3Region,
    accessKeyId: environment.s3AccessKey,
    secretAccessKey: environment.s3SecretKey,
    bucket: environment.s3Bucket,
  }),
});
app.addHook('onClose', async () => databasePool.end());
await app.listen({ host, port });
