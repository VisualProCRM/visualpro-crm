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

@description('Azure Communication Services connection string, used to send emails (install reminders). Plain app setting, same pattern as the storage connection string above.')
@secure()
param acsConnectionString string

@description('Name of the Communication Services Email Service resource, used by the sending Function to look up its assigned Azure-managed sender domain at runtime via the ARM API (needs the Reader role, granted in main.bicep).')
param emailServiceName string

@description('Which ACS Email domain resource to send from — "AzureManagedDomain" (default, always-verified fallback) or the custom domain name (e.g. "visualglazing.co.uk") once its DNS verification records have been added and it shows Verified in the Portal.')
param emailDomainName string = 'AzureManagedDomain'

@description('Sender mailbox username within the chosen email domain — must match a senderUsernames resource under that domain in email.bicep (e.g. "donotreply" for AzureManagedDomain, "enquiries" for the custom domain).')
param emailSenderUsername string = 'donotreply'

@description('Origins allowed to call this API cross-origin (the frontend Static Web App, plus localhost for local dev, plus the Azure Portal so its built-in Test/Run feature works for manually invoking functions like the timer trigger). Note: the SWA hostname changed after upgrading from Free to Standard tier — this is the post-upgrade hostname, not the original.')
param corsAllowedOrigins array = [
  'https://mango-beach-0c25f8610.7.azurestaticapps.net'
  'http://localhost:3000'
  'https://portal.azure.com'
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
        // Used only to generate long-lived (multi-year) read-only SAS URLs for uploaded
        // files in /api/upload. A user-delegation-key SAS (pure managed identity, no
        // account key) was tried first, but Azure caps delegation key validity at 7 days
        // — too short for files that need to stay viewable indefinitely — so this falls
        // back to an account-key-based SAS, which has no such cap.
        { name: 'STORAGE_CONNECTION_STRING', value: storageAccountConnectionString }
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
        { name: 'ACS_CONNECTION_STRING', value: acsConnectionString }
        { name: 'EMAIL_SERVICE_NAME', value: emailServiceName }
        { name: 'EMAIL_DOMAIN_NAME', value: emailDomainName }
        { name: 'EMAIL_SENDER_USERNAME', value: emailSenderUsername }
        { name: 'RESOURCE_GROUP_NAME', value: resourceGroup().name }
        { name: 'AZURE_SUBSCRIPTION_ID', value: subscription().subscriptionId }
      ]
    }
  }
}

output functionAppName string = functionApp.name
output functionAppPrincipalId string = functionApp.identity.principalId
output defaultHostName string = functionApp.properties.defaultHostName
