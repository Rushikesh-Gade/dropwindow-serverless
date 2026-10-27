import crypto from 'node:crypto';
import path from 'node:path';
import { S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const REGION = process.env.AWS_REGION || 'ap-south-1';
const STORAGE_BUCKET = process.env.STORAGE_BUCKET;
const FILES_TABLE = process.env.FILES_TABLE || 'Files';

const s3Client = new S3Client({ region: REGION });
const ddbRawClient = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(ddbRawClient);

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const BLOCKED_EXTENSIONS = new Set([
  '.exe',
  '.bat',
  '.cmd',
  '.scr',
  '.js',
  '.vbs',
  '.ps1'
]);

const ALLOWED_EXPIRY_SECONDS = {
  '1h': 3600,
  '1hour': 3600,
  '1': 3600,
  3600: 3600,
  '6h': 21600,
  '6hour': 21600,
  '6hours': 21600,
  '6': 21600,
  21600: 21600,
  '24h': 86400,
  '24hour': 86400,
  '24hours': 86400,
  '24': 86400,
  86400: 86400
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};

function jsonResponse(statusCode, data) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(data)
  };
}

function sanitizeFileName(rawName) {
  if (typeof rawName !== 'string') return '';
  // Strip directory paths (both unix and windows)
  const base = rawName.split(/[/\\]/).pop() || '';
  // Remove control characters (ASCII 0-31 and 127) and null bytes
  let clean = base.replace(/[\x00-\x1F\x7F]/g, '').trim();
  // Strip characters that are invalid in Windows / standard filenames or dangerous in URLs
  clean = clean.replace(/[<>:"/\\|?*]/g, '_');
  // Avoid leading/trailing dots or spaces
  clean = clean.replace(/^\.+/, '').replace(/\.+$/, '');
  if (!clean || clean === '.' || clean === '..') {
    return '';
  }
  // Truncate to reasonable length (max 150 chars) while preserving extension
  if (clean.length > 150) {
    const ext = path.extname(clean);
    const stem = clean.slice(0, 150 - ext.length);
    clean = stem + ext;
  }
  return clean;
}

export const handler = async (event) => {
  // Handle CORS preflight
  const method = (event.requestContext?.http?.method || event.httpMethod || '').toUpperCase();
  if (method === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: CORS_HEADERS,
      body: ''
    };
  }

  try {
    let body;
    try {
      const rawBody = event.isBase64Encoded
        ? Buffer.from(event.body || '', 'base64').toString('utf-8')
        : (event.body || '{}');
      body = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
    } catch {
      return jsonResponse(400, { error: 'Invalid JSON payload' });
    }

    const { fileName, size, contentType, expiry } = body || {};

    // 1. Validate fileName
    if (!fileName || typeof fileName !== 'string') {
      return jsonResponse(400, { error: 'fileName is required and must be a string' });
    }

    const sanitizedName = sanitizeFileName(fileName);
    if (!sanitizedName) {
      return jsonResponse(400, { error: 'Invalid fileName' });
    }

    // 2. Block hazardous executable and script extensions
    const ext = path.extname(sanitizedName).toLowerCase();
    if (BLOCKED_EXTENSIONS.has(ext)) {
      return jsonResponse(400, {
        error: `Uploads of '${ext}' files are blocked for security reasons.`
      });
    }

    // 3. Validate size
    const numericSize = Number(size);
    if (!Number.isFinite(numericSize) || numericSize <= 0) {
      return jsonResponse(400, { error: 'size must be a positive number of bytes' });
    }
    if (numericSize > MAX_FILE_SIZE) {
      return jsonResponse(400, {
        error: `File size exceeds the 50 MB limit (${MAX_FILE_SIZE} bytes).`
      });
    }

    // 4. Validate expiry choice (1h, 6h, 24h)
    const expiryKey = String(expiry ?? '').trim().toLowerCase();
    const expirySeconds = ALLOWED_EXPIRY_SECONDS[expiryKey] || ALLOWED_EXPIRY_SECONDS[Number(expiry)];
    if (!expirySeconds) {
      return jsonResponse(400, {
        error: "Invalid expiry choice. Allowed values are '1h', '6h', or '24h'."
      });
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const expiresAt = nowSeconds + expirySeconds;

    // 5. Generate unguessable 16-character URL-safe fileId (from 12 random bytes)
    const fileId = crypto.randomBytes(12).toString('base64url');

    // 6. Generate secret deleteToken and hash it with SHA-256
    const deleteToken = crypto.randomBytes(24).toString('base64url');
    const hashedDeleteToken = crypto.createHash('sha256').update(deleteToken).digest('hex');

    const s3Key = `uploads/${fileId}/${sanitizedName}`;
    const safeContentType = (typeof contentType === 'string' && contentType.trim())
      ? contentType.trim().slice(0, 100)
      : 'application/octet-stream';

    // 7. Generate Presigned POST URL and form fields with content-length-range condition
    const presignedPost = await createPresignedPost(s3Client, {
      Bucket: STORAGE_BUCKET,
      Key: s3Key,
      Conditions: [
        ['content-length-range', 1, MAX_FILE_SIZE],
        ['eq', '$key', s3Key],
        ['starts-with', '$Content-Type', '']
      ],
      Fields: {
        key: s3Key,
        'Content-Type': safeContentType
      },
      Expires: 900 // 15 minutes window to complete upload
    });

    // 8. Write item to DynamoDB table
    const item = {
      fileId,
      fileName: sanitizedName,
      size: numericSize,
      contentType: safeContentType,
      s3Key,
      expiresAt, // epoch seconds for DynamoDB TTL
      deleteToken: hashedDeleteToken,
      downloads: 0,
      createdAt: new Date().toISOString()
    };

    await ddb.send(new PutCommand({
      TableName: FILES_TABLE,
      Item: item
    }));

    // 9. Return fileId, presigned upload fields, and deleteToken (plaintext)
    return jsonResponse(201, {
      fileId,
      upload: {
        url: presignedPost.url,
        fields: presignedPost.fields
      },
      deleteToken,
      expiresAt
    });
  } catch (err) {
    console.error('Error in createUpload:', err);
    return jsonResponse(500, { error: 'Internal server error creating upload' });
  }
};
