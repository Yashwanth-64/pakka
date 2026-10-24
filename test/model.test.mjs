import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../src/model.js';
import { PRESETS, DEADLINE, nextScriptedReply } from '../src/presets.js';

const ok = (s, ev) => { const r = M.dispatch(s, ev); assert.equal(r.error, null, `${ev.type} failed: ${r.error}`); assert.deepEqual(M.checkInvariants(r.state), [], `invariants after ${ev.type}`); return r.state; };
const err = (s, ev, re) => { const r = M.dispatch(s, ev); assert.ok(r.error, `${ev.type} should fail`); if (re) assert.match(r.error, re); assert.equal(r.state, s, 'state unchanged on error'); return r.error; };
const R = M.rupees;

test('every preset is reachable and satisfies invariants', () => {
  for (const [k, p] of Object.entries(PRESETS)) {
    const s = p.build();
    assert.deepEqual(M.checkInvariants(s), [], k);
  }
});

test('create trip and invite: guards on group, dates and cost', () => {
  let s = M.blankState();
  err(s, { type: 'INVITE' }, /friends/);
  s = ok(s, { type: 'ADD_PERSON', name: 'Rohan' });
  s = ok(s, { type: 'ADD_PERSON', name: 'Priya' });
  err(s, { type: 'ADD_PERSON', name: 'rohan' }, /already/);
  err(s, { type: 'ADD_PERSON', name: '   ' }, /name/);
  err(s, { type: 'INVITE' });
  err(s, { type: 'ADD_DATE_OPTION', start: '2026-10-01', nights: 2 }, /passed/);
  err(s, { type: 'ADD_DATE_OPTION', start: '2026-11-13', nights: 0 }, /Nights/);
  s = ok(s, { type: 'ADD_DATE_OPTION', start: '2026-11-13', nights: 3 });
  s = ok(s, { type: 'INVITE' });
  assert.equal(s.phase, 'aligning');
});

test('pact cannot open without chosen dates; threshold unlocks booking', () => {
  let s = PRESETS.aligning.build();
  err(s, { type: 'OPEN_PACT', need: 6, deadline: DEADLINE, rule: 'keep' }, /dates/i);
  s = ok(s, { type: 'CHOOSE_DATES', option: s.dates.options[0].id });
  err(s, { type: 'OPEN_PACT', need: 1, deadline: DEADLINE, rule: 'keep' });
  err(s, { type: 'OPEN_PACT', need: 6, deadline: '2026-10-01T00:00:00+05:30', rule: 'keep' });
  s = ok(s, { type: 'OPEN_PACT', need: 3, deadline: DEADLINE, rule: 'keep' });
  assert.equal(s.phase, 'committing');
  err(s, { type: 'CONFIRM_BOOKING', reference: 'X', amountPaid: R(1000), paidBy: 'p1', cancelBy: '2026-11-01' });
  s = ok(s, { type: 'RESPOND', id: 'p2', answer: 'in' });
  s = ok(s, { type: 'RESPOND', id: 'p3', answer: 'in' });
  assert.equal(s.phase, 'ready_to_book');
  assert.match(s.log[0].effects.join(' '), /pakka/);
});

test('deadline expiry fails the pact, then revise or cancel recovers', () => {
  let s = PRESETS.pact.build();
  s = ok(s, { type: 'SET_CLOCK', clock: '2026-10-28T18:30:00+05:30' });
  assert.equal(s.phase, 'failed');
  err(s, { type: 'RESPOND', id: 'p2', answer: 'in' });
  err(s, { type: 'REVISE_PACT', need: 4, deadline: '2026-10-28T10:00:00+05:30' }, /future/);
  const revised = ok(s, { type: 'REVISE_PACT', need: 4, deadline: '2026-10-30T18:00:00+05:30' });
  assert.equal(revised.phase, 'ready_to_book', '4 already committed, so the revised line is met at once');
  const cancelled = ok(s, { type: 'CANCEL' });
  assert.equal(cancelled.phase, 'cancelled');
  err(cancelled, { type: 'ADD_PERSON', name: 'Zoya' }, /finished/);
});

test('withdrawal before booking drops back under the line and recalculates', () => {
  let s = PRESETS.pact.build();
  s = ok(s, { type: 'RESPOND', id: 'p2', answer: 'in' });
  s = ok(s, { type: 'RESPOND', id: 'p8', answer: 'in' });
  assert.equal(s.phase, 'ready_to_book');
  const pp6 = M.costPerPerson(s, 6);
  s = ok(s, { type: 'WITHDRAW', id: 'p4' });
  assert.equal(s.phase, 'committing');
  assert.equal(M.committed(s).length, 5);
  assert.ok(M.costPerPerson(s, 5) > pp6);
  assert.ok(s.log[0].effects.some(e => /forecast/.test(e)));
  assert.ok(s.log[0].effects.some(e => /Booking locked/.test(e)));
});

test('withdrawal after booking applies the agreed rule (keep vs absorb)', () => {
  const base = PRESETS.booked.build();            // rule keep, advance 12,000 across 6
  let keep = ok(base, { type: 'WITHDRAW', id: 'p3' }); // Priya already paid 2,000
  assert.equal(M.balances(keep).p3, 0, 'keep: Priya still owes her share, which she already paid');
  let absorb = JSON.parse(JSON.stringify(base)); absorb.pact.rule = 'absorb';
  absorb = ok(absorb, { type: 'WITHDRAW', id: 'p3' });
  assert.equal(M.balances(absorb).p3, R(2000), 'absorb: Priya is now owed her 2,000 back');
  const adv = absorb.expenses.find(e => e.source === 'advance');
  assert.equal(adv.among.length, 5);
  assert.equal(M.settlements(absorb).filter(t => t.to === 'p3').reduce((a, t) => a + t.amount, 0), R(2000), 'settle-up returns exactly her 2,000');
});

test('replacement takes over the share', () => {
  let s = ok(PRESETS.booked.build(), { type: 'WITHDRAW', id: 'p8' });
  err(s, { type: 'REPLACE', id: 'p2', name: 'Zoya' }, /pulled out/);
  s = ok(s, { type: 'REPLACE', id: 'p8', name: 'Zoya' });
  const z = s.people.find(p => p.name === 'Zoya');
  assert.equal(M.balances(s)[z.id], -R(2000));
  assert.equal(M.balances(s).p8, 0);
});

test('stay cost change updates forecast; advance is locked once paid', () => {
  let s = PRESETS.booked.build();
  const before = M.costPerPerson(s, 6);
  s = ok(s, { type: 'SET_COSTS', costs: { stayTotal: R(42000) } });
  assert.equal(M.costPerPerson(s, 6) - before, R(1000));
  err(s, { type: 'SET_COSTS', costs: { advance: R(15000) } }, /advance/);
  err(s, { type: 'SET_COSTS', costs: { stayTotal: R(5000) } }, /advance/);
  err(s, { type: 'SET_COSTS', costs: { transportPP: -1 } });
});

test('booking needs a real reference and is never auto-confirmed', () => {
  let s = PRESETS.pact.build();
  s = ok(s, { type: 'RESPOND', id: 'p2', answer: 'in' });
  s = ok(s, { type: 'RESPOND', id: 'p8', answer: 'in' });
  err(s, { type: 'CONFIRM_BOOKING', reference: '  ', amountPaid: R(12000), paidBy: 'p1', cancelBy: '2026-11-06' }, /reference/);
  err(s, { type: 'CONFIRM_BOOKING', reference: 'ABC', amountPaid: 0, paidBy: 'p1', cancelBy: '2026-11-06' });
  err(s, { type: 'CONFIRM_BOOKING', reference: 'ABC', amountPaid: R(100), paidBy: 'p1', cancelBy: '' });
  err(s, { type: 'START_TRIP' });
  s = ok(s, { type: 'CONFIRM_BOOKING', reference: 'ABC', amountPaid: R(10000), paidBy: 'p1', cancelBy: '2026-11-06' });
  assert.equal(s.costs.advance, R(10000), 'planned advance follows what was actually paid');
});

test('date change after booking flags booking and items; start blocked until re-checked', () => {
  let s = PRESETS.booked.build();
  s = ok(s, { type: 'ADD_ITEM', day: 4, start: '09:00', end: '11:00', title: 'Breakfast and check-out' });
  const short = s.dates.options.find(o => o.nights === 2);
  s = ok(s, { type: 'CHOOSE_DATES', option: short.id });
  assert.equal(s.booking.status, 'needs_recheck');
  const flags = M.itemFlags(s);
  const outside = s.items.filter(it => flags[it.id].includes('outside'));
  assert.deepEqual(outside.map(i => i.title), ['Breakfast and check-out'], 'day 4 falls outside a 2-night trip');
  err(s, { type: 'START_TRIP' }, /Re-confirm/);
  s = ok(s, { type: 'RECHECK_BOOKING', reference: 'HMX4K2T9Q-B' });
  s = ok(s, { type: 'START_TRIP' });
  assert.equal(s.phase, 'on_trip');
});

test('itinerary: conflicts flagged, invalid input rejected, logged items protected', () => {
  let s = PRESETS.booked.build();
  err(s, { type: 'ADD_ITEM', day: 1, start: '10:00', end: '09:00', title: 'Bad' }, /End time/);
  err(s, { type: 'ADD_ITEM', day: 9, start: '10:00', end: '11:00', title: 'Bad' }, /day/);
  err(s, { type: 'ADD_ITEM', day: 1, start: '10:00', end: '11:00', title: ' ' }, /title/);
  s = ok(s, { type: 'ADD_ITEM', day: 2, start: '11:00', end: '12:30', title: 'Late breakfast', costPP: R(300) });
  const id = s.items.find(i => i.title === 'Late breakfast').id;
  assert.ok(M.itemFlags(s)[id].some(f => f.startsWith('clash')));
  assert.ok(s.log[0].effects.some(e => /Overlaps/.test(e)));
  s = ok(s, { type: 'REMOVE_ITEM', id });
  assert.ok(!s.items.some(i => i.id === id));
  let t = PRESETS.trip.build();
  const logged = t.items.find(i => i.expenseId);
  err(t, { type: 'REMOVE_ITEM', id: logged.id }, /ledger/);
  err(t, { type: 'LOG_ITEM_EXPENSE', id: logged.id, paidBy: 'p1', among: ['p1'] }, /already/);
});

test('expenses with uneven participation; settlement closes the trip', () => {
  let s = PRESETS.settle.build();
  err(s, { type: 'CLOSE' }, /settled/);
  err(s, { type: 'ADD_EXPENSE', label: 'Fuel', amount: -5, paidBy: 'p1', among: ['p1'] });
  err(s, { type: 'ADD_EXPENSE', label: 'Fuel', amount: R(100), paidBy: 'p1', among: [] });
  s = ok(s, { type: 'ADD_EXPENSE', label: 'Snacks', amount: 1001, paidBy: 'p2', among: ['p2', 'p3', 'p4'] });
  const sh = M.expenseShares(s.expenses.at(-1));
  assert.deepEqual(Object.values(sh).sort(), [333, 334, 334].sort());
  for (const t of M.settlements(s)) s = ok(s, { type: 'RECORD_PAYMENT', from: t.from, to: t.to, amount: t.amount });
  assert.ok(M.allSettled(s));
  s = ok(s, { type: 'CLOSE' });
  assert.equal(s.phase, 'closed');
  const again = M.planAgain(s);
  assert.equal(again.phase, 'draft');
  assert.deepEqual(M.checkInvariants(again), []);
});

test('nothing in the ledger can be represented as paid without a payment record', () => {
  const s = PRESETS.booked.build();
  const owed = M.settlements(s).filter(t => t.to === 'p1').map(t => t.from).sort();
  assert.deepEqual(owed, ['p2', 'p4', 'p8'], 'only those who recorded payments are clear');
});

test('scripted demo replies always produce valid states', () => {
  let s = PRESETS.pact.build(); let ev;
  while ((ev = nextScriptedReply(s))) s = ok(s, ev);
  assert.equal(s.phase, 'ready_to_book');
});

test('next actions are role-aware', () => {
  const s = PRESETS.pact.build();
  assert.ok(M.nextActions(s, 'p1').some(a => /more to go/.test(a.text)));
  assert.ok(M.nextActions(s, 'p2').some(a => /in or out/.test(a.text)));
});

test('budget fit never reveals individual ceilings', () => {
  const f = M.budgetFit(PRESETS.aligning.build());
  assert.deepEqual(Object.keys(f).sort(), ['fits', 'of', 'shared', 'target']);
  assert.ok(f.fits <= f.shared && f.shared <= f.of);
});
