const { app } = require('@azure/functions');
const { getPrincipal, isOfficeUser } = require('../principal');

// Reports who the API believes is calling — the verified Microsoft identity passed on by the
// Static Web App, if any. Built to prove that identity actually arrives before the office
// login was made to depend on it (2026-09-21), and kept because it's the quickest way to
// diagnose a sign-in problem, and the foundation roles will be built on.
//
// Safe without auth: it only ever reveals the caller's *own* identity back to them.
app.http('whoami', {
  methods: ['GET'],
  route: 'whoami',
  authLevel: 'anonymous',
  handler: async (request) => {
    const principal = getPrincipal(request);
    return {
      jsonBody: {
        signedIn: !!principal,
        officeUser: isOfficeUser(principal),
        provider: principal ? principal.provider : null,
        email: principal ? principal.email : null,
        roles: principal ? principal.roles : [],
      },
    };
  },
});
