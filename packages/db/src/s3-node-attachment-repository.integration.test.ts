import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const sendMock = vi.fn(async (command: { constructor: { name: string } }) => {
  if (command.constructor.name === 'HeadBucketCommand') return {};
  return {};
});

vi.mock('@aws-sdk/client-s3', async () => {
  const actual = await vi.importActual<typeof import('@aws-sdk/client-s3')>('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: vi.fn().mockImplementation(() => ({ send: sendMock })),
  };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async (_client: unknown, command: { constructor: { name: string }; input: { Key: string } }) => {
    return `https://minio.local/${command.constructor.name}/${command.input.Key}`;
  }),
}));

const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
const { NodeAttachmentNodeNotFoundError, S3NodeAttachmentRepository } = await import(
  './s3-node-attachment-repository.js'
);

const databaseUrl = process.env.DATABASE_URL;
const describeIntegration = databaseUrl ? describe : describe.skip;

const S3_CONFIG = {
  endpoint: 'http://localhost:9002',
  region: 'us-east-1',
  accessKeyId: 'test-key',
  secretAccessKey: 'test-secret',
  bucket: 'kulisa-assets-test',
};

describeIntegration('S3NodeAttachmentRepository', () => {
  const client = new Client({ connectionString: databaseUrl });

  beforeAll(async () => {
    await client.connect();
  });

  beforeEach(async () => {
    await client.query('BEGIN');
    sendMock.mockClear();
  });

  afterEach(async () => {
    await client.query('ROLLBACK');
  });

  afterAll(async () => {
    await client.end();
  });

  it('creates an upload target, persists metadata, and returns a presigned PUT url', async () => {
    const fixture = await createFixture(client, 'Tenant A');
    const repository = new S3NodeAttachmentRepository(client, S3_CONFIG);

    const { attachment, uploadUrl } = await repository.createUploadTarget(fixture.context, fixture.nodeId, {
      fileName: 'смета.pdf',
      contentType: 'application/pdf',
      sizeBytes: '2048',
    });

    expect(attachment).toMatchObject({
      nodeId: fixture.nodeId,
      fileName: 'смета.pdf',
      contentType: 'application/pdf',
      sizeBytes: '2048',
      uploadedByMembershipId: fixture.context.membershipId,
    });
    expect(uploadUrl).toContain('PutObjectCommand');
    await expect(
      client.query("SELECT count(*)::int AS count FROM audit_events WHERE action = 'budget_graph_node_attachment.created' AND subject_id = $1", [fixture.nodeId]),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it('rejects creating an attachment on a node outside the tenant', async () => {
    const fixture = await createFixture(client, 'Tenant A');
    const outsider = await createFixture(client, 'Tenant B');
    const repository = new S3NodeAttachmentRepository(client, S3_CONFIG);

    await expect(
      repository.createUploadTarget(outsider.context, fixture.nodeId, {
        fileName: 'x.pdf',
        contentType: 'application/pdf',
        sizeBytes: '1',
      }),
    ).rejects.toBeInstanceOf(NodeAttachmentNodeNotFoundError);
  });

  it('lists attachments for a node, scoped by tenant', async () => {
    const fixture = await createFixture(client, 'Tenant A');
    const outsider = await createFixture(client, 'Tenant B');
    const repository = new S3NodeAttachmentRepository(client, S3_CONFIG);
    await repository.createUploadTarget(fixture.context, fixture.nodeId, {
      fileName: 'a.pdf',
      contentType: 'application/pdf',
      sizeBytes: '10',
    });
    await repository.createUploadTarget(fixture.context, fixture.nodeId, {
      fileName: 'b.pdf',
      contentType: 'application/pdf',
      sizeBytes: '20',
    });

    const listed = await repository.listAttachments(fixture.context, fixture.nodeId);
    const listedByOutsider = await repository.listAttachments(outsider.context, fixture.nodeId);

    expect(listed.map((item) => item.fileName)).toEqual(['a.pdf', 'b.pdf']);
    expect(listedByOutsider).toEqual([]);
  });

  it('returns a presigned GET url for an existing attachment, and null for an unknown one', async () => {
    const fixture = await createFixture(client, 'Tenant A');
    const repository = new S3NodeAttachmentRepository(client, S3_CONFIG);
    const { attachment } = await repository.createUploadTarget(fixture.context, fixture.nodeId, {
      fileName: 'a.pdf',
      contentType: 'application/pdf',
      sizeBytes: '10',
    });

    const url = await repository.getDownloadUrl(fixture.context, fixture.nodeId, attachment.id);
    const missing = await repository.getDownloadUrl(fixture.context, fixture.nodeId, randomUUID());

    expect(url).toContain('GetObjectCommand');
    expect(missing).toBeNull();
  });

  it('deletes an attachment, removing both the S3 object and the metadata row', async () => {
    const fixture = await createFixture(client, 'Tenant A');
    const repository = new S3NodeAttachmentRepository(client, S3_CONFIG);
    const { attachment } = await repository.createUploadTarget(fixture.context, fixture.nodeId, {
      fileName: 'a.pdf',
      contentType: 'application/pdf',
      sizeBytes: '10',
    });

    const deleted = await repository.deleteAttachment(fixture.context, fixture.nodeId, attachment.id);
    const deletedAgain = await repository.deleteAttachment(fixture.context, fixture.nodeId, attachment.id);

    expect(deleted).toBe(true);
    expect(deletedAgain).toBe(false);
    expect(sendMock.mock.calls.some((call) => call[0] instanceof DeleteObjectCommand)).toBe(true);
    await expect(
      client.query('SELECT count(*)::int AS count FROM node_attachments WHERE id = $1', [attachment.id]),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
    await expect(
      client.query("SELECT count(*)::int AS count FROM audit_events WHERE action = 'budget_graph_node_attachment.deleted' AND subject_id = $1", [fixture.nodeId]),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });
});

async function createFixture(client: Client, name: string) {
  const tenantId = randomUUID();
  const userId = randomUUID();
  const roleId = randomUUID();
  const membershipId = randomUUID();
  const productionId = randomUUID();
  const budgetId = randomUUID();
  const budgetVersionId = randomUUID();
  const nodeId = randomUUID();

  await client.query('INSERT INTO tenants (id, name, updated_at) VALUES ($1, $2, NOW())', [tenantId, name]);
  await client.query(
    'INSERT INTO users (id, email, "displayName", updated_at) VALUES ($1, $2, $3, NOW())',
    [userId, `${userId}@example.test`, name],
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
    "INSERT INTO productions (id, tenant_id, title, status, health_status, updated_at) VALUES ($1, $2, $3, 'draft', 'neutral', NOW())",
    [productionId, tenantId, 'Ревизор'],
  );
  await client.query(
    "INSERT INTO budgets (id, tenant_id, production_id, status, updated_at) VALUES ($1, $2, $3, 'PRELIMINARY', NOW())",
    [budgetId, tenantId, productionId],
  );
  await client.query(
    'INSERT INTO budget_versions (id, tenant_id, budget_id, revision, created_by_membership_id) VALUES ($1, $2, $3, 1, $4)',
    [budgetVersionId, tenantId, budgetId, membershipId],
  );
  await client.query(
    `INSERT INTO budget_graph_nodes (
       id, tenant_id, budget_version_id, parent_id, workshop_id, node_type, title,
       planned_amount, position_x, position_y, width, height, updated_at
     ) VALUES ($1, $2, $3, NULL, NULL, 'production', 'Ревизор', 0, 0, 0, 160, 80, NOW())`,
    [nodeId, tenantId, budgetVersionId],
  );

  return {
    tenantId,
    nodeId,
    context: { requestId: randomUUID(), userId, membershipId, tenantId },
  };
}
