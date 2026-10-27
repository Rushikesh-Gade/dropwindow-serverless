import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

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
    const qsp = event.queryStringParameters || {};
    const fileId = qsp.id || qsp.fileId || event.pathParameters?.id || event.pathParameters?.fileId;

    if (!fileId || typeof fileId !== 'string') {
      return jsonResponse(400, { error: "Missing required query parameter 'id'" });
    }

    // 1. Fetch file record from DynamoDB
    const getResult = await ddb.send(new GetCommand({
      TableName: FILES_TABLE,
      Key: { fileId }
    }));

    const item = getResult.Item;
    if (!item) {
      return jsonResponse(404, { error: 'File not found' });
    }

    // 2. Critical: Check TTL expiration in code (DynamoDB TTL deletion is lazy and may lag by 48h)
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (typeof item.expiresAt === 'number' && item.expiresAt <= nowSeconds) {
      return jsonResponse(410, { error: 'This link has expired' });
    }

    // 3. Atomically increment downloads counter
    let updatedDownloads = (item.downloads || 0) + 1;
    try {
      const updateResult = await ddb.send(new UpdateCommand({
        TableName: FILES_TABLE,
        Key: { fileId },
        UpdateExpression: 'ADD downloads :inc',
        ExpressionAttributeValues: { ':inc': 1 },
        ReturnValues: 'UPDATED_NEW'
      }));
      if (typeof updateResult.Attributes?.downloads === 'number') {
        updatedDownloads = updateResult.Attributes.downloads;
      }
    } catch (updateErr) {
      console.warn('Could not increment downloads atomically:', updateErr);
    }

    // 4. Generate Presigned GET URL valid for 60 seconds with attachment header
    const safeAsciiName = (item.fileName || 'file').replace(/[^\x20-\x7E]|["\\]/g, '_');
    const rfc5987Name = encodeURIComponent(item.fileName || 'file');
    const contentDisposition = `attachment; filename="${safeAsciiName}"; filename*=UTF-8''${rfc5987Name}`;

    const getCommand = new GetObjectCommand({
      Bucket: STORAGE_BUCKET,
      Key: item.s3Key,
      ResponseContentDisposition: contentDisposition,
      ResponseContentType: item.contentType || 'application/octet-stream'
    });

    const downloadUrl = await getSignedUrl(s3Client, getCommand, { expiresIn: 60 });

    // 5. Return metadata + download URL
    return jsonResponse(200, {
      fileId: item.fileId,
      fileName: item.fileName,
      size: item.size,
      contentType: item.contentType,
      expiresAt: item.expiresAt,
      createdAt: item.createdAt,
      downloads: updatedDownloads,
      downloadUrl
    });
  } catch (err) {
    console.error('Error in getFile:', err);
    return jsonResponse(500, { error: 'Internal server error retrieving file' });
  }
};
