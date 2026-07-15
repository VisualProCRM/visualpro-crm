@description('Azure region for the Key Vault')
param location string

@description('Key Vault name (3-24 chars, globally unique)')
param keyVaultName string

@description('Object ID of the principal deploying this template (needs set/get/list on secrets so the deployment can write them)')
param deployPrincipalObjectId string

@description('Storage account connection string, stored as a secret. Used ONLY by the Function App runtime for its own internal AzureWebJobsStorage plumbing — actual document/photo blob access and SQL access go through the Function App managed identity, not this secret.')
@secure()
param storageAccountConnectionString string

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  properties: {
    tenantId: subscription().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: false
    accessPolicies: [
      {
        tenantId: subscription().tenantId
        objectId: deployPrincipalObjectId
        permissions: {
          secrets: ['get', 'list', 'set']
        }
      }
    ]
  }
}

resource storageConnectionStringSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'StorageAccountConnectionString'
  properties: {
    value: storageAccountConnectionString
  }
}

output vaultName string = keyVault.name
output vaultUri string = keyVault.properties.vaultUri
