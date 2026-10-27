import crypto from 'node:crypto';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

const REGION = process.env.AWS_REGION || 'ap-south-1';
const STORAGE_BUCKET = process.env.STORAGE_BUCKET;
const FILES_TABLE = process.env.FILES_TABLE || 'Files';

const s3Client = new S3Client({ region: REGION });
const ddbRawClient = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(ddbRawClient);

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
    let body = {};
    if (event.body) {
      try {
        const rawBody = event.isBase64Encoded
          ? Buffer.from(event.body, 'base64').toString('utf-8')
          : event.body;
        body = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
      } catch {
        return jsonResponse(400, { error: 'Invalid JSON payload' });
      }
    }

    const qsp = event.queryStringParameters || {};
    const fileId = body.fileId || qsp.fileId || qsp.id;
    const deleteToken = body.deleteToken || qsp.deleteToken;

    if (!fileId || typeof fileId !== 'string') {
      return jsonResponse(400, { error: 'fileId is required' });
    }
    if (!deleteToken || typeof deleteToken !== 'string') {
      return jsonResponse(400, { error: 'deleteToken is required' });
    }

    // 1. Look up file record in DynamoDB
    const getResult = await ddb.send(new GetCommand({
      TableName: FILES_TABLE,
      Key: { fileId }
    }));

    const item = getResult.Item;
    if (!item) {
      return jsonResponse(404, { error: 'File not found' });
    }

    // 2. Hash incoming token and compare with stored hash using timing-safe comparison
    const hashedInput = crypto.createHash('sha256').update(deleteToken).digest('hex');
    const storedHash = item.deleteToken || '';

    const bufInput = Buffer.from(hashedInput, 'utf-8');
    const bufStored = Buffer.from(storedHash, 'utf-8');

    if (bufInput.length !== bufStored.length || !crypto.timingSafeEqual(bufInput, bufStored)) {
      return jsonResponse(403, { error: 'Invalid delete token' });
    }

    // 3. Delete object from S3 if s3Key exists
    if (item.s3Key) {
      try {
        await s3Client.send(new DeleteObjectCommand({
          Bucket: STORAGE_BUCKET,
          Key: item.s3Key
        }));
      } catch (s3Err) {
        console.warn('Error deleting S3 object (might already be deleted):', s3Err);
      }
    }

    // 4. Delete record from DynamoDB
    await ddb.send(new DeleteCommand({
      TableName: FILES_TABLE,
      Key: { fileId }
    }));

    return jsonResponse(200, { message: 'File deleted successfully' });
  } catch (err) {
    console.error('Error in deleteFile:', err);
    return jsonResponse(500, { error: 'Internal server error deleting file' });
  }
};
