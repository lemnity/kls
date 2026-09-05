import 'reflect-metadata';

import { LocalPasswordAuthService } from '@europa/auth/local-session';
import { loadEnvironment } from '@europa/config/environment';
import { PostgresPermissionResolver } from '@europa/db/permission-resolver';
import { PostgresRoleRepository } from '@europa/db/role-repository';
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
  readinessProbes: createReadinessProbes(environment),
  localPasswordAuthenticator,
  permissionResolver: new PostgresPermissionResolver(databasePool),
  roleRepository: new PostgresRoleRepository(databasePool),
});
app.addHook('onClose', async () => databasePool.end());
await app.listen({ host, port });
