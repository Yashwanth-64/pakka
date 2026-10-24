# Loop log (inspect → hypothesise → implement → test → observe → refine)

| # | Friction / failure observed | Hypothesis | Change | Test | Result |
|---|---|---|---|---|---|
| 1 | v1 marks "Book the villa" as done after a toast | An unconfirmed external action must never look complete | `CONFIRM_BOOKING` guarded on reference + amount + cancel-by; Start trip guarded on confirmed booking | unit + e2e "booking without reference is refused" | Pass |
| 2 | Dropout rule recorded but never applied | Rule must change the ledger, not just the copy | `WITHDRAW` re-splits or keeps the advance by rule; `REPLACE` moves the share | unit keep/absorb + e2e withdraw/replace | Pass |
| 3 | Each screen held its own numbers | One store + selectors removes drift | Model + reducer + invariants; UI renders selectors only | random walk, 2,000 events | Pass |
| 4 | Draft never advanced to aligning (bug found by tests) | Transitions scattered across cases | Matched edge sets the phase in one place | 20 tests went red → green | Fixed |
| 5 | Ids collided after log entries consumed the shared counter | Per-prefix counters keep people p1–p8 stable | `seq` became a map | presets + fuzz | Fixed |
| 6 | Dates had no consequences after booking | Date change should flag booking and items | `CHOOSE_DATES` in booked → `needs_recheck` + outside-range flags | unit + e2e | Pass |
| 7 | Research: P2P UPI collect banned (1 Oct 2025); holds merchant-only | "Request" must mean remind + pay-it-yourself | Share list with "I've paid" / "Received"; no payable links to invented UPI IDs | e2e settle journey | Pass |
| 8 | Research: villas refund fully only 14+ days out | Pact should close ≥17 days before check-in | `deadlineBuffer` warning in setup + home; preset clock moved a week earlier | unit + visual | Pass |
| 9 | Phone header clipped the viewer select; Money tab off-screen | Stack the label, share width evenly across 6 tabs | Header + tab CSS | measured: no tab overflow at 360/390/1280px | Fixed |
| 10 | Analyzer flagged innerHTML; initials were unescaped | Names could inject markup | `ini()` escapes; template sweep; e2e with a hostile name | e2e XSS check | Fixed |

Unresolved: real multi-user sync, payment partner, booking supply partnership, interview evidence.
