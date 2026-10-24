// Demo scenarios. Each is built by replaying events through the reducer,
// so every preset is a state the real app can reach.
import { blankState, run, rupees, addHoursISO, dispatch, committed } from './model.js';

export const FRIENDS = ['Rohan', 'Priya', 'Arjun', 'Meera', 'Kabir', 'Sana', 'Dev'];
const T0 = '2026-10-19T10:00:00+05:30';            // Mon 19 Oct, 10 am IST
export const DEADLINE = '2026-10-21T18:00:00+05:30'; // Wed 21 Oct, 6 pm: 22 days before check-in

function draft() {
  return run(blankState(T0), [
    ...FRIENDS.map(name => ({ type: 'ADD_PERSON', name })),
    { type: 'ADD_DATE_OPTION', start: '2026-11-13', nights: 3 },
    { type: 'ADD_DATE_OPTION', start: '2026-11-20', nights: 2 },
    { type: 'ADD_DATE_OPTION', start: '2026-11-27', nights: 3 }
  ]);
}

const AVAIL = { // person -> [d1, d2, d3]
  p1: [1, 1, 0], p2: [1, 0, 1], p3: [1, 1, 1], p4: [1, 0, 0], p5: [1, 1, 0], p6: [0, 1, 1], p7: [1, 1, 1], p8: [1, 0, 1]
};
const BUDGETS = { p1: 12000, p2: 11000, p3: 15000, p5: 9500, p6: 12000, p8: 10000 };

function aligning() {
  let s = run(draft(), [{ type: 'INVITE' }]);
  const opts = s.dates.options.map(o => o.id);
  const ev = [];
  for (const [pid, arr] of Object.entries(AVAIL)) arr.forEach((v, i) => ev.push({ type: 'SET_AVAIL', id: pid, option: opts[i], value: !!v }));
  for (const [pid, r] of Object.entries(BUDGETS)) ev.push({ type: 'SET_BUDGET', id: pid, value: rupees(r) });
  return run(s, ev);
}

function pactOpen() {
  const s = aligning();
  return run(s, [
    { type: 'CHOOSE_DATES', option: s.dates.options[0].id },
    { type: 'OPEN_PACT', need: 6, deadline: DEADLINE, rule: 'keep' },
    { type: 'SET_CLOCK', clock: addHoursISO(T0, 5) },
    { type: 'RESPOND', id: 'p3', answer: 'in' },
    { type: 'RESPOND', id: 'p4', answer: 'in' },
    { type: 'RESPOND', id: 'p5', answer: 'out' },
    { type: 'SET_CLOCK', clock: addHoursISO(T0, 26) },
    { type: 'RESPOND', id: 'p6', answer: 'in' }
  ]);
}

function booked() {
  let s = pactOpen();
  s = run(s, [
    { type: 'RESPOND', id: 'p2', answer: 'in' },
    { type: 'RESPOND', id: 'p8', answer: 'in' },
    { type: 'SET_CLOCK', clock: addHoursISO(T0, 30) },
    { type: 'CONFIRM_BOOKING', provider: 'Villa host (direct)', reference: 'HMX4K2T9Q', amountPaid: rupees(12000), paidBy: 'p1', cancelBy: '2026-10-30' },
    { type: 'RECORD_PAYMENT', from: 'p3', to: 'p1', amount: rupees(2000), ref: 'UPI 4471' },
    { type: 'RECORD_PAYMENT', from: 'p6', to: 'p1', amount: rupees(2000), ref: '' },
    { type: 'ADD_ITEM', day: 1, start: '07:00', end: '13:00', title: 'Bus Bengaluru → Madikeri', place: 'Madikeri KSRTC bus stand', costPP: 0 },
    { type: 'ADD_ITEM', day: 1, start: '16:30', end: '18:30', title: 'Raja’s Seat at sunset', place: 'Raja’s Seat, Madikeri', costPP: 0 },
    { type: 'ADD_ITEM', day: 2, start: '08:00', end: '12:00', title: 'Coffee estate walk', place: 'Coffee plantation tour, Coorg', costPP: rupees(600) },
    { type: 'ADD_ITEM', day: 2, start: '14:00', end: '17:00', title: 'Abbey Falls', place: 'Abbey Falls, Madikeri', costPP: rupees(50) },
    { type: 'ADD_ITEM', day: 3, start: '09:00', end: '15:00', title: 'Dubare elephant camp + rafting', place: 'Dubare Elephant Camp', costPP: rupees(1200) }
  ]);
  return s;
}

function onTrip() {
  let s = booked();
  s = run(s, [
    { type: 'RECORD_PAYMENT', from: 'p4', to: 'p1', amount: rupees(2000), ref: '' },
    { type: 'SET_CLOCK', clock: '2026-11-14T09:00:00+05:30' },
    { type: 'START_TRIP' },
    { type: 'ADD_EXPENSE', label: 'Villa balance at check-in', amount: rupees(24000), paidBy: 'p3', among: committed(s).map(p => p.id), source: 'stay-balance' },
    { type: 'ADD_EXPENSE', label: 'Dinner at Coorg Cuisine', amount: rupees(4200), paidBy: 'p6', among: ['p1', 'p2', 'p3', 'p4', 'p6', 'p8'] },
    { type: 'LOG_ITEM_EXPENSE', id: s.items.find(i => i.title === 'Coffee estate walk').id, paidBy: 'p8', among: ['p1', 'p2', 'p3', 'p6', 'p8'] }
  ]);
  return s;
}

function settling() {
  let s = onTrip();
  s = run(s, [
    { type: 'SET_CLOCK', clock: '2026-11-16T20:00:00+05:30' },
    { type: 'END_TRIP' }
  ]);
  return s;
}

export const PRESETS = {
  draft: { label: 'Fresh idea', note: 'Organiser has the group and three date options', build: draft },
  aligning: { label: 'Dates & budgets', note: 'Friends marked dates and private budgets', build: aligning },
  pact: { label: 'Pact open', note: '4 of 6 committed, deadline Wed 6 pm', build: pactOpen },
  booked: { label: 'Booked', note: 'Villa booked, shares coming in, plan sketched', build: booked },
  trip: { label: 'On the trip', note: 'Day 2 in Coorg with costs logged', build: onTrip },
  settle: { label: 'Settling up', note: 'Back home, balances open', build: settling }
};
export const DEFAULT_PRESET = 'pact';

// Scripted replies for the "next friend replies" demo control.
export function nextScriptedReply(s) {
  const order = [['p2', 'in'], ['p8', 'in'], ['p7', 'out'], ['p5', 'in']];
  for (const [id, answer] of order) {
    const p = s.people.find(x => x.id === id);
    if (p && p.status === 'invited') return { type: 'RESPOND', id, answer };
  }
  return null;
}
export { dispatch };
