"""Load every preset into SQLite using docs/schema.sql and check that the SQL
queries in docs/queries.sql agree with the app's own numbers."""
import json, re, sqlite3, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = (ROOT / 'docs/schema.sql').read_text()
QUERIES = {m.group(1): m.group(2).strip() for m in re.finditer(r'-- name: (\w+)\n(.*?)(?=\n-- name:|\Z)', (ROOT / 'docs/queries.sql').read_text(), re.S)}

def load(db, s, exp):
    t = 'trip1'
    p = s.get('pact') or {}
    db.execute("INSERT INTO trips VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (
        t, s['trip']['name'], s['trip']['destination'], s['phase'], s['costs']['stayTotal'], s['costs']['advance'],
        s['costs']['transportPP'], s['costs']['foodPPPerDay'], p.get('need'), p.get('deadline'), p.get('rule'),
        s['dates']['chosenId'], s.get('album') or None, s['clock']))
    for x in s['people']:
        db.execute("INSERT INTO people VALUES (?,?,?,?,?,?,?)", (x['id'], t, x['name'], 1 if x['organiser'] else 0, x['status'], x['budgetMax'], None))
    for x in s['people']:
        if x.get('replacedBy'):
            db.execute("UPDATE people SET replaced_by=? WHERE id=?", (x['replacedBy'], x['id']))
    for o in s['dates']['options']:
        db.execute("INSERT INTO date_options VALUES (?,?,?,?)", (o['id'], t, o['start'], o['nights']))
    for x in s['people']:
        for oid, v in x['avail'].items():
            db.execute("INSERT INTO availability VALUES (?,?,?)", (x['id'], oid, 1 if v else 0))
    b = s.get('booking')
    if b:
        db.execute("INSERT INTO bookings VALUES (?,?,?,?,?,?,?,?,?)", (t, b['provider'], b['reference'], b['amountPaid'], b['paidBy'], b['cancelBy'], b['status'], b['note'], b['confirmedAt']))
    for e in s['expenses']:
        db.execute("INSERT INTO expenses VALUES (?,?,?,?,?,?,?)", (e['id'], t, e['label'], e['amount'], e['paidBy'], e['source'], e['at']))
        for pid, share in exp['shares'][e['id']].items():
            db.execute("INSERT INTO expense_shares VALUES (?,?,?)", (e['id'], pid, share))
    for m in s['payments']:
        db.execute("INSERT INTO payments VALUES (?,?,?,?,?,?,?)", (m['id'], t, m['from'], m['to'], m['amount'], m['ref'], m['at']))
    for i in s['items']:
        db.execute("INSERT INTO itinerary_items VALUES (?,?,?,?,?,?,?,?,?)", (i['id'], t, i['day'], i['start'], i['end'], i['title'], i['place'], i['costPP'], i['expenseId']))
    return t

failures = 0
for fx in sorted((ROOT / 'test/fixtures').glob('*.json')):
    data = json.loads(fx.read_text()); s, exp = data['state'], data['expected']
    db = sqlite3.connect(':memory:'); db.execute('PRAGMA foreign_keys = ON'); db.executescript(SCHEMA)
    try:
        trip = load(db, s, exp)
    except sqlite3.IntegrityError as e:
        print(f'FAIL {fx.stem}: schema rejected a state the app considers valid: {e}'); failures += 1; continue
    bal = {r[0]: r[1] for r in db.execute(QUERIES['balances'], {'trip': trip})}
    checks = {
        'balances match': bal == exp['balances'],
        'balances sum to zero': sum(bal.values()) == 0,
        'no unbalanced expenses': list(db.execute(QUERIES['unbalanced_expenses'], {'trip': trip})) == [],
    }
    if s.get('pact'):
        need, c, pnd = db.execute(QUERIES['pact_progress'], {'trip': trip}).fetchone()
        checks['pact progress matches'] = (c, pnd) == (exp['committed'], exp['pending'])
    shared, fits = db.execute(QUERIES['budget_fit'], {'trip': trip, 'target': exp['budgetFit']['target']}).fetchone()
    checks['budget fit matches'] = (shared, fits or 0) == (exp['budgetFit']['shared'], exp['budgetFit']['fits'])
    tally = [{'id': r[0], 'yes': r[3]} for r in db.execute(QUERIES['date_tally'], {'trip': trip})]
    checks['date tally matches'] = tally == exp['dateTally']
    bad = [k for k, v in checks.items() if not v]
    print(('ok   ' if not bad else 'FAIL ') + fx.stem + ('' if not bad else ': ' + ', '.join(bad)))
    failures += bool(bad)
    # constraint probes: the schema must refuse states the app refuses
    probes = [
        ("negative expense", "INSERT INTO expenses VALUES ('bad1','trip1','x',-5,'p1','manual','t')"),
        ("self payment", "INSERT INTO payments VALUES ('bad2','trip1','p1','p1',100,'','t')"),
        ("second organiser", "UPDATE people SET is_organiser=1 WHERE id='p2'"),
        ("item ends before it starts", "INSERT INTO itinerary_items VALUES ('bad3','trip1',1,'10:00','09:00','x','',0,NULL)"),
    ]
    for label, sql in probes:
        try:
            db.execute(sql); print(f'FAIL {fx.stem}: schema accepted {label}'); failures += 1
        except sqlite3.IntegrityError:
            pass
print('sql cross-check:', 'all passed' if not failures else f'{failures} failure(s)')
sys.exit(1 if failures else 0)
