const crypto = require('crypto');

// Fitter passwords, stored hashed (2026-09-21). They used to be kept in plain text in
// dbo.Settings, readable by anyone who could read Settings — and until the same day, that was
// anyone at all (see login.js). Now only a salted scrypt hash is kept; the server checks a
// password against it without ever being able to recover the original.
//
// Stored form: "scrypt$<salt hex>$<hash hex>". Anything that doesn't start with "scrypt$" is a
// legacy plain-text password from before this change, and gets hashed the first time the
// server sees it (see hashPlaintextPasswords).

const PREFIX = 'scrypt$';
const KEY_LENGTH = 64;

const isHashed = (value) => typeof value === 'string' && value.startsWith(PREFIX);

function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(plain, salt, KEY_LENGTH).toString('hex');
  return `${PREFIX}${salt}$${hash}`;
}

// Compares in constant time, so response timing can't be used to guess a password.
function verifyPassword(plain, stored) {
  if (!stored || typeof plain !== 'string') return false;
  if (!isHashed(stored)) {
    // Legacy plain text — only until hashPlaintextPasswords has run over this row.
    const a = Buffer.from(plain);
    const b = Buffer.from(stored);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  const [, salt, hash] = stored.split('$');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(plain, salt, expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// Replaces any plain-text entries in a settings object's fitterPasswords with hashes, in
// place. Returns true if anything changed, so the caller knows to save the row. Hashes and
// empty values are left alone.
function hashPlaintextPasswords(settings) {
  const pws = settings && settings.fitterPasswords;
  if (!pws || typeof pws !== 'object') return false;
  let changed = false;
  for (const [name, value] of Object.entries(pws)) {
    if (typeof value === 'string' && value && !isHashed(value)) {
      pws[name] = hashPassword(value);
      changed = true;
    }
  }
  return changed;
}

module.exports = { isHashed, hashPassword, verifyPassword, hashPlaintextPasswords };
