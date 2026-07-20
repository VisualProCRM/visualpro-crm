const { app } = require('@azure/functions');
const { BlobServiceClient, generateBlobSASQueryParameters, BlobSASPermissions } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');

const credential = new DefaultAzureCredential();
const accountName = process.env.STORAGE_ACCOUNT_NAME;
const blobServiceClient = new BlobServiceClient(`https://${accountName}.blob.core.windows.net`, credential);

// Uploads a file (sent as base64 in the JSON body) via the Function App's managed
// identity — no storage account key ever touches this code or the browser. Returns a
// long-lived (1 year) read-only SAS URL, generated with a user-delegation key (also via
// managed identity), which the frontend stores directly as the file's "data" reference —
// same shape as the old data: URI it replaces, so display code needed no changes.
app.http('upload', {
  methods: ['POST'],
  route: 'upload',
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
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

      const startsOn = new Date(Date.now() - 5 * 60 * 1000);
      const expiresOn = new Date(startsOn);
      expiresOn.setFullYear(expiresOn.getFullYear() + 1);
      const userDelegationKey = await blobServiceClient.getUserDelegationKey(startsOn, expiresOn);
      const sas = generateBlobSASQueryParameters(
        {
          containerName: container,
          blobName,
          permissions: BlobSASPermissions.parse('r'),
          startsOn,
          expiresOn,
        },
        userDelegationKey,
        accountName
      ).toString();

      return { status: 201, jsonBody: { name: body.filename, type: body.contentType, data: `${blockBlobClient.url}?${sas}` } };
    } catch (err) {
      context.error('upload failed', err);
      return { status: 500, jsonBody: { error: err.message } };
    }
  },
});
