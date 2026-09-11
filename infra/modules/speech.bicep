@description('Azure region for the Speech resource — must be a region that offers Speech-to-Text; centralus (matching everything else here) does.')
param location string

param speechServiceName string = 'visualpro-crm-speech'

@description('S0 (pay-as-you-go) rather than the free F0 tier — F0 is capped low enough (5 audio hours/month, 20 requests/min) to be a real risk for genuine day-to-day fitter use, and Speech-to-Text is inexpensive per minute.')
resource speechService 'Microsoft.CognitiveServices/accounts@2023-05-01' = {
  name: speechServiceName
  location: location
  kind: 'SpeechServices'
  sku: {
    name: 'S0'
  }
  properties: {
    customSubDomainName: speechServiceName
  }
}

output speechServiceName string = speechService.name
@secure()
output speechKey string = speechService.listKeys().key1
output speechRegion string = location
