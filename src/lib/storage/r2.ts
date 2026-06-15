import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { promises as fs } from "node:fs";
import path from "node:path";
import { env, features } from "@/lib/env";

/**
 * Object storage with graceful fallback (Phase 2 rule: never hard-fail on a
 * missing source). When R2 is configured, artifacts go to Cloudflare R2 (S3
 * API). Otherwise they land on local disk under `.storage/` so the crawler and
 * extraction engine still run end-to-end in development without credentials.
 */

const LOCAL_DIR = path.join(process.cwd(), ".storage");

let client: S3Client | null = null;
function s3(): S3Client {
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID!,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }
  return client;
}

export interface StoredObject {
  key: string;
  backend: "r2" | "local";
}

export async function putObject(
  key: string,
  body: Buffer | Uint8Array | string,
  contentType: string,
): Promise<StoredObject> {
  if (features.r2) {
    await s3().send(
      new PutObjectCommand({
        Bucket: env.R2_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return { key, backend: "r2" };
  }
  const full = path.join(LOCAL_DIR, key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, body);
  return { key, backend: "local" };
}

export async function getObjectBuffer(key: string): Promise<Buffer> {
  if (features.r2) {
    const res = await s3().send(
      new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }),
    );
    const bytes = await res.Body!.transformToByteArray();
    return Buffer.from(bytes);
  }
  return fs.readFile(path.join(LOCAL_DIR, key));
}

/** A URL the browser/Claude Vision can use to fetch the object. */
export async function objectUrl(key: string): Promise<string> {
  if (features.r2) {
    if (env.R2_PUBLIC_BASE_URL) {
      return `${env.R2_PUBLIC_BASE_URL.replace(/\/$/, "")}/${key}`;
    }
    return getSignedUrl(
      s3(),
      new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }),
      { expiresIn: 3600 },
    );
  }
  // Local backend: served via the /api/storage route.
  return `/api/storage/${encodeURIComponent(key)}`;
}

export function projectKey(projectId: string, ...parts: string[]): string {
  return ["projects", projectId, ...parts].join("/");
}
