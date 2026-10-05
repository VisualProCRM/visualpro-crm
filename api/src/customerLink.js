// A job's customer link (dbo.Jobs.CustomerId) decides who every automatic email goes to, so a
// change to it must never be silent. On 2026-10-05 a reminder for one customer went to another
// and nothing recorded when the link had moved or what moved it.
//
// The record of changes lives on the job itself (`customerLinkLog`, newest last) rather than in a
// table: the API's database role can read and write rows but not create tables. It is owned by the
// server — every save carries forward what is stored and ignores whatever the client sent, the
// same way check-ins and email sent-flags are protected from a stale browser tab.
const MAX_ENTRIES = 25;

// `fromId` is the column's value before this write, `toId` what is about to be written.
// Returns the log to store: unchanged when the link is unchanged.
function nextLinkLog(priorLog, fromId, toId, source, actor) {
  const log = Array.isArray(priorLog) ? priorLog : [];
  const from = Number(fromId);
  const to = Number(toId);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return log;
  const entry = { at: new Date().toISOString(), from, to, source, by: actor || '' };
  return [...log, entry].slice(-MAX_ENTRIES);
}

module.exports = { nextLinkLog };
