import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/db/client";
import type { DatabaseClient } from "@/db/transaction";
import type { ServerEnv } from "@/server/env";
import { assertProjectPermission, assertSourcePermission } from "@/services/authorization-service";
import { NotFoundError, ValidationServiceError } from "@/services/errors";
import { createSourceDocument } from "@/services/source-service";
import { requireScopedContext, type ScopedContext } from "@/services/scoped-context";

const allowedExtensions = new Set([".txt", ".md", ".markdown", ".json", ".zip", ".tar", ".gz", ".tgz"]);
const allowedMimeTypes = new Set([
  "text/plain",
  "text/markdown",
  "application/json",
  "application/zip",
  "application/x-zip-compressed",
  "application/gzip",
  "application/x-gzip",
  "application/x-tar",
  "application/x-gtar",
]);

export const maxUploadSizeBytes = 25 * 1024 * 1024;

export type FileUploadValidationInput = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

export type PreparedSourceFileUploadInput = FileUploadValidationInput & {
  projectId: string;
  title?: string;
  checksumSha256: string;
  tags?: string[];
  isPrivate?: boolean;
  metadata?: Record<string, unknown>;
  expiresInSeconds?: number;
};

export type ServerMediatedSourceFileUploadInput = Omit<
  PreparedSourceFileUploadInput,
  "checksumSha256" | "sizeBytes"
> & {
  bytes: Uint8Array;
};

export type VirusScanResult =
  | { clean: true; signature?: string }
  | { clean: false; reason: string; signature?: string };

export type VirusScanner = {
  scanBuffer(input: {
    fileName: string;
    mimeType: string;
    bytes: Uint8Array;
  }): Promise<VirusScanResult>;
};

export type ObjectStorageAdapter = {
  provider: string;
  putObject(input: {
    objectKey: string;
    body: Uint8Array;
    mimeType: string;
    checksumSha256: string;
    metadata?: Record<string, string>;
  }): Promise<void>;
  deleteObject(input: { objectKey: string }): Promise<void>;
  createSignedUploadUrl(input: {
    objectKey: string;
    mimeType: string;
    checksumSha256: string;
    expiresInSeconds: number;
    metadata?: Record<string, string>;
  }): Promise<string>;
  createSignedDownloadUrl(input: {
    objectKey: string;
    expiresInSeconds: number;
  }): Promise<string>;
};

export const passThroughVirusScanner: VirusScanner = {
  async scanBuffer() {
    return { clean: true, signature: "pass-through" };
  },
};

export class S3ObjectStorageAdapter implements ObjectStorageAdapter {
  readonly provider = "s3-compatible";
  private readonly bucket: string;
  private readonly client: S3Client;

  constructor(input: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
  }) {
    this.bucket = input.bucket;
    this.client = new S3Client({
      endpoint: input.endpoint,
      region: input.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: input.accessKeyId,
        secretAccessKey: input.secretAccessKey,
      },
    });
  }

  async putObject(input: {
    objectKey: string;
    body: Uint8Array;
    mimeType: string;
    checksumSha256: string;
    metadata?: Record<string, string>;
  }) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.objectKey,
        Body: Buffer.from(input.body),
        ContentType: input.mimeType,
        ChecksumSHA256: Buffer.from(input.checksumSha256, "hex").toString("base64"),
        Metadata: input.metadata,
      }),
    );
  }

  async deleteObject(input: { objectKey: string }) {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: input.objectKey,
      }),
    );
  }

  async createSignedUploadUrl(input: {
    objectKey: string;
    mimeType: string;
    checksumSha256: string;
    expiresInSeconds: number;
    metadata?: Record<string, string>;
  }) {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.objectKey,
        ContentType: input.mimeType,
        ChecksumSHA256: Buffer.from(input.checksumSha256, "hex").toString("base64"),
        Metadata: input.metadata,
      }),
      { expiresIn: input.expiresInSeconds },
    );
  }

  async createSignedDownloadUrl(input: { objectKey: string; expiresInSeconds: number }) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: input.objectKey,
      }),
      { expiresIn: input.expiresInSeconds },
    );
  }
}

export function createObjectStorageAdapterFromEnv(env: ServerEnv) {
  return new S3ObjectStorageAdapter({
    endpoint: env.OBJECT_STORAGE_ENDPOINT,
    region: env.OBJECT_STORAGE_REGION,
    bucket: env.OBJECT_STORAGE_BUCKET,
    accessKeyId: env.OBJECT_STORAGE_ACCESS_KEY_ID,
    secretAccessKey: env.OBJECT_STORAGE_SECRET_ACCESS_KEY,
  });
}

export async function prepareSourceFileUpload(
  context: ScopedContext,
  input: PreparedSourceFileUploadInput,
  storage: ObjectStorageAdapter,
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertProjectPermission(context, input.projectId, "source.write", db);
  const validation = validateUploadFile(input);
  assertChecksum(input.checksumSha256);

  const source = await createSourceDocument(
    context,
    {
      projectId: input.projectId,
      title: input.title ?? input.fileName,
      rawObjectKey: createObjectKey(context, input.projectId, input.fileName),
      sourceType: "FILE_UPLOAD",
      tags: input.tags,
      isPrivate: input.isPrivate,
      metadata: {
        ...input.metadata,
        upload: {
          mode: "direct",
          aiEligible: false,
          pipelineState: "uploaded_pending_parse",
        },
      },
      provenance: {
        kind: "file_upload",
        externalId: input.fileName,
      },
    },
    db,
  );

  const sourceFile = await createSourceFileRecord(
    context,
    {
      projectId: input.projectId,
      sourceDocumentId: source.id,
      objectKey: source.rawObjectKey ?? "",
      fileName: input.fileName,
      mimeType: validation.mimeType,
      sizeBytes: input.sizeBytes,
      checksumSha256: input.checksumSha256,
      storageProvider: storage.provider,
      metadata: {
        extension: validation.extension,
        uploadMode: "direct",
        aiEligible: false,
      },
    },
    db,
  );

  await db.sourceDocument.update({
    where: {
      id: source.id,
      orgId: context.orgId,
    },
    data: {
      status: "UPLOADED",
    },
  });

  const expiresInSeconds = normalizeExpiry(input.expiresInSeconds);
  const uploadUrl = await storage.createSignedUploadUrl({
    objectKey: sourceFile.objectKey,
    mimeType: validation.mimeType,
    checksumSha256: input.checksumSha256,
    expiresInSeconds,
    metadata: buildStorageMetadata(context, sourceFile.id),
  });

  return {
    uploadUrl,
    expiresInSeconds,
    sourceDocumentId: source.id,
    sourceFile,
  };
}

export async function uploadSourceFileBuffer(
  context: ScopedContext,
  input: ServerMediatedSourceFileUploadInput,
  storage: ObjectStorageAdapter,
  scanner: VirusScanner = passThroughVirusScanner,
  db: DatabaseClient = prisma,
) {
  const checksumSha256 = calculateSha256(input.bytes);
  const validation = validateUploadFile({
    fileName: input.fileName,
    mimeType: input.mimeType,
    sizeBytes: input.bytes.byteLength,
  });
  const scan = await scanner.scanBuffer({
    fileName: input.fileName,
    mimeType: validation.mimeType,
    bytes: input.bytes,
  });

  if (!scan.clean) {
    throw new ValidationServiceError("File failed virus scan.", {
      reason: scan.reason,
    });
  }

  const prepared = await prepareSourceFileUpload(
    context,
    {
      ...input,
      checksumSha256,
      sizeBytes: input.bytes.byteLength,
      metadata: {
        ...input.metadata,
        virusScan: scan,
      },
    },
    storage,
    db,
  );

  await storage.putObject({
    objectKey: prepared.sourceFile.objectKey,
    body: input.bytes,
    mimeType: validation.mimeType,
    checksumSha256,
    metadata: buildStorageMetadata(context, prepared.sourceFile.id),
  });

  return prepared;
}

export async function createSignedSourceFileDownloadUrl(
  context: ScopedContext,
  input: string | { sourceFileId: string; projectId?: string },
  storage: ObjectStorageAdapter,
  expiresInSeconds?: number,
  db: DatabaseClient = prisma,
) {
  const sourceFileId = typeof input === "string" ? input : input.sourceFileId;
  const sourceFile = await getScopedSourceFile(context, sourceFileId, "source.read", db);

  if (typeof input !== "string" && input.projectId && sourceFile.projectId !== input.projectId) {
    throw new NotFoundError("Source file not found.");
  }

  const safeExpiry = normalizeExpiry(expiresInSeconds);
  const downloadUrl = await storage.createSignedDownloadUrl({
    objectKey: sourceFile.objectKey,
    expiresInSeconds: safeExpiry,
  });

  return {
    downloadUrl,
    expiresInSeconds: safeExpiry,
    sourceFile,
  };
}

export async function deleteSourceFile(
  context: ScopedContext,
  input: string | { sourceFileId: string; projectId?: string },
  storage: ObjectStorageAdapter,
  db: DatabaseClient = prisma,
) {
  const sourceFileId = typeof input === "string" ? input : input.sourceFileId;
  const sourceFile = await getScopedSourceFile(context, sourceFileId, "source.write", db);

  if (typeof input !== "string" && input.projectId && sourceFile.projectId !== input.projectId) {
    throw new NotFoundError("Source file not found.");
  }

  await storage.deleteObject({
    objectKey: sourceFile.objectKey,
  });

  await db.sourceFile.delete({
    where: {
      id: sourceFile.id,
    },
  });

  return sourceFile;
}

export function validateUploadFile(input: FileUploadValidationInput) {
  const extension = getSafeExtension(input.fileName);

  if (!allowedExtensions.has(extension)) {
    throw new ValidationServiceError("Unsupported file extension.", {
      extension,
      allowedExtensions: Array.from(allowedExtensions),
    });
  }

  if (!allowedMimeTypes.has(input.mimeType)) {
    throw new ValidationServiceError("Unsupported file type.", {
      mimeType: input.mimeType,
      allowedMimeTypes: Array.from(allowedMimeTypes),
    });
  }

  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    throw new ValidationServiceError("File size must be greater than zero.");
  }

  if (input.sizeBytes > maxUploadSizeBytes) {
    throw new ValidationServiceError("File exceeds the maximum upload size.", {
      maxUploadSizeBytes,
    });
  }

  return {
    extension,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
  };
}

export function calculateSha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function createSourceFileRecord(
  context: ScopedContext,
  input: {
    projectId: string;
    sourceDocumentId: string;
    objectKey: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    checksumSha256: string;
    storageProvider: string;
    metadata: Prisma.InputJsonObject;
  },
  db: DatabaseClient,
) {
  return db.sourceFile.create({
    data: {
      orgId: context.orgId,
      projectId: input.projectId,
      sourceDocumentId: input.sourceDocumentId,
      objectKey: input.objectKey,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: BigInt(input.sizeBytes),
      checksumSha256: input.checksumSha256,
      storageProvider: input.storageProvider,
      metadata: input.metadata,
    },
  });
}

async function getScopedSourceFile(
  context: ScopedContext,
  sourceFileId: string,
  action: "source.read" | "source.write",
  db: DatabaseClient,
) {
  requireScopedContext(context);

  const sourceFile = await db.sourceFile.findFirst({
    where: {
      id: sourceFileId,
      orgId: context.orgId,
    },
  });

  if (!sourceFile) {
    throw new NotFoundError("Source file not found.");
  }

  await assertSourcePermission(context, sourceFile.sourceDocumentId, action, db);

  if (!sourceFile.objectKey.startsWith(`orgs/${context.orgId}/`)) {
    throw new NotFoundError("Source file not found.");
  }

  return sourceFile;
}

function createObjectKey(context: ScopedContext, projectId: string, fileName: string) {
  return [
    "orgs",
    context.orgId,
    "projects",
    projectId,
    "sources",
    `${Date.now()}-${randomUUID()}-${sanitizeFileName(fileName)}`,
  ].join("/");
}

function sanitizeFileName(fileName: string) {
  const normalized = fileName.trim().replace(/\\/g, "/").split("/").pop() ?? "source";
  return normalized.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-");
}

function getSafeExtension(fileName: string) {
  const safeName = sanitizeFileName(fileName).toLowerCase();

  if (safeName.endsWith(".tar.gz")) {
    return ".gz";
  }

  const match = safeName.match(/\.[a-z0-9]+$/);
  return match?.[0] ?? "";
}

function assertChecksum(checksumSha256: string) {
  if (!/^[a-f0-9]{64}$/i.test(checksumSha256)) {
    throw new ValidationServiceError("Invalid SHA-256 checksum.");
  }
}

function normalizeExpiry(expiresInSeconds = 900) {
  if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 60 || expiresInSeconds > 3600) {
    throw new ValidationServiceError("Signed URL expiry must be between 60 and 3600 seconds.");
  }

  return expiresInSeconds;
}

function buildStorageMetadata(context: ScopedContext, sourceFileId: string) {
  return {
    orgId: context.orgId,
    sourceFileId,
  };
}
