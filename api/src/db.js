const sql = require('mssql');
const { DefaultAzureCredential } = require('@azure/identity');

const credential = new DefaultAzureCredential();
let poolPromise = null;

// Consumption-plan cold starts naturally refresh this, so we don't handle mid-life
// token expiry (~60-90 min) yet — acceptable for now, worth revisiting under real load.
async function getPool() {
  if (poolPromise) return poolPromise;
  poolPromise = (async () => {
    const tokenResponse = await credential.getToken('https://database.windows.net/.default');
    return sql.connect({
      server: process.env.SQL_SERVER_FQDN,
      database: process.env.SQL_DATABASE_NAME,
      options: { encrypt: true },
      authentication: {
        type: 'azure-active-directory-access-token',
        options: { token: tokenResponse.token },
      },
    });
  })();
  return poolPromise;
}

module.exports = { getPool, sql };
