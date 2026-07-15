@description('Azure region for the SQL server and database')
param location string

@description('Logical SQL server name (globally unique)')
param sqlServerName string

@description('Database name')
param sqlDatabaseName string

@description('Display name of the Entra ID user or group that will be the SQL AAD admin')
param aadAdminLogin string

@description('Object ID of the Entra ID user or group that will be the SQL AAD admin')
param aadAdminObjectId string

@description('Whether the AAD admin principal is a User or a Group')
@allowed(['User', 'Group'])
param aadAdminType string = 'User'

resource sqlServer 'Microsoft.Sql/servers@2023-08-01-preview' = {
  name: sqlServerName
  location: location
  properties: {
    administrators: {
      administratorType: 'ActiveDirectory'
      principalType: aadAdminType
      login: aadAdminLogin
      sid: aadAdminObjectId
      tenantId: subscription().tenantId
      azureADOnlyAuthentication: true
    }
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
  }
}

// Allows Azure services (incl. our Function App) to reach the server.
// Data access itself is still gated by AAD-only auth + per-principal SQL permissions.
resource allowAzureServices 'Microsoft.Sql/servers/firewallRules@2023-08-01-preview' = {
  parent: sqlServer
  name: 'AllowAllWindowsAzureIps'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource sqlDatabase 'Microsoft.Sql/servers/databases@2023-08-01-preview' = {
  parent: sqlServer
  name: sqlDatabaseName
  location: location
  sku: {
    name: 'GP_S_Gen5'
    tier: 'GeneralPurpose'
    family: 'Gen5'
    capacity: 1
  }
  properties: {
    minCapacity: json('0.5')
    autoPauseDelay: 60
    zoneRedundant: false
  }
}

output sqlServerName string = sqlServer.name
output sqlServerFqdn string = sqlServer.properties.fullyQualifiedDomainName
output sqlDatabaseName string = sqlDatabase.name
