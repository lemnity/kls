import { randomUUID } from 'node:crypto';

import type { TenantContext } from '@kulisa/domain/tenant-context';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Client } from 'pg';

type SqlClient = Pick<Client, 'query'>;

const UPLOAD_URL_TTL_SECONDS = 300;
const DOWNLOAD_URL_TTL_SECONDS = 300;

export interface S3ClientConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

export interface StoredNodeAttachment {
  id: string;
  nodeId: string;
  fileName: string;
  contentType: string;
  sizeBytes: string;
  uploadedByMembershipId: string;
  createdAt: string;
}

export interface CreateAttachmentUploadInput {
  fileName: string;
  contentType: string;
  sizeBytes: string;
}

export class NodeAttachmentNodeNotFoundError extends Error {
  public constructor(public readonly nodeId: string) {
    super(`Budget graph node ${nodeId} not found in tenant`);
    this.name = 'NodeAttachmentNodeNotFoundError';
  }
}

export class NodeAttachmentNotFoundError extends Error {
  public constructor(public readonly attachmentId: string) {
    super(`Attachment ${attachmentId} not found on this node`);
    this.name = 'NodeAttachmentNotFoundError';
  }
}

const ATTACHMENT_COLUMNS = `id, node_id AS "nodeId", file_name AS "fileName", content_type AS "contentType",
           size_bytes AS "sizeBytes", uploaded_by_membership_id AS "uploadedByMembershipId",
           to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt"`;

interface AttachmentRow {
  objectKey: string;
  id: string;
  nodeId: string;
  fileName: string;
  contentType: string;
  sizeBytes: string;
  uploadedByMembershipId: string;
  createdAt: string;
}

export class S3NodeAttachmentRepository {
  private readonly s3: S3Client;
  private bucketReady: Promise<void> | null = null;

  public constructor(
    private readonly client: SqlClient,
    private readonly config: S3ClientConfig,
  ) {
    this.s3 = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  public async createUploadTarget(
    context: TenantContext,
    nodeId: string,
    input: CreateAttachmentUploadInput,
  ): Promise<{ attachment: StoredNodeAttachment; uploadUrl: string }> {
    const node = await this.client.query(
      'SELECT 1 FROM budget_graph_nodes WHERE id = $1 AND tenant_id = $2',
      [nodeId, context.tenantId],
    );
    if ((node.rowCount ?? 0) === 0) throw new NodeAttachmentNodeNotFoundError(nodeId);

    await this.ensureBucket();

    const attachmentId = randomUUID();
    const objectKey = `tenants/${context.tenantId}/graph-nodes/${nodeId}/${attachmentId}-${input.fileName}`;

    const result = await this.client.query<AttachmentRow>(
      `WITH created AS (
         INSERT INTO node_attachments (
           id, tenant_id, node_id, file_name, content_type, size_bytes, object_key, uploaded_by_membership_id
         )
         VALUES ($1, $2, $3, $4, $5, $6::bigint, $7, $8)
         RETURNING id, node_id, file_name, content_type, size_bytes, object_key, uploaded_by_membership_id, created_at
       ), audited AS (
         INSERT INTO audit_events (id, tenant_id, actor_membership_id, action, subject_type, subject_id, changes)
         SELECT $9, $2, $8, 'budget_graph_node_attachment.created', 'budget_graph_node', $3,
           jsonb_build_object('fileName', $4, 'attachmentId', $1)
         FROM created
       )
       SELECT ${ATTACHMENT_COLUMNS} FROM created`,
      [attachmentId, context.tenantId, nodeId, input.fileName, input.contentType, input.sizeBytes, objectKey, context.membershipId, randomUUID()],
    );

    const uploadUrl = await getSignedUrl(
      this.s3,
      new PutObjectCommand({ Bucket: this.config.bucket, Key: objectKey, ContentType: input.contentType }),
      { expiresIn: UPLOAD_URL_TTL_SECONDS },
    );

    return { attachment: toStoredAttachment(result.rows[0]!), uploadUrl };
  }

  public async listAttachments(context: TenantContext, nodeId: string): Promise<StoredNodeAttachment[]> {
    const result = await this.client.query<AttachmentRow>(
      `SELECT ${ATTACHMENT_COLUMNS} FROM node_attachments
       WHERE tenant_id = $1 AND node_id = $2
       ORDER BY created_at ASC`,
      [context.tenantId, nodeId],
    );
    return result.rows.map(toStoredAttachment);
  }

  public async getDownloadUrl(context: TenantContext, nodeId: string, attachmentId: string): Promise<string | null> {
    const row = await this.findObjectKey(context, nodeId, attachmentId);
    if (!row) return null;

    return getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: this.config.bucket, Key: row.objectKey }),
      { expiresIn: DOWNLOAD_URL_TTL_SECONDS },
    );
  }

  public async deleteAttachment(context: TenantContext, nodeId: string, attachmentId: string): Promise<boolean> {
    const row = await this.findObjectKey(context, nodeId, attachmentId);
    if (!row) return false;

    await this.s3.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: row.objectKey }));

    await this.client.query(
      `WITH deleted AS (
         DELETE FROM node_attachments WHERE id = $1 AND tenant_id = $2
         RETURNING id
       )
       INSERT INTO audit_events (id, tenant_id, actor_membership_id, action, subject_type, subject_id, changes)
       SELECT $3, $2, $4, 'budget_graph_node_attachment.deleted', 'budget_graph_node', $5,
         jsonb_build_object('attachmentId', $1)
       FROM deleted`,
      [attachmentId, context.tenantId, randomUUID(), context.membershipId, nodeId],
    );
    return true;
  }

  private async findObjectKey(
    context: TenantContext,
    nodeId: string,
    attachmentId: string,
  ): Promise<{ objectKey: string } | null> {
    const result = await this.client.query<{ objectKey: string }>(
      'SELECT object_key AS "objectKey" FROM node_attachments WHERE id = $1 AND tenant_id = $2 AND node_id = $3',
      [attachmentId, context.tenantId, nodeId],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Lazily ensures the configured bucket (and permissive local-dev CORS,
   * needed since uploads/downloads go straight from the browser to MinIO,
   * bypassing the API) exists — not a hard startup requirement, so tests
   * that never touch this repository never need MinIO running.
   */
  private async ensureBucket(): Promise<void> {
    if (!this.bucketReady) {
      this.bucketReady = this.initializeBucket();
    }
    return this.bucketReady;
  }

  private async initializeBucket(): Promise<void> {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.config.bucket }));
    } catch {
      await this.s3.send(new CreateBucketCommand({ Bucket: this.config.bucket }));
    }

    try {
      await this.s3.send(new PutBucketCorsCommand({
        Bucket: this.config.bucket,
        CORSConfiguration: {
          CORSRules: [{ AllowedMethods: ['GET', 'PUT'], AllowedOrigins: ['*'], AllowedHeaders: ['*'] }],
        },
      }));
    } catch {
      // Best-effort: older/locked-down MinIO deployments may not support bucket CORS.
    }
  }
}

function toStoredAttachment(row: AttachmentRow): StoredNodeAttachment {
  return {
    id: row.id,
    nodeId: row.nodeId,
    fileName: row.fileName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    uploadedByMembershipId: row.uploadedByMembershipId,
    createdAt: row.createdAt,
  };
}
