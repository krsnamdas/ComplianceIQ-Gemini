/**
 * Regulation Document Store (server-side only).
 * ---------------------------------------------------------------------------
 * Backs the "Documents" feature on each regulation card. Admins upload files
 * (regulation texts, internal RCMs / controls libraries); all onboarded Cognito
 * users can list and download them.
 *
 * Storage model (Option A — proxy through the app):
 *   - File BYTES live in a PRIVATE S3 bucket (encrypted, Block Public Access on)
 *     when DOCUMENTS_BUCKET is set (the AWS/ECS runtime).
 *   - When DOCUMENTS_BUCKET is NOT set (local dev / no-AWS), bytes fall back to
 *     the local disk under <DATA_DIR or ./data>/regions/<REGION>/documents/.
 *   - File METADATA lives in the region JSON file documents.json via the same
 *     region-aware loader used for every other dataset, so it is portable and
 *     survives restarts on the EFS-mounted data volume.
 *
 * This module is server-side only (uses fs + the AWS SDK). The browser bundle
 * must never import it; only server.ts does. It intentionally has NO dependency
 * on any existing feature module other than regionLoader, so it cannot affect
 * existing behavior.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { loadRegionJSON, saveRegionJSON, regionDir, ACTIVE_REGION } from './regionLoader';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Allowed document categories shown on the card. */
export type RegulationDocType = 'regulation' | 'internal';

/** Persisted metadata for one uploaded document. */
export interface RegulationDocument {
  id: string;
  regulationId: string;
  docType: RegulationDocType;
  /** Human-friendly display name entered/derived at upload. */
  displayName: string;
  /** Original filename as uploaded, including extension. */
  fileName: string;
  /** Lowercased extension without the dot, e.g. "pdf". */
  ext: string;
  /** MIME type reported at upload. */
  contentType: string;
  /** Size in bytes. */
  size: number;
  /** Storage key: the S3 object key, or the local relative filename. */
  storageKey: string;
  /** 's3' | 'local' — where the bytes actually live for this record. */
  storage: 's3' | 'local';
  uploadedBy: string;
  uploadedAt: string;
}

const DOCUMENTS_FILE = 'documents.json';

// Storage backend resolution (Gemini edition):
//   - Cloudflare R2 (S3-compatible) when R2_* env vars are set — the primary
//     object store for the zero-AWS Gemini edition.
//   - Plain AWS S3 when DOCUMENTS_BUCKET is set (kept for portability).
//   - Local-disk fallback when neither is configured (local dev).
const R2_ENDPOINT = process.env.R2_ENDPOINT || '';
const R2_BUCKET = process.env.R2_BUCKET || '';
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';

const S3_BUCKET = process.env.DOCUMENTS_BUCKET || '';
const REGION = process.env.AWS_REGION || 'us-east-1';

const USE_R2 = Boolean(R2_ENDPOINT && R2_BUCKET && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY);

/** Effective object-storage bucket name (R2 takes precedence over plain S3). */
const BUCKET = USE_R2 ? R2_BUCKET : S3_BUCKET;

/** Lazily-created S3 client. Points at Cloudflare R2 when R2 is configured,
 *  otherwise plain AWS S3. R2 is S3-API-compatible, so the same SDK works. */
let _s3: S3Client | null = null;
function getS3(): S3Client {
  if (!_s3) {
    if (USE_R2) {
      _s3 = new S3Client({
        region: 'auto', // R2 ignores region but the SDK requires a value
        endpoint: R2_ENDPOINT,
        credentials: {
          accessKeyId: R2_ACCESS_KEY_ID,
          secretAccessKey: R2_SECRET_ACCESS_KEY,
        },
      });
    } else {
      _s3 = new S3Client({ region: REGION });
    }
  }
  return _s3;
}

/** True when an object store (R2 or S3) is configured; false for local dev. */
export function isS3Backed(): boolean {
  return Boolean(BUCKET);
}

/** Local directory that holds document bytes when S3 is not configured. */
function localDocsDir(): string {
  return path.join(regionDir(ACTIVE_REGION), 'documents');
}

/** Read the full document metadata list for the active region. */
export function loadDocuments(): RegulationDocument[] {
  return loadRegionJSON<RegulationDocument>(DOCUMENTS_FILE, []).data;
}

/** Persist the full document metadata list for the active region. */
export function saveDocuments(docs: RegulationDocument[]): { ok: boolean; error?: string } {
  const res = saveRegionJSON<RegulationDocument>(DOCUMENTS_FILE, docs);
  return { ok: res.ok, error: res.error };
}

/** Build the S3 key for a document (region-scoped, collision-safe). */
function buildStorageKey(regulationId: string, docId: string, ext: string): string {
  const safeReg = regulationId.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80);
  const suffix = ext ? `.${ext}` : '';
  return `${ACTIVE_REGION}/regulations/${safeReg}/${docId}${suffix}`;
}

/**
 * Store raw bytes for a document. Writes to S3 when configured, otherwise to the
 * local region documents dir. Returns the resolved storageKey + storage mode.
 */
export async function putObject(
  regulationId: string,
  docId: string,
  ext: string,
  contentType: string,
  body: Buffer
): Promise<{ storageKey: string; storage: 's3' | 'local' }> {
  const storageKey = buildStorageKey(regulationId, docId, ext);

  if (isS3Backed()) {
    await getS3().send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: storageKey,
        Body: body,
        ContentType: contentType || 'application/octet-stream',
      })
    );
    return { storageKey, storage: 's3' };
  }

  // Local fallback: write under <region>/documents/<flattened key>
  const dir = localDocsDir();
  fs.mkdirSync(dir, { recursive: true });
  const localName = storageKey.replace(/[\\/]+/g, '__');
  const fullPath = path.join(dir, localName);
  fs.writeFileSync(fullPath, body);
  return { storageKey: localName, storage: 'local' };
}

/**
 * Fetch raw bytes for a document as a Buffer. Reads from S3 or local disk based
 * on how the record was stored.
 */
export async function getObject(doc: RegulationDocument): Promise<Buffer> {
  if (doc.storage === 's3') {
    if (!isS3Backed()) {
      throw new Error('Document is stored in S3 but DOCUMENTS_BUCKET is not configured.');
    }
    const out = await getS3().send(
      new GetObjectCommand({ Bucket: BUCKET, Key: doc.storageKey })
    );
    const stream = out.Body as any;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  // Local
  const fullPath = path.join(localDocsDir(), doc.storageKey);
  return fs.readFileSync(fullPath);
}

/**
 * Check whether the stored bytes for a document actually exist.
 * For local storage this is a direct fs check; for S3 we rely on getObject
 * surfacing a NoSuchKey error, so this returns true (optimistic) for S3 and the
 * download path handles a missing key via its catch.
 */
export function localFileExists(doc: RegulationDocument): boolean {
  if (doc.storage !== 'local') return true;
  try {
    return fs.existsSync(path.join(localDocsDir(), doc.storageKey));
  } catch {
    return false;
  }
}

/** Delete the stored bytes for a document (best-effort; metadata removal is separate). */
export async function deleteObject(doc: RegulationDocument): Promise<void> {
  if (doc.storage === 's3') {
    if (!isS3Backed()) return;
    await getS3().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: doc.storageKey }));
    return;
  }
  const fullPath = path.join(localDocsDir(), doc.storageKey);
  try {
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  } catch {
    // ignore — metadata will still be removed
  }
}
