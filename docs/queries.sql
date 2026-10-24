-- name: balances
-- Net position per person in paise (positive = owed money). Must sum to zero.
WITH paid AS (
  SELECT paid_by AS pid, SUM(amount_paise) AS v FROM expenses WHERE trip_id = :trip GROUP BY paid_by
), owed AS (
  SELECT es.person_id AS pid, SUM(es.share_paise) AS v
  FROM expense_shares es JOIN expenses e ON e.id = es.expense_id
  WHERE e.trip_id = :trip GROUP BY es.person_id
), sent AS (
  SELECT from_person AS pid, SUM(amount_paise) AS v FROM payments WHERE trip_id = :trip GROUP BY from_person
), recv AS (
  SELECT to_person AS pid, SUM(amount_paise) AS v FROM payments WHERE trip_id = :trip GROUP BY to_person
)
SELECT p.id, COALESCE(paid.v, 0) - COALESCE(owed.v, 0) + COALESCE(sent.v, 0) - COALESCE(recv.v, 0) AS balance_paise
FROM people p
LEFT JOIN paid ON paid.pid = p.id
LEFT JOIN owed ON owed.pid = p.id
LEFT JOIN sent ON sent.pid = p.id
LEFT JOIN recv ON recv.pid = p.id
WHERE p.trip_id = :trip
ORDER BY p.id;

-- name: pact_progress
SELECT t.pact_need,
       SUM(CASE WHEN p.status = 'in' THEN 1 ELSE 0 END)      AS committed,
       SUM(CASE WHEN p.status = 'invited' THEN 1 ELSE 0 END) AS pending
FROM trips t JOIN people p ON p.trip_id = t.id
WHERE t.id = :trip
GROUP BY t.pact_need;

-- name: budget_fit
-- Aggregate only: how many shared budgets cover the forecast. Never select budget_max_paise per person.
SELECT COUNT(budget_max_paise) AS shared,
       SUM(CASE WHEN budget_max_paise >= :target THEN 1 ELSE 0 END) AS fits
FROM people
WHERE trip_id = :trip AND status NOT IN ('withdrawn','replaced');

-- name: date_tally
SELECT d.id, d.start_date, d.nights, SUM(CASE WHEN a.can_make = 1 THEN 1 ELSE 0 END) AS can_make
FROM date_options d
LEFT JOIN availability a ON a.date_option_id = d.id
WHERE d.trip_id = :trip
GROUP BY d.id, d.start_date, d.nights
ORDER BY d.start_date;

-- name: unbalanced_expenses
-- Integrity probe: should return no rows.
SELECT e.id, e.amount_paise, SUM(es.share_paise) AS shared
FROM expenses e JOIN expense_shares es ON es.expense_id = e.id
WHERE e.trip_id = :trip
GROUP BY e.id, e.amount_paise
HAVING SUM(es.share_paise) <> e.amount_paise;
