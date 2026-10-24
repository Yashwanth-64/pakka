import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../src/model.js';
import { PRESETS } from '../src/presets.js';

test('every phase is reachable from draft', () => {
  const seen = new Set(['draft']); const q = ['draft'];
  while (q.length) { const p = q.shift(); for (const e of M.edgesFrom(p)) if (!seen.has(e.to)) { seen.add(e.to); q.push(e.to); } }
  assert.deepEqual([...seen].sort(), [...M.PHASES].sort());
});

test('no dead ends: every non-terminal phase can reach a terminal one', () => {
  for (const p of M.PHASES.filter(x => !M.TERMINAL.includes(x))) {
    assert.ok(M.edgesFrom(p).length > 0, `${p} has no way out`);
    const seen = new Set([p]); const q = [p]; let reached = false;
    while (q.length) { const x = q.shift(); if (M.TERMINAL.includes(x)) { reached = true; break; } for (const e of M.edgesFrom(x)) if (!seen.has(e.to)) { seen.add(e.to); q.push(e.to); } }
    assert.ok(reached, `${p} cannot finish`);
  }
});

test('terminal phases have no outgoing edges', () => {
  for (const t of M.TERMINAL) assert.equal(M.edgesFrom(t).length, 0);
});

test('no phase can move to cancelled once money has moved', () => {
  for (const p of ['booked', 'on_trip', 'settling']) assert.ok(!M.edgesFrom(p).some(e => e.to === 'cancelled'), p);
});

test('auto edges out of one phase are mutually exclusive', () => {
  // committing: met-before-deadline vs past-deadline-below-line cannot both hold
  const s = PRESETS.pact.build();
  for (const clock of ['2026-10-27T10:00:00+05:30', '2026-10-29T10:00:00+05:30']) {
    const t = { ...s, clock };
    const fired = M.EDGES.filter(e => e.from === 'committing' && e.on === 'auto' && e.guard(t));
    assert.ok(fired.length <= 1);
  }
});

// Random walk: throw plausible events at the reducer; invariants must hold after every accepted event,
// and rejected events must leave state untouched.
function rng(seed) { return () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296; }
function randomEvent(s, r) {
  const ids = s.people.map(p => p.id); const pick = a => a[Math.floor(r() * a.length)];
  const items = s.items.map(i => i.id); const exps = s.expenses.map(e => e.id);
  const opts = s.dates.options.map(o => o.id);
  const ev = [
    () => ({ type: 'RESPOND', id: pick(ids), answer: pick(['in', 'out']) }),
    () => ({ type: 'WITHDRAW', id: pick(ids) }),
    () => ({ type: 'REPLACE', id: pick(ids), name: 'New' + Math.floor(r() * 99) }),
    () => ({ type: 'ADD_PERSON', name: 'Friend' + Math.floor(r() * 99) }),
    () => ({ type: 'SET_CLOCK', clock: M.addHoursISO(s.clock, Math.floor(r() * 30)) }),
    () => ({ type: 'CHOOSE_DATES', option: pick(opts) }),
    () => ({ type: 'SET_COSTS', costs: { stayTotal: M.rupees(20000 + Math.floor(r() * 30000)) } }),
    () => ({ type: 'CONFIRM_BOOKING', reference: 'R' + Math.floor(r() * 1e6), amountPaid: M.rupees(5000 + Math.floor(r() * 10000)), paidBy: pick(ids), cancelBy: '2026-11-06' }),
    () => ({ type: 'RECHECK_BOOKING', reference: 'RC' }),
    () => ({ type: 'ADD_ITEM', day: 1 + Math.floor(r() * 4), start: '1' + Math.floor(r() * 9) + ':00', end: '19:30', title: 'Thing', costPP: M.rupees(Math.floor(r() * 900)) }),
    () => ({ type: 'REMOVE_ITEM', id: pick(items) }),
    () => ({ type: 'LOG_ITEM_EXPENSE', id: pick(items), paidBy: pick(ids), among: ids.filter(() => r() > 0.4) }),
    () => ({ type: 'ADD_EXPENSE', label: 'Spend', amount: Math.floor(r() * 500000) + 1, paidBy: pick(ids), among: ids.filter(() => r() > 0.5) }),
    () => ({ type: 'REMOVE_EXPENSE', id: pick(exps) }),
    () => ({ type: 'RECORD_PAYMENT', from: pick(ids), to: pick(ids), amount: Math.floor(r() * 300000) + 1 }),
    () => { const t = M.settlements(s)[0]; return t ? { type: 'RECORD_PAYMENT', ...t } : { type: 'NUDGE' }; },
    () => ({ type: 'REVISE_PACT', need: 2 + Math.floor(r() * 6), deadline: M.addHoursISO(s.clock, 48) }),
    () => ({ type: 'START_TRIP' }), () => ({ type: 'END_TRIP' }), () => ({ type: 'CALL_OFF' }), () => ({ type: 'CLOSE' }),
    () => ({ type: 'CANCEL' }), () => ({ type: 'NUDGE' })
  ];
  return pick(ev)();
}

test('random walks keep every invariant (2,000 events)', () => {
  const r = rng(42); let accepted = 0; const phases = new Set();
  for (let walk = 0; walk < 40; walk++) {
    let s = Object.values(PRESETS)[walk % 6].build();
    for (let i = 0; i < 50; i++) {
      const ev = randomEvent(s, r);
      const res = M.dispatch(s, ev);
      if (res.error) { assert.equal(res.state, s); continue; }
      accepted++;
      const v = M.checkInvariants(res.state);
      assert.deepEqual(v, [], `after ${JSON.stringify(ev)} in walk ${walk}`);
      s = res.state; phases.add(s.phase);
    }
  }
  assert.ok(accepted > 300, `only ${accepted} events accepted`);
  assert.ok(phases.size >= 6, 'walks should visit most phases: ' + [...phases]);
});
