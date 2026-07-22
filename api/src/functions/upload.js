const { app } = require('@azure/functions');
const { BlobServiceClient, BlobSASPermissions } = require('@azure/storage-blob');
const { requireAuth } = require('../auth');

// Uploads a file (sent as base64 in the JSON body) and returns a long-lived (10 year)
// read-only SAS URL, which the frontend stores directly as the file's "data" reference —
// same shape as the old data: URI it replaces, so display code needed no changes.
//
// Uses the storage account's connection string (shared key) rather than a managed-identity
// user-delegation SAS: Azure caps user-delegation key validity at 7 days, too short for
// files (survey photos, guarantees, etc.) that need to stay viewable indefinitely.
const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.STORAGE_CONNECTION_STRING);

app.http('upload', {
  methods: ['POST'],
  route: 'upload',
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      requireAuth(request);
      const body = await request.json();
      const container = body.container === 'photos' ? 'photos' : 'documents';
      const safeName = (body.filename || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
      const blobName = `${Date.now()}-${safeName}`;

      const containerClient = blobServiceClient.getContainerClient(container);
      const blockBlobClient = containerClient.getBlockBlobClient(blobName);
      const buffer = Buffer.from(body.dataBase64, 'base64');
      await blockBlobClient.upload(buffer, buffer.length, {
        blobHTTPHeaders: { blobContentType: body.contentType || 'application/octet-stream' },
      });

      const expiresOn = new Date();
      expiresOn.setFullYear(expiresOn.getFullYear() + 10);
      const url = await blockBlobClient.generateSasUrl({
        permissions: BlobSASPermissions.parse('r'),
        expiresOn,
      });

      return { status: 201, jsonBody: { name: body.filename, type: body.contentType, data: url } };
    } catch (err) {
      context.error('upload failed', err);
      return { status: err.status || 500, jsonBody: { error: err.message } };
    }
  },
});
