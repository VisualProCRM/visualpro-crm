@description('Data residency location for the Communication/Email services (a logical region for Communication Services, independent of the ARM resource location which must be "global"). Using "United States" — the value used in virtually all Microsoft ACS samples/docs, so most likely to be a valid enum value — rather than guessing at a UK-specific one; revisit if UK data residency matters later.')
param dataLocation string = 'United States'

param communicationServiceName string = 'visualpro-crm-acs'
param emailServiceName string = 'visualpro-crm-email'

// Azure-managed domain: Azure auto-provisions and verifies a *.azurecomm.net sending
// domain automatically, no DNS records needed. Sender address looks unpolished
// (donotreply@<random>.azurecomm.net) until a custom domain (visualglazing.co.uk) is
// added later, which requires adding DNS TXT/CNAME records the domain owner must set up.
resource emailService 'Microsoft.Communication/emailServices@2023-04-01' = {
  name: emailServiceName
  location: 'global'
  properties: {
    dataLocation: dataLocation
  }
}

resource emailDomain 'Microsoft.Communication/emailServices/domains@2023-04-01' = {
  parent: emailService
  name: 'AzureManagedDomain'
  location: 'global'
  properties: {
    domainManagement: 'AzureManaged'
  }
}

resource senderUsername 'Microsoft.Communication/emailServices/domains/senderUsernames@2023-04-01' = {
  parent: emailDomain
  name: 'donotreply'
  properties: {
    username: 'donotreply'
    displayName: 'VisualPro CRM'
  }
}

resource communicationService 'Microsoft.Communication/communicationServices@2023-04-01' = {
  name: communicationServiceName
  location: 'global'
  properties: {
    dataLocation: dataLocation
    linkedDomains: [
      emailDomain.id
    ]
  }
}

output communicationServiceName string = communicationService.name
output emailServiceName string = emailService.name
// Not attempting to compute the actual donotreply@<domain> address here — the exact
// property name for an Azure-managed domain's assigned hostname isn't certain from this
// context. The sending Function looks it up itself at runtime via the ARM API instead,
// which is easier to debug (curl the Function, see the real response) than a Bicep
// property reference that either compiles correctly or doesn't, opaquely.
