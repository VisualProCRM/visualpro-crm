@description('Azure region for the Function App and its dependencies')
param location string

param functionAppName string
param hostingPlanName string
param appInsightsName string

@description('Key Vault URI (e.g. https://visualpro-crm-kv.vault.azure.net/) used only to fetch the runtime storage connection string via a Key Vault reference app setting')
param keyVaultUri string

param sqlServerFqdn string
param sqlDatabaseName string
param storageAccountName string
param storageBlobEndpoint string

@description('Origins allowed to call this API cross-origin (the frontend Static Web App, plus localhost for local dev)')
param corsAllowedOrigins array = [
  'https://mango-beach-0c25f86107.azurestaticapps.net'
  'http://localhost:3000'
]

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
  }
}

resource hostingPlan 'Microsoft.Web/serverfarms@2023-01-01' = {
  name: hostingPlanName
  location: location
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
  properties: {
    reserved: true
  }
}

resource functionApp 'Microsoft.Web/sites@2023-01-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: hostingPlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'Node|20'
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      cors: {
        allowedOrigins: corsAllowedOrigins
        supportCredentials: false
      }
      appSettings: [
        {
          name: 'AzureWebJobsStorage'
          value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/StorageAccountConnectionString/)'
        }
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
        { name: 'FUNCTIONS_WORKER_RUNTIME', value: 'node' }
        { name: 'WEBSITE_NODE_DEFAULT_VERSION', value: '~20' }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
        // Consumed by the Functions code to build a managed-identity SQL connection (no password) and to
        // mint user-delegation SAS tokens for blob access (no account key) — see roadmap phase 2.
        { name: 'SQL_SERVER_FQDN', value: sqlServerFqdn }
        { name: 'SQL_DATABASE_NAME', value: sqlDatabaseName }
        { name: 'STORAGE_ACCOUNT_NAME', value: storageAccountName }
        { name: 'STORAGE_BLOB_ENDPOINT', value: storageBlobEndpoint }
        { name: 'KEY_VAULT_URI', value: keyVaultUri }
      ]
    }
  }
}

output functionAppName string = functionApp.name
output functionAppPrincipalId string = functionApp.identity.principalId
output defaultHostName string = functionApp.properties.defaultHostName
