import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { config } from '../../config/env';

/** Pluggable blob storage. Keys are random server-generated identifiers, never user-supplied names. */
export interface StorageDriver {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
}

export class LocalStorage implements StorageDriver {
  private readonly root: string;
  constructor(dir: string) {
    this.root = path.resolve(dir);
  }
  private resolve(key: string) {
    if (!/^[a-zA-Z0-9/_-]+$/.test(key)) throw new Error('Invalid storage key');
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error('Invalid storage key');
    return full;
  }
  async put(key: string, data: Buffer) {
    const full = this.resolve(key);
    await fsp.mkdir(path.dirname(full), { recursive: true, mode: 0o750 });
    await fsp.writeFile(full, data, { mode: 0o640, flag: 'wx' });
  }
  async get(key: string) {
    const full = this.resolve(key);
    await fsp.access(full);
    return fs.createReadStream(full);
  }
  async delete(key: string) {
    await fsp.rm(this.resolve(key), { force: true });
  }
}

export class S3Storage implements StorageDriver {
  private client: S3Client;
  constructor(private readonly bucket: string) {
    this.client = new S3Client({
      region: config.S3_REGION,
      endpoint: config.S3_ENDPOINT,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials:
        config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY
          ? { accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY }
          : undefined,
    });
  }
  async put(key: string, data: Buffer, contentType: string) {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: contentType, ServerSideEncryption: 'AES256' }),
    );
  }
  async get(key: string) {
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return out.Body as Readable;
  }
  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

let driver: StorageDriver | null = null;
export function storage(): StorageDriver {
  driver ??= config.STORAGE_DRIVER === 's3' ? new S3Storage(config.S3_BUCKET!) : new LocalStorage(config.STORAGE_LOCAL_DIR);
  return driver;
}
