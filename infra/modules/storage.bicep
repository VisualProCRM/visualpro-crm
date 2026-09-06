@description('Azure region for the storage account')
param location string

@description('Globally-unique storage account name (lowercase, no hyphens, <=24 chars)')
param storageAccountName string

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    allowSharedKeyAccess: true
    accessTier: 'Hot'
  }
}

// Needed so the browser can fetch() a blob's raw bytes client-side (e.g. pdf.js reading an
// uploaded Survey PDF to digitise it) — opening a file via a plain <a href>/<img src> never
// needed this, since CORS only governs JS-initiated cross-origin requests, not normal
// browser navigation/resource loading. Without this, fetch() fails with an opaque "Failed to
// fetch" and no other diagnostic.
resource blobServices 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storageAccount
  name: 'default'
  properties: {
    cors: {
      corsRules: [
        {
          allowedOrigins: [
            'https://mango-beach-0c25f8610.7.azurestaticapps.net'
            'https://crm.glazestream.co.uk'
            'http://localhost:3000'
          ]
          allowedMethods: [
            'GET'
            'HEAD'
          ]
          allowedHeaders: [
            '*'
          ]
          exposedHeaders: [
            '*'
          ]
          maxAgeInSeconds: 3600
        }
      ]
    }
  }
}

resource documentsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobServices
  name: 'documents'
  properties: {
    publicAccess: 'None'
  }
}

resource photosContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobServices
  name: 'photos'
  properties: {
    publicAccess: 'None'
  }
}

output storageAccountName string = storageAccount.name
output storageAccountId string = storageAccount.id
output primaryBlobEndpoint string = storageAccount.properties.primaryEndpoints.blob
