// Deploys the VisualPro CRM backend (SQL, Storage, Functions, Key Vault) into the
// EXISTING resource group `visualpro-crm_group` (deploy with `az deployment group create`).
// The existing Static Web App in that resource group is untouched by this template.

@description('Azure region for the new backend resources')
param location string = 'uksouth'

@description('Display name of the Entra ID user or group that will be the SQL AAD admin')
param sqlAadAdminLogin string

@description('Object ID of the Entra ID user or group that will be the SQL AAD admin')
param sqlAadAdminObjectId string

@description('Whether sqlAadAdminObjectId is a User or a Group')
@allowed(['User', 'Group'])
param sqlAadAdminType string = 'User'

@description('Object ID of the principal running this deployment (the gh-deploy-visualpro-crm app registration). Needs set/get/list on Key Vault secrets so the deployment can write them.')
param deployPrincipalObjectId string

param sqlServerName string = 'visualpro-crm-sql'
param sqlDatabaseName string = 'visualpro-crm-db'
param storageAccountName string = 'visualprocrmstorage'
param functionAppName string = 'visualpro-crm-func'
param hostingPlanName string = 'visualpro-crm-plan'
param appInsightsName string = 'visualpro-crm-insights'
param keyVaultName string = 'visualpro-crm-kv'

module storage 'modules/storage.bicep' = {
  name: 'storage-deploy'
  params: {
    location: location
    storageAccountName: storageAccountName
  }
}

module sql 'modules/sql.bicep' = {
  name: 'sql-deploy'
  params: {
    location: location
    sqlServerName: sqlServerName
    sqlDatabaseName: sqlDatabaseName
    aadAdminLogin: sqlAadAdminLogin
    aadAdminObjectId: sqlAadAdminObjectId
    aadAdminType: sqlAadAdminType
  }
}

// Referenced (not re-declared) so we can build a connection string for the Function
// runtime's own AzureWebJobsStorage setting without exposing it as a module output.
resource storageAccountExisting 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
  dependsOn: [
    storage
  ]
}

var storageConnectionString = 'DefaultEndpointsProtocol=https;AccountName=${storageAccountName};AccountKey=${storageAccountExisting.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'

module keyVault 'modules/keyvault.bicep' = {
  name: 'keyvault-deploy'
  params: {
    location: location
    keyVaultName: keyVaultName
    deployPrincipalObjectId: deployPrincipalObjectId
    storageAccountConnectionString: storageConnectionString
  }
}

module functionApp 'modules/functionapp.bicep' = {
  name: 'functionapp-deploy'
  params: {
    location: location
    functionAppName: functionAppName
    hostingPlanName: hostingPlanName
    appInsightsName: appInsightsName
    keyVaultUri: keyVault.outputs.vaultUri
    sqlServerFqdn: sql.outputs.sqlServerFqdn
    sqlDatabaseName: sql.outputs.sqlDatabaseName
    storageAccountName: storage.outputs.storageAccountName
    storageBlobEndpoint: storage.outputs.primaryBlobEndpoint
  }
}

// Grant the Function App's managed identity access to read the runtime storage secret.
// Added as a standalone resource (rather than inside keyvault.bicep) to avoid a circular
// module dependency: the Function App doesn't exist yet when the Key Vault is created.
resource functionAppKeyVaultAccess 'Microsoft.KeyVault/vaults/accessPolicies@2023-07-01' = {
  name: '${keyVaultName}/add'
  properties: {
    accessPolicies: [
      {
        tenantId: subscription().tenantId
        objectId: functionApp.outputs.functionAppPrincipalId
        permissions: {
          secrets: ['get', 'list']
        }
      }
    ]
  }
  dependsOn: [
    keyVault
  ]
}

// Lets the Function App's managed identity read/write the documents & photos containers directly.
resource blobDataContributorAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccountExisting.id, functionAppName, 'StorageBlobDataContributor')
  scope: storageAccountExisting
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
    principalId: functionApp.outputs.functionAppPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// Lets the Function App's managed identity mint short-lived user-delegation SAS tokens
// for the browser to upload/download documents & photos directly, without ever handling
// the storage account key.
resource blobDelegatorAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccountExisting.id, functionAppName, 'StorageBlobDelegator')
  scope: storageAccountExisting
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'db58b8e5-c6ad-4a2a-8342-4190687cbf4a')
    principalId: functionApp.outputs.functionAppPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output sqlServerFqdn string = sql.outputs.sqlServerFqdn
output sqlDatabaseName string = sql.outputs.sqlDatabaseName
output storageAccountName string = storage.outputs.storageAccountName
output functionAppName string = functionApp.outputs.functionAppName
output functionAppDefaultHostName string = functionApp.outputs.defaultHostName
output functionAppPrincipalId string = functionApp.outputs.functionAppPrincipalId
output keyVaultName string = keyVault.outputs.vaultName
