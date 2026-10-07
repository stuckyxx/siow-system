import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface ObjectStorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  forcePathStyle: boolean;
  presignTtlSeconds: number;
}

export function objectStorageConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ObjectStorageConfig {
  const required = (k: string): string => {
    const v = env[k];
    if (!v) throw new Error(`Variável de ambiente obrigatória ausente: ${k}`);
    return v;
  };
  return {
    endpoint: required('S3_ENDPOINT'),
    region: env['S3_REGION'] ?? 'us-east-1',
    bucket: required('S3_BUCKET'),
    accessKey: required('S3_ACCESS_KEY'),
    secretKey: required('S3_SECRET_KEY'),
    forcePathStyle: (env['S3_FORCE_PATH_STYLE'] ?? 'true') === 'true',
    presignTtlSeconds: Number(env['S3_PRESIGN_TTL_SECONDS'] ?? 300),
  };
}

/**
 * Armazenamento de objetos S3-compatible (MinIO em dev, S3/R2/Wasabi em prod).
 * Bucket privado: leitura sempre via URL pré-assinada de curta duração.
 */
export class ObjectStorage {
  private readonly client: S3Client;

  constructor(private readonly cfg: ObjectStorageConfig) {
    this.client = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      forcePathStyle: cfg.forcePathStyle,
      credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
    const bytes = await res.Body?.transformToByteArray();
    return Buffer.from(bytes ?? new Uint8Array());
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
  }

  /** URL temporária para download (Content-Disposition com nome amigável). */
  async presignDownload(key: string, fileName?: string, ttlSeconds?: number): Promise<string> {
    const cmd = new GetObjectCommand({
      Bucket: this.cfg.bucket,
      Key: key,
      ResponseContentDisposition: fileName ? `attachment; filename="${encodeURIComponent(fileName)}"` : undefined,
    });
    return getSignedUrl(this.client, cmd, { expiresIn: ttlSeconds ?? this.cfg.presignTtlSeconds });
  }
}
