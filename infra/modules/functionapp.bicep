@description('Azure region for the Function App and its dependencies')
param location string

param functionAppName string
param hostingPlanName string
param appInsightsName string

@description('Key Vault URI (e.g. https://visualpro-crm-kv.vault.azure.net/) — currently just surfaced as an app setting for later use, not used for AzureWebJobsStorage anymore (see below).')
param keyVaultUri string

@description('Storage account connection string for the Functions runtime\'s own internal AzureWebJobsStorage plumbing. Set directly (not via Key Vault reference) because azure/functions-action needs to read a literal connection string to manage deployment packages — it cannot resolve a @Microsoft.KeyVault(...) reference. Actual document/photo blob access still goes through the managed identity, not this value.')
@secure()
param storageAccountConnectionString string

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
          value: storageAccountConnectionString
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
