# Decisions and the skills behind them

**Stack (senior-frontend + senior-fullstack decision engines).**
Inputs: mobile-4G primary, LCP target 1.5 s, not SEO-dependent, not auth-walled, 1 engineer, low write ratio.
- Frontend engine: top match `astro-or-static` violated its own key constraints (SEO, read-heavy); runner-up `remix-or-sveltekit` (low-JS, 80 KB gzip budget) is the honest fit. The prototype ships as framework-free ES modules bundled into one file: 29.5 KB gzip JS.
- Fullstack engine: `saas-startup` (100%): modular monolith on Postgres when this goes multi-user. `docs/schema.sql` is written for that, event log first.
- Verifiable targets: LCP ≤ 1.5 s and INP ≤ 200 ms on mobile-4G p75, CLS ≤ 0.1, JS ≤ 80 KB gzip (enforced in `build.mjs`); production API p95 ≤ 300 ms, 99.5% monthly uptime. Only the bundle budget is measured here.

**Scope (product-manager-toolkit RICE, `docs/rice_features.csv` → `docs/rice_output.txt`).**
Reach, impact, confidence and effort are my estimates, not data. Built: shared model + event log, booking register, single ledger, private budgets, dropout recalculation, calendar/maps links, date tally, album/pulse/plan-again, itinerary flags, expenses. Deferred: live multi-user sync (big bet), real UPI collection/escrow (regulated), multi-origin transport, weather plan B, room allocation, dining vote.

**Audit (ux-researcher-designer journey map).** `docs/AUDIT.md`. Emotion/pain columns are hypotheses, not interview data; no persona was generated because there is no user data to generate it from.

**Integrations (deep-research).** Three parallel research threads plus a synthesis: `reports/Friend trip app integrations India.md`. Findings changed the build: UPI requests became pay-it-yourself, the pact deadline warning uses a 17-day buffer, Airbnb bookings may be paid in full upfront, Photos is link-only.

**Data (sql-database-assistant).** Integer paise, CHECK constraints for every rule the app enforces, partial unique indexes (one organiser, one advance), materialised exact splits, append-only events. `test/sql_crosscheck.py` proves the SQL and the app agree on all presets.

**Not done on purpose.** No runtime capabilities are declared in the shared build (connector or Claude access would prompt every viewer). The Google Calendar connector's `create_event` schema was checked and would slot in behind `tripCalendarLink` as an owner-only upgrade.
