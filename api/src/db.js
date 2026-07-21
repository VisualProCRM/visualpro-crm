const sql = require('mssql');
const { DefaultAzureCredential } = require('@azure/identity');

const credential = new DefaultAzureCredential();
let poolPromise = null;

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function connect() {
  const tokenResponse = await credential.getToken('https://database.windows.net/.default');
  return sql.connect({
    server: process.env.SQL_SERVER_FQDN,
    database: process.env.SQL_DATABASE_NAME,
    options: { encrypt: true },
    connectionTimeout: 30000,
    requestTimeout: 30000,
    authentication: {
      type: 'azure-active-directory-access-token',
      options: { token: tokenResponse.token },
    },
  });
}

// Consumption-plan cold starts naturally refresh this, so we don't handle mid-life
// token expiry (~60-90 min) yet — acceptable for now, worth revisiting under real load.
//
// Serverless SQL auto-pauses after idle time and takes tens of seconds to resume on the
// next connection. Retries a couple of times with a short backoff to ride that out within
// one request, and — critically — clears the cached pool promise on failure, so a failed
// attempt doesn't get stuck being reused forever by every subsequent request on this warm
// instance (that was a real bug: the previous version cached the promise unconditionally,
// including when it rejected).
async function getPool() {
  if (poolPromise) return poolPromise;
  poolPromise = (async () => {
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        return await connect();
      } catch (err) {
        lastErr = err;
        if (attempt < 3) await sleep(5000 * attempt);
      }
    }
    throw lastErr;
  })();
  try {
    return await poolPromise;
  } catch (err) {
    poolPromise = null;
    throw err;
  }
}

module.exports = { getPool, sql };
