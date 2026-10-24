# Pakka v1 audit — value chain and broken links

Scope: v1 is a 5-screen local prototype (create pact → share → friend commits → watch count → outcome).
Persona: the organiser of a 5–8 person long-weekend villa trip (Yash); secondary: a friend deciding (Rohan).
Method: UX journey map (ux-researcher-designer, Workflow 2) over the 11 stages in the mission brief.
Emotion and pain columns are **hypotheses from the concept note and gap map, not interview data**.

| # | Stage | v1 today | Broken link / missing | Data needed from earlier stage | Integration that removes friction | Decision for v2 |
|---|---|---|---|---|---|---|
| 1 | Inspiration & initiation | Trip name only | No owner object; trip lives in chat | — | WhatsApp share link (deep link) | Trip card seeded by organiser, shared by link |
| 2 | Group & availability | Fixed 8 names | No availability; dates hard-coded | People | — | Date options with per-person availability tally |
| 3 | Preferences & budget | Contribution maths only | Budgets never asked; awkward to say out loud | People, dates | — | Private budget ceiling; organiser sees only "fits N of M" |
| 4 | Destination & dates | Hard-coded | Chosen dates don't feed booking or itinerary | Availability tally | — | Chosen date option drives nights, days, cost, links |
| 5 | Commitment & dropout rules | **Strong (keep)** | Rule recorded but never applied; withdrawal impossible | Dates, costs, headcount | — | Pact unchanged in spirit; rule applied on withdrawal |
| 6 | Transport, stay, activities | None | — | Dates, headcount | Airbnb / Booking.com search links (unofficial URL formats) | Stay search link-outs + planned costs |
| 7 | Booking readiness & confirmation | "Book the villa" toast | Unconfirmed action shown as done | Threshold met, costs | No public booking API for a small app (pending research) | Manual confirmation: reference + amount + cancel-by; never auto |
| 8 | Pre-trip preparation | None | Nothing on calendars | Booking dates | Google Calendar template link; connector path documented | Calendar link; itinerary per day with map links |
| 9 | On-trip coordination | None | Plan changes don't flag anything | Itinerary, dates | Google Maps URLs (official, no key) | Today view; date change flags items + booking |
| 10 | Shared expenses & settlement | UPI request shown at outcome only | Advance and trip spend in separate tools (Splitwise) | Booking amount, committed list | Splitwise API needs OAuth (category 2) | One ledger: advance + trip costs + payments → minimal transfers |
| 11 | Return, memories, next trip | None | Group context lost after trip | Everything | Google Photos: link only (Library API narrowed Mar 2025) | Album link, 1-tap pulse, "plan again with this group" |

## Broken links fixed in v2 (highest impact first)
1. Booking was represented as done after a toast → explicit confirmation record; Start trip is guarded on it.
2. Dropout rule was decorative → withdrawal recalculates headcount, per-person cost, viability, and ledger shares by rule.
3. Advance split and trip expenses lived in different worlds → single ledger; paying a share is a payment against the advance expense.
4. Dates had no consequences → changing dates after booking flags the booking for re-check and items that fall outside the trip.
5. Each screen kept its own copy of state → one store, events through a guarded graph, invariants checked after every event.

## Kept from v1
No "maybe" option; reminders come from Pakka, not the organiser; nobody pays first; demo is clearly labelled and resettable.
