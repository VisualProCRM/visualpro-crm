# Feature Requests

A shared place for feature ideas, wherever they come from — the office, a fitter suggestion, or from a Claude session that doesn't have direct access to Claude Code. Edit this file directly on GitHub (no need to touch Claude Code) and Claude will read it when working in this repo.

**How to add a request**: add a new entry under "Requested", with your name and today's date. Don't worry about wording it perfectly or prioritizing it — just get it down, and it'll get discussed and scoped properly before anything is built.

---

## Requested

### Fitter end-of-job checklist with sign-off
- Requested by: office — 2026-07-30
- A checklist of things fitters need to do/confirm at the end of a job, with some kind of sign-off.

### Customer sector categorization: Retail / Trade / Commercial
- Requested by: office — 2026-07-30
- Classify customers by industry sector, to report on customer counts and average margins per sector.

### WindowCAD7 API integration
- Requested by: office — 2026-07-30
- Connect the existing "WindowCAD7 Reference" field to a real API instead of it just being a free-text label.

### Multiple installation dates per job (phased installs)
- Requested by: Dan — 2026-08-07
- "Please can we add an option to add another installation date so we have the option to book more than one install date per job card. As we will get it a lot where we will do installations in phases."
- Bigger than it first looks: a Job's install date is currently a single field, read from directly by the automatic email reminder timer, the Fitter Calendar, Kanban card badges, and Dashboard delivery tracking — all of these would need to handle multiple dates/phases, not just the Installation tab's own booking UI. Needs a proper design pass before building, not a quick add.
- Note: the "one customer, multiple concurrent jobs" part of this idea already exists (built as part of the Customer/Job unification work) — a Customer can already have several separate Jobs. This request is really about a single Job having multiple install *phases/dates* within it, which is the part that doesn't exist yet.

### Job reference field, shown on the job card (distinguish concurrent jobs for the same customer)
- Requested by: Dan — 2026-08-07
- "On the job card can we add a reference section so we can include the reference in to the main name of the job card. ... we will get a multiple of different jobs from the same trade customer and let's say we have 2 jobs on at the same time, we should be able to see the reference for that job so we know it's that job card for that job. For example, AJ Sellwood may have 2 jobs on, one at 4 Morres Grove and another at 48 Parkway. We would reference these jobs by the first line of address and we should be able to see that so we know which one is which."
- Smaller/separate from the phased-installs request above — a new editable "reference" field on a Job, shown as part of its title/card (Kanban card, job detail header) so two jobs for the same customer are distinguishable at a glance. Auto-generated job titles today are just "{CustomerName} — Installation", which is ambiguous for concurrent jobs. Good candidate for a quick, contained fix next session.

---

## Resolved / not needed

### Multi-job/multi-survey booking per fitter per day
- Requested by: office — 2026-07-30
- Turned out to already work — nothing in the app prevents or hides multiple bookings for the same fitter on the same day; both the office and fitter mobile calendars already show every booking for a day. No build needed, confirmed 2026-07-30.
