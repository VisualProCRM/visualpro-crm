// The signed-in Microsoft (Entra ID) user, as verified by the Static Web App.
//
// Because visualpro-crm-func is linked as the Static Web App's backend, the Static Web App
// checks the user's sign-in cookie itself and passes the verified identity to the API in the
// `x-ms-client-principal` header (base64-encoded JSON). The Function App only accepts traffic
// that has come through the Static Web App, so this header can't be supplied by someone
// calling the Function App directly — which is what makes it trustworthy, unlike anything the
// browser says about itself in a request body.
//
// Returns null when nobody is signed in, or when the header is missing or unreadable.
function getPrincipal(request) {
  const raw = request.headers.get('x-ms-client-principal');
  if (!raw) return null;
  try {
    const p = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    if (!p || !p.userId) return null;
    return {
      provider: p.identityProvider || '',
      userId: p.userId,
      email: (p.userDetails || '').toLowerCase(),
      roles: Array.isArray(p.userRoles) ? p.userRoles : [],
    };
  } catch {
    return null;
  }
}

// A real, signed-in Microsoft account from the configured directory. The Static Web App only
// accepts sign-ins from Visual Glazing's own Entra directory (see openIdIssuer in
// staticwebapp.config.json), so any principal that reaches here via `aad` belongs to it.
function isOfficeUser(principal) {
  return !!principal && principal.provider === 'aad' && principal.roles.includes('authenticated');
}

module.exports = { getPrincipal, isOfficeUser };
