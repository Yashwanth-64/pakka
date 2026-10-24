// Pakka trip model: one source of truth, a guarded phase graph, derived numbers.
// Pure functions only. Money is integer paise. No DOM access in this file.

export const SCHEMA = 2;

export const PHASES = ['draft', 'aligning', 'committing', 'failed', 'ready_to_book', 'booked', 'on_trip', 'settling', 'closed', 'cancelled'];
export const TERMINAL = ['closed', 'cancelled'];

export const PHASE_LABEL = {
  draft: 'Draft', aligning: 'Aligning', committing: 'Pact open', failed: 'Pact missed',
  ready_to_book: 'Ready to book', booked: 'Booked', on_trip: 'On the trip',
  settling: 'Settling up', closed: 'Closed', cancelled: 'Called off'
};

export const RULES = {
  keep: 'Free to drop until the advance is paid. After that, you still owe your share unless someone takes your spot.',
  absorb: 'Free to drop until the advance is paid. After that, the people still going split your share.'
};

// ---------- money ----------
export const rupees = n => Math.round(n * 100);           // ₹ → paise
export const toRupees = p => p / 100;
export function fmt(p) {
  const r = Math.round(p / 100);
  const s = Math.abs(r).toLocaleString('en-IN');
  return (r < 0 ? '−₹' : '₹') + s;
}
// Split `amount` paise across ids exactly; remainder paise go to the first ids in list order.
export function splitExact(amount, ids) {
  if (!ids.length) return {};
  const base = Math.floor(amount / ids.length);
  let rem = amount - base * ids.length;
  const out = {};
  for (const id of ids) { out[id] = base + (rem > 0 ? 1 : 0); if (rem > 0) rem--; }
  return out;
}

// ---------- dates (calendar dates as YYYY-MM-DD, instants as ISO with offset) ----------
const DAY = 86400000;
export function addDays(ymd, n) {
  const d = new Date(ymd + 'T00:00:00Z');
  return new Date(d.getTime() + n * DAY).toISOString().slice(0, 10);
}
export function ymdInIST(iso) {
  return new Date(Date.parse(iso) + 330 * 60000).toISOString().slice(0, 10);
}
export function fmtDay(ymd) {
  const d = new Date(ymd + 'T00:00:00Z');
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}
export function fmtWhen(iso) {
  const d = new Date(Date.parse(iso) + 330 * 60000);
  const day = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  let h = d.getUTCHours(); const m = d.getUTCMinutes();
  const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12;
  return `${day}, ${h}${m ? ':' + String(m).padStart(2, '0') : ''} ${ap}`;
}
export function addHoursISO(iso, h) {
  const t = Date.parse(iso) + h * 3600000;
  const d = new Date(t + 330 * 60000).toISOString().slice(0, 19);
  return d + '+05:30';
}
const timeToMin = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };

// ---------- selectors ----------
export const person = (s, id) => s.people.find(p => p.id === id);
export const organiser = s => s.people.find(p => p.organiser);
export const active = s => s.people.filter(p => p.status !== 'withdrawn' && p.status !== 'replaced');
export const committed = s => s.people.filter(p => p.status === 'in');
export const pending = s => s.people.filter(p => p.status === 'invited');
export const chosenDates = s => s.dates.options.find(o => o.id === s.dates.chosenId) || null;

export function tripRange(s) {
  const o = chosenDates(s);
  if (!o) return null;
  return { start: o.start, nights: o.nights, end: addDays(o.start, o.nights), days: o.nights + 1 };
}

export function dateTally(s) {
  return s.dates.options.map(o => ({
    ...o,
    yes: s.people.filter(p => p.status !== 'withdrawn' && p.status !== 'replaced' && p.avail[o.id] === true).map(p => p.id),
    no: s.people.filter(p => p.status !== 'withdrawn' && p.status !== 'replaced' && p.avail[o.id] === false).map(p => p.id)
  }));
}

// Per-person all-in forecast for n people going.
export function costPerPerson(s, n) {
  if (!n || n < 1) return null;
  const r = tripRange(s) || { nights: s.dates.options[0]?.nights || 2, days: (s.dates.options[0]?.nights || 2) + 1 };
  const items = s.items.reduce((a, it) => a + (it.costPP || 0), 0);
  return Math.round(s.costs.stayTotal / n) + s.costs.transportPP + s.costs.foodPPPerDay * r.days + items;
}

export function forecast(s) {
  const going = committed(s).length;
  const possible = going + pending(s).length;
  const need = s.pact?.need || Math.min(6, s.people.length);
  return {
    going, possible, need,
    atNeed: costPerPerson(s, need),
    atAll: costPerPerson(s, Math.max(possible, 1)),
    now: going ? costPerPerson(s, going) : null
  };
}

// How many privately shared budgets the forecast at the pact line fits. Never reveals whose.
export function budgetFit(s) {
  const target = costPerPerson(s, s.pact?.need || Math.min(6, s.people.length));
  const shared = active(s).filter(p => p.budgetMax != null);
  return { target, shared: shared.length, fits: shared.filter(p => p.budgetMax >= target).length, of: active(s).length };
}

export function viability(s) {
  if (!s.pact) return null;
  const c = committed(s).length, p = pending(s).length;
  return { committed: c, pending: p, need: s.pact.need, met: c >= s.pact.need, reachable: c + p >= s.pact.need, short: Math.max(0, s.pact.need - c) };
}

// Typical Indian villa terms refund fully only 14+ days before check-in (research report),
// so a pact that closes later than that leaves dropouts expensive for everyone.
export const SAFE_BUFFER_DAYS = 17; // 14-day full-refund window + ~3 days to collect shares
export function deadlineBuffer(s, deadline = s.pact?.deadline) {
  const r = tripRange(s); if (!r || !deadline) return null;
  const days = Math.floor((Date.parse(r.start + 'T12:00:00+05:30') - Date.parse(deadline)) / DAY);
  return { days, risky: days < SAFE_BUFFER_DAYS };
}
export const isoAt = (ymd, hhmm) => `${ymd}T${hhmm}:00+05:30`;
export function daysUntil(s, ymd) {
  return Math.round((Date.parse(ymd + 'T00:00:00+05:30') - Date.parse(ymdInIST(s.clock) + 'T00:00:00+05:30')) / DAY);
}

// Ledger
export function expenseShares(e) {
  return splitExact(e.amount, e.among);
}
export function balances(s) {
  const b = {}; for (const p of s.people) b[p.id] = 0;
  for (const e of s.expenses) {
    b[e.paidBy] += e.amount;
    const sh = expenseShares(e);
    for (const id in sh) b[id] -= sh[id];
  }
  for (const pay of s.payments) { b[pay.from] += pay.amount; b[pay.to] -= pay.amount; }
  return b;
}
// Greedy minimal transfers; deterministic order (largest first, then id).
export function settlements(s) {
  const b = balances(s);
  const debt = Object.entries(b).filter(([, v]) => v < 0).map(([id, v]) => ({ id, v: -v })).sort((a, z) => z.v - a.v || a.id.localeCompare(z.id));
  const cred = Object.entries(b).filter(([, v]) => v > 0).map(([id, v]) => ({ id, v })).sort((a, z) => z.v - a.v || a.id.localeCompare(z.id));
  const out = []; let i = 0, j = 0;
  while (i < debt.length && j < cred.length) {
    const x = Math.min(debt[i].v, cred[j].v);
    if (x > 0) out.push({ from: debt[i].id, to: cred[j].id, amount: x });
    debt[i].v -= x; cred[j].v -= x;
    if (debt[i].v === 0) i++;
    if (cred[j].v === 0) j++;
  }
  return out;
}
export const allSettled = s => Object.values(balances(s)).every(v => v === 0);

export function spentPerPerson(s) {
  const t = {}; for (const p of s.people) t[p.id] = 0;
  for (const e of s.expenses) { const sh = expenseShares(e); for (const id in sh) t[id] += sh[id]; }
  return t;
}

// Itinerary checks
export function itemFlags(s) {
  const r = tripRange(s);
  const flags = {};
  for (const it of s.items) flags[it.id] = [];
  if (r) for (const it of s.items) if (it.day > r.days) flags[it.id].push('outside');
  const byDay = {};
  for (const it of s.items) (byDay[it.day] ||= []).push(it);
  for (const day in byDay) {
    const list = byDay[day];
    for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
      const A = list[a], B = list[b];
      if (timeToMin(A.start) < timeToMin(B.end) && timeToMin(B.start) < timeToMin(A.end)) {
        flags[A.id].push('clash:' + B.id); flags[B.id].push('clash:' + A.id);
      }
    }
  }
  return flags;
}
export function tripDayToday(s) {
  const r = tripRange(s); if (!r) return null;
  const today = ymdInIST(s.clock);
  const n = Math.round((Date.parse(today) - Date.parse(r.start)) / DAY) + 1;
  return n >= 1 && n <= r.days ? n : null;
}

// ---------- the graph ----------
// Edges carry the guard that must hold; `auto` edges fire on their own after any event.
export const EDGES = [
  { from: 'draft', to: 'aligning', on: 'INVITE', guard: s => s.people.length >= 3 && s.dates.options.length >= 1 && s.costs.stayTotal > 0, why: 'Add at least 2 friends, one date option and a stay cost.' },
  { from: 'aligning', to: 'committing', on: 'OPEN_PACT', guard: (s, e) => !!s.dates.chosenId && e.need >= 2 && e.need <= active(s).length && Date.parse(e.deadline) > Date.parse(s.clock) && !!RULES[e.rule], why: 'Choose dates first; the line must be between 2 and the group size and the deadline in the future.' },
  { from: 'committing', to: 'ready_to_book', on: 'auto', guard: s => committed(s).length >= s.pact.need && Date.parse(s.clock) <= Date.parse(s.pact.deadline), why: 'Reached the line before the deadline.' },
  { from: 'committing', to: 'failed', on: 'auto', guard: s => Date.parse(s.clock) > Date.parse(s.pact.deadline) && committed(s).length < s.pact.need, why: 'Deadline passed below the line.' },
  { from: 'ready_to_book', to: 'committing', on: 'auto', guard: s => committed(s).length < s.pact.need && Date.parse(s.clock) <= Date.parse(s.pact.deadline), why: 'Someone pulled out before booking; back under the line.' },
  { from: 'ready_to_book', to: 'failed', on: 'auto', guard: s => committed(s).length < s.pact.need && Date.parse(s.clock) > Date.parse(s.pact.deadline), why: 'Under the line after the deadline, before booking.' },
  { from: 'failed', to: 'committing', on: 'REVISE_PACT', guard: (s, e) => e.need >= 2 && e.need <= active(s).length && Date.parse(e.deadline) > Date.parse(s.clock), why: 'New line must fit the group and the new deadline must be in the future.' },
  { from: 'ready_to_book', to: 'booked', on: 'CONFIRM_BOOKING', guard: (s, e) => !!(e.reference && e.reference.trim()) && e.amountPaid > 0 && !!person(s, e.paidBy) && /^\d{4}-\d{2}-\d{2}$/.test(e.cancelBy || ''), why: 'Enter the booking reference, the amount actually paid, who paid and the cancel-by date.' },
  { from: 'booked', to: 'on_trip', on: 'START_TRIP', guard: s => s.booking?.status === 'confirmed' && committed(s).length >= 1, why: 'Re-confirm the booking with the host first.' },
  { from: 'booked', to: 'settling', on: 'CALL_OFF', guard: () => true, why: 'Trip called off after money moved; settle what was spent.' },
  { from: 'on_trip', to: 'settling', on: 'END_TRIP', guard: () => true },
  { from: 'settling', to: 'closed', on: 'CLOSE', guard: s => allSettled(s), why: 'Everyone has to be settled before closing.' },
  { from: 'draft', to: 'cancelled', on: 'CANCEL', guard: () => true },
  { from: 'aligning', to: 'cancelled', on: 'CANCEL', guard: () => true },
  { from: 'committing', to: 'cancelled', on: 'CANCEL', guard: () => true },
  { from: 'failed', to: 'cancelled', on: 'CANCEL', guard: () => true },
  { from: 'ready_to_book', to: 'cancelled', on: 'CANCEL', guard: () => true }
];

// Which events are allowed in which phases (non-transition events).
const ALLOWED = {
  SET_TRIP: ['draft', 'aligning'],
  SET_COSTS: ['draft', 'aligning', 'committing', 'failed', 'ready_to_book', 'booked'],
  ADD_PERSON: ['draft', 'aligning', 'committing', 'failed', 'ready_to_book'],
  ADD_DATE_OPTION: ['draft', 'aligning'],
  SET_AVAIL: ['aligning'],
  SET_BUDGET: ['aligning', 'committing', 'failed', 'ready_to_book'],
  CHOOSE_DATES: ['aligning', 'booked'],
  RESPOND: ['committing', 'ready_to_book'],
  WITHDRAW: ['committing', 'ready_to_book', 'booked', 'on_trip'],
  REPLACE: ['booked', 'on_trip'],
  NUDGE: ['committing'],
  RECHECK_BOOKING: ['booked'],
  ADD_ITEM: ['ready_to_book', 'booked', 'on_trip'],
  REMOVE_ITEM: ['ready_to_book', 'booked', 'on_trip'],
  LOG_ITEM_EXPENSE: ['on_trip'],
  ADD_EXPENSE: ['booked', 'on_trip', 'settling'],
  REMOVE_EXPENSE: ['booked', 'on_trip', 'settling'],
  RECORD_PAYMENT: ['booked', 'on_trip', 'settling'],
  SET_ALBUM: ['on_trip', 'settling', 'closed'],
  RATE: ['settling', 'closed'],
  SET_CLOCK: PHASES,
  SET_VIEWER: PHASES
};

export function edgesFrom(phase) { return EDGES.filter(e => e.from === phase); }
export function eventAllowed(s, type) {
  if (ALLOWED[type]) return ALLOWED[type].includes(s.phase);
  return EDGES.some(e => e.from === s.phase && e.on === type);
}
export function blockedReason(s, type, e = {}) {
  const edge = EDGES.find(x => x.from === s.phase && x.on === type);
  if (edge) return edge.guard(s, e) ? null : (edge.why || 'Not allowed yet.');
  if (ALLOWED[type] && !ALLOWED[type].includes(s.phase)) return `Not available while the trip is "${PHASE_LABEL[s.phase]}".`;
  return null;
}

// ---------- initial state ----------
export function blankState(clock = '2026-10-26T10:00:00+05:30') {
  return {
    schema: SCHEMA, seq: { p: 1 }, clock, viewer: 'p1', phase: 'draft',
    trip: { name: 'Coorg long weekend', destination: 'Coorg, Karnataka', occasion: 'Long weekend' },
    people: [{ id: 'p1', name: 'Yash', organiser: true, status: 'in', budgetMax: null, avail: {} }],
    dates: { options: [], chosenId: null },
    costs: { stayTotal: rupees(36000), advance: rupees(12000), transportPP: rupees(1100), foodPPPerDay: rupees(900) },
    pact: null, booking: null, items: [], expenses: [], payments: [],
    album: '', pulse: {}, log: []
  };
}

// ---------- reducer ----------
const nextId = (s, prefix) => { s.seq[prefix] = (s.seq[prefix] || 0) + 1; return prefix + s.seq[prefix]; };
const clone = x => JSON.parse(JSON.stringify(x));
const name = (s, id) => person(s, id)?.name || 'Someone';

function fail(state, msg) { return { state, error: msg, effects: [] }; }

export function dispatch(state, ev) {
  if (!ev || !ev.type) return fail(state, 'Unknown action.');
  if (TERMINAL.includes(state.phase) && !['SET_CLOCK', 'SET_VIEWER', 'RATE', 'SET_ALBUM'].includes(ev.type)) return fail(state, 'This trip is finished. Start a new one to plan again.');
  if (!eventAllowed(state, ev.type)) return fail(state, blockedReason(state, ev.type, ev) || `"${ev.type}" isn't possible right now.`);
  const edge = EDGES.find(x => x.from === state.phase && x.on === ev.type);
  if (edge && !edge.guard(state, ev)) return fail(state, edge.why || 'Not allowed yet.');

  const s = clone(state);
  const fx = [];              // human-readable downstream effects
  let summary = '';
  const before = { going: committed(state).length, pp: forecast(state).now, bal: balances(state) };

  switch (ev.type) {
    case 'SET_VIEWER': {
      if (!person(s, ev.id)) return fail(state, 'No such person.');
      s.viewer = ev.id; return { state: s, error: null, effects: [] };
    }
    case 'SET_CLOCK': {
      if (!(Date.parse(ev.clock) > 0)) return fail(state, 'Invalid time.');
      s.clock = ev.clock; summary = `Time moved to ${fmtWhen(ev.clock)}`; break;
    }
    case 'SET_TRIP': {
      const nm = (ev.name || '').trim(), dest = (ev.destination || '').trim();
      if (!nm || !dest) return fail(state, 'Give the trip a name and a destination.');
      s.trip.name = nm.slice(0, 60); s.trip.destination = dest.slice(0, 60);
      summary = 'Trip details updated'; break;
    }
    case 'SET_COSTS': {
      const c = { ...s.costs, ...ev.costs };
      for (const k of ['stayTotal', 'advance', 'transportPP', 'foodPPPerDay']) {
        if (!Number.isInteger(c[k]) || c[k] < 0) return fail(state, 'Costs must be whole amounts of zero or more.');
      }
      if (c.stayTotal <= 0) return fail(state, 'Enter what the stay costs.');
      if (c.advance > c.stayTotal) return fail(state, 'The advance can’t be more than the stay total.');
      if (s.booking && c.advance !== s.costs.advance) return fail(state, 'The advance is already paid. Change the stay total instead.');
      const oldStay = s.costs.stayTotal;
      s.costs = c;
      summary = 'Costs updated';
      if (c.stayTotal !== oldStay) fx.push(`Stay total ${fmt(oldStay)} → ${fmt(c.stayTotal)}`);
      if (s.booking && c.stayTotal !== oldStay) fx.push(`Balance due at check-in is now ${fmt(c.stayTotal - c.advance)}`);
      break;
    }
    case 'ADD_PERSON': {
      const nm = (ev.name || '').trim();
      if (!nm) return fail(state, 'Enter a name.');
      if (s.people.some(p => p.name.toLowerCase() === nm.toLowerCase() && p.status !== 'replaced')) return fail(state, `${nm} is already in the group.`);
      if (active(s).length >= 12) return fail(state, 'Pakka is built for groups of up to 12.');
      const id = nextId(s, 'p');
      s.people.push({ id, name: nm.slice(0, 24), organiser: false, status: 'invited', budgetMax: null, avail: {} });
      summary = `${nm} added to the group`; break;
    }
    case 'ADD_DATE_OPTION': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ev.start || '')) return fail(state, 'Pick a start date.');
      const nights = Number(ev.nights);
      if (!Number.isInteger(nights) || nights < 1 || nights > 7) return fail(state, 'Nights must be between 1 and 7.');
      if (ev.start < ymdInIST(s.clock)) return fail(state, 'That date has already passed.');
      if (s.dates.options.some(o => o.start === ev.start && o.nights === nights)) return fail(state, 'That option is already there.');
      const id = nextId(s, 'd');
      s.dates.options.push({ id, start: ev.start, nights });
      s.dates.options.sort((a, b) => a.start.localeCompare(b.start));
      summary = `Date option added: ${fmtDay(ev.start)}, ${nights} night${nights > 1 ? 's' : ''}`; break;
    }
    case 'INVITE': {
      for (const p of s.people) if (!p.organiser && p.status !== 'invited') p.status = 'invited';
      summary = 'Invite link shared with the group';
      fx.push(`${s.people.length - 1} friends can now mark dates and a private budget`); break;
    }
    case 'SET_AVAIL': {
      const p = person(s, ev.id), o = s.dates.options.find(x => x.id === ev.option);
      if (!p || !o) return fail(state, 'Unknown person or date option.');
      p.avail[o.id] = !!ev.value;
      summary = `${p.name} ${ev.value ? 'can' : 'can’t'} make ${fmtDay(o.start)}`; break;
    }
    case 'SET_BUDGET': {
      const p = person(s, ev.id); if (!p) return fail(state, 'Unknown person.');
      if (ev.value != null && (!Number.isInteger(ev.value) || ev.value < rupees(500))) return fail(state, 'Enter a budget of at least ₹500, or leave it blank.');
      p.budgetMax = ev.value ?? null;
      summary = `${p.name} ${ev.value == null ? 'cleared' : 'set'} a private budget`;
      const f = budgetFit(s); fx.push(`Forecast ${fmt(f.target)} fits ${f.fits} of ${f.shared} budgets shared`); break;
    }
    case 'CHOOSE_DATES': {
      const o = s.dates.options.find(x => x.id === ev.option); if (!o) return fail(state, 'Unknown date option.');
      if (o.id === s.dates.chosenId) return fail(state, 'Those dates are already chosen.');
      const prev = chosenDates(s);
      s.dates.chosenId = o.id;
      summary = `Dates set: ${fmtDay(o.start)} → ${fmtDay(addDays(o.start, o.nights))}`;
      if (prev) fx.push(`Changed from ${fmtDay(prev.start)}, ${prev.nights} nights`);
      if (s.booking) {
        s.booking.status = 'needs_recheck';
        s.booking.note = `Dates changed from ${fmtDay(prev.start)} to ${fmtDay(o.start)}. Confirm the new dates with the host before the trip.`;
        fx.push('Booking flagged: re-confirm with the host');
      }
      const out = s.items.filter(it => it.day > o.nights + 1);
      if (out.length) fx.push(`${out.length} plan item${out.length > 1 ? 's fall' : ' falls'} outside the new dates`);
      if (prev && prev.nights !== o.nights) fx.push(`Per-person forecast now ${fmt(costPerPerson(s, committed(s).length || 1))}`);
      break;
    }
    case 'OPEN_PACT': {
      s.pact = { need: ev.need, deadline: ev.deadline, rule: ev.rule, openedAt: s.clock };
      s.phase = 'committing';
      summary = `Pact opened: needs ${ev.need} by ${fmtWhen(ev.deadline)}`;
      fx.push(`Each share ${fmt(costPerPerson(s, active(s).length))}–${fmt(costPerPerson(s, ev.need))} depending on headcount`); break;
    }
    case 'REVISE_PACT': {
      s.pact.need = ev.need; s.pact.deadline = ev.deadline; s.phase = 'committing';
      summary = `Pact revised: needs ${ev.need} by ${fmtWhen(ev.deadline)}`;
      fx.push('Only people who haven’t said no are asked again'); break;
    }
    case 'RESPOND': {
      const p = person(s, ev.id); if (!p) return fail(state, 'Unknown person.');
      if (p.organiser) return fail(state, 'The organiser is already in.');
      if (!['invited', 'in', 'out'].includes(p.status)) return fail(state, `${p.name} has already left the trip.`);
      if (!['in', 'out'].includes(ev.answer)) return fail(state, 'Answer in or out.');
      if (p.status === ev.answer) return fail(state, `${p.name} already said ${ev.answer === 'in' ? 'yes' : 'no'}.`);
      if (Date.parse(s.clock) > Date.parse(s.pact.deadline) && s.phase === 'committing') return fail(state, 'The deadline has passed.');
      p.status = ev.answer;
      summary = ev.answer === 'in' ? `${p.name} committed` : `${p.name} can’t make it`; break;
    }
    case 'WITHDRAW': {
      const p = person(s, ev.id); if (!p) return fail(state, 'Unknown person.');
      if (p.organiser) return fail(state, 'The organiser can’t withdraw. Call the trip off instead.');
      if (p.status !== 'in') return fail(state, `${p.name} hasn’t committed, so there’s nothing to withdraw.`);
      p.status = 'withdrawn';
      summary = `${p.name} pulled out`;
      const adv = s.expenses.find(e => e.source === 'advance');
      if (adv) {
        if (s.pact.rule === 'absorb') {
          adv.among = adv.among.filter(id => id !== p.id);
          fx.push(`By the agreed rule, ${p.name}'s share of the advance moves to the ${adv.among.length} still going (now ${fmt(Math.ceil(adv.amount / adv.among.length))} each)`);
        } else {
          fx.push(`By the agreed rule, ${p.name} still owes ${fmt(expenseShares(adv)[p.id] || 0)} of the advance unless someone takes the spot`);
        }
      } else fx.push('No money had moved, so there is nothing to settle');
      break;
    }
    case 'REPLACE': {
      const old = person(s, ev.id); const nm = (ev.name || '').trim();
      if (!old || old.status !== 'withdrawn') return fail(state, 'Only someone who pulled out can be replaced.');
      if (!nm) return fail(state, 'Enter the new person’s name.');
      if (s.people.some(p => p.name.toLowerCase() === nm.toLowerCase() && p.status !== 'replaced')) return fail(state, `${nm} is already in the group.`);
      const id = nextId(s, 'p');
      s.people.push({ id, name: nm.slice(0, 24), organiser: false, status: 'in', budgetMax: null, avail: {} });
      old.status = 'replaced'; old.replacedBy = id;
      for (const e of s.expenses) if (e.source === 'advance' && e.among.includes(old.id)) e.among = e.among.map(x => x === old.id ? id : x);
      summary = `${nm} takes ${old.name}'s spot`;
      fx.push(`${old.name}'s share of the advance moves to ${nm}`); break;
    }
    case 'NUDGE': {
      summary = `Pakka reminded ${pending(s).length} people who haven’t answered`; break;
    }
    case 'CONFIRM_BOOKING': {
      const r = tripRange(s);
      s.booking = {
        status: 'confirmed', provider: (ev.provider || 'Direct with host').trim().slice(0, 40), reference: ev.reference.trim().slice(0, 40),
        amountPaid: ev.amountPaid, paidBy: ev.paidBy, cancelBy: ev.cancelBy, confirmedAt: s.clock,
        forStart: r.start, forNights: r.nights, note: ''
      };
      const among = committed(s).map(p => p.id);
      s.expenses.push({ id: nextId(s, 'e'), label: `Stay advance · ${s.booking.provider}`, amount: ev.amountPaid, paidBy: ev.paidBy, among, at: s.clock, source: 'advance' });
      s.phase = 'booked';
      summary = `${name(s, ev.paidBy)} confirmed the booking (${s.booking.reference})`;
      fx.push(`Advance ${fmt(ev.amountPaid)} split across ${among.length}: ${fmt(Math.ceil(ev.amountPaid / among.length))} each`);
      fx.push(`Balance due at check-in: ${fmt(s.costs.stayTotal - ev.amountPaid)}`);
      if (ev.amountPaid !== s.costs.advance) { s.costs.advance = ev.amountPaid; fx.push('Planned advance updated to the amount actually paid'); }
      break;
    }
    case 'RECHECK_BOOKING': {
      if (s.booking.status !== 'needs_recheck') return fail(state, 'The booking doesn’t need re-checking.');
      const ref = (ev.reference || s.booking.reference).trim();
      if (!ref) return fail(state, 'Enter the booking reference the host confirmed.');
      const r = tripRange(s);
      s.booking.status = 'confirmed'; s.booking.reference = ref.slice(0, 40); s.booking.forStart = r.start; s.booking.forNights = r.nights; s.booking.note = '';
      summary = `Host re-confirmed the booking for ${fmtDay(r.start)}`; break;
    }
    case 'ADD_ITEM': {
      const r = tripRange(s); const title = (ev.title || '').trim();
      if (!title) return fail(state, 'Give the plan item a title.');
      if (!Number.isInteger(ev.day) || ev.day < 1 || ev.day > r.days) return fail(state, `Pick a day between 1 and ${r.days}.`);
      if (!/^\d{2}:\d{2}$/.test(ev.start || '') || !/^\d{2}:\d{2}$/.test(ev.end || '')) return fail(state, 'Enter start and end times.');
      if (timeToMin(ev.end) <= timeToMin(ev.start)) return fail(state, 'End time must be after the start time.');
      if (ev.costPP != null && (!Number.isInteger(ev.costPP) || ev.costPP < 0)) return fail(state, 'Cost per person must be zero or more.');
      const id = nextId(s, 'i');
      s.items.push({ id, day: ev.day, start: ev.start, end: ev.end, title: title.slice(0, 60), place: (ev.place || '').trim().slice(0, 80), costPP: ev.costPP || 0, expenseId: null });
      s.items.sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
      summary = `Added "${title}" on day ${ev.day}`;
      const clashes = itemFlags(s)[id].filter(f => f.startsWith('clash'));
      if (clashes.length) fx.push(`Overlaps with ${clashes.length} other item${clashes.length > 1 ? 's' : ''} on day ${ev.day}`);
      if (ev.costPP) fx.push(`Per-person forecast +${fmt(ev.costPP)}`);
      break;
    }
    case 'REMOVE_ITEM': {
      const it = s.items.find(x => x.id === ev.id); if (!it) return fail(state, 'That item is already gone.');
      if (it.expenseId) return fail(state, 'Its cost is already in the ledger. Remove that expense first.');
      s.items = s.items.filter(x => x.id !== ev.id);
      summary = `Removed "${it.title}"`; break;
    }
    case 'LOG_ITEM_EXPENSE': {
      const it = s.items.find(x => x.id === ev.id); if (!it) return fail(state, 'Unknown plan item.');
      if (it.expenseId) return fail(state, 'This one is already logged.');
      if (!it.costPP) return fail(state, 'This item has no cost to log.');
      const among = (ev.among || []).filter(id => person(s, id)?.status === 'in');
      if (!among.length) return fail(state, 'Pick who took part.');
      if (person(s, ev.paidBy)?.status !== 'in') return fail(state, 'Pick who paid.');
      const eid = nextId(s, 'e');
      s.expenses.push({ id: eid, label: it.title, amount: it.costPP * among.length, paidBy: ev.paidBy, among, at: s.clock, source: 'item:' + it.id });
      it.expenseId = eid;
      summary = `${name(s, ev.paidBy)} paid for "${it.title}"`;
      fx.push(`${fmt(it.costPP * among.length)} split across the ${among.length} who went`); break;
    }
    case 'ADD_EXPENSE': {
      const label = (ev.label || '').trim();
      if (!label) return fail(state, 'Say what the expense was for.');
      if (!Number.isInteger(ev.amount) || ev.amount <= 0) return fail(state, 'Enter an amount above zero.');
      if (!person(s, ev.paidBy) || ['withdrawn', 'replaced'].includes(person(s, ev.paidBy).status) && !ev.allowFormer) return fail(state, 'Pick who paid.');
      const among = [...new Set(ev.among || [])].filter(id => person(s, id));
      if (!among.length) return fail(state, 'Pick at least one person to split with.');
      s.expenses.push({ id: nextId(s, 'e'), label: label.slice(0, 60), amount: ev.amount, paidBy: ev.paidBy, among, at: s.clock, source: ev.source || 'manual' });
      summary = `${name(s, ev.paidBy)} paid ${fmt(ev.amount)} for ${label}`;
      fx.push(`Split across ${among.length}: about ${fmt(Math.ceil(ev.amount / among.length))} each`); break;
    }
    case 'REMOVE_EXPENSE': {
      const e = s.expenses.find(x => x.id === ev.id); if (!e) return fail(state, 'That expense is already gone.');
      if (e.source === 'advance') return fail(state, 'The advance is tied to the booking and can’t be removed here.');
      s.expenses = s.expenses.filter(x => x.id !== ev.id);
      for (const it of s.items) if (it.expenseId === ev.id) it.expenseId = null;
      summary = `Removed expense "${e.label}"`; break;
    }
    case 'RECORD_PAYMENT': {
      if (!person(s, ev.from) || !person(s, ev.to) || ev.from === ev.to) return fail(state, 'Pick who paid whom.');
      if (!Number.isInteger(ev.amount) || ev.amount <= 0) return fail(state, 'Enter an amount above zero.');
      s.payments.push({ id: nextId(s, 'm'), from: ev.from, to: ev.to, amount: ev.amount, at: s.clock, ref: (ev.ref || '').trim().slice(0, 30) });
      summary = `${name(s, ev.from)} marked ${fmt(ev.amount)} paid to ${name(s, ev.to)}`;
      if (allSettled(s)) fx.push('Everyone is settled'); break;
    }
    case 'START_TRIP': { s.phase = 'on_trip'; summary = 'Trip started'; break; }
    case 'END_TRIP': { s.phase = 'settling'; summary = 'Trip ended; time to settle up'; fx.push(`${settlements(s).length} transfer${settlements(s).length === 1 ? '' : 's'} to settle everyone`); break; }
    case 'CALL_OFF': { s.phase = 'settling'; summary = 'Trip called off after booking'; fx.push('The advance stays split by the agreed rule; settle what was paid'); break; }
    case 'CLOSE': { s.phase = 'closed'; summary = 'Trip closed'; break; }
    case 'CANCEL': { s.phase = 'cancelled'; summary = 'Plan called off before any money moved'; break; }
    case 'SET_ALBUM': {
      const url = (ev.url || '').trim();
      if (url && !/^https:\/\/[^\s]+$/.test(url)) return fail(state, 'Paste a full https:// link.');
      s.album = url.slice(0, 300); summary = url ? 'Shared album linked' : 'Album link removed'; break;
    }
    case 'RATE': {
      if (!person(s, ev.id) || !(ev.score >= 1 && ev.score <= 5)) return fail(state, 'Rate from 1 to 5.');
      s.pulse[ev.id] = ev.score; summary = `${name(s, ev.id)} rated the trip`; break;
    }
    case 'INVITE_NOOP': break;
    default: return fail(state, `Unknown action "${ev.type}".`);
  }

  // the matched edge (if any) is the single place a requested transition happens
  if (edge) s.phase = edge.to;

  // auto transitions until stable
  for (let guard = 0; guard < 5; guard++) {
    const auto = EDGES.find(x => x.from === s.phase && x.on === 'auto' && x.guard(s));
    if (!auto) break;
    s.phase = auto.to;
    fx.push(auto.to === 'ready_to_book' ? `It's pakka: ${committed(s).length} committed. Booking unlocked`
      : auto.to === 'failed' ? `Deadline passed at ${committed(s).length} of ${s.pact.need}. Nobody owes anything`
      : auto.to === 'committing' ? `Back under the line (${committed(s).length} of ${s.pact.need}). Booking locked again` : auto.why);
  }

  // generic downstream effects
  const goingNow = committed(s).length;
  if (goingNow !== before.going && !['CONFIRM_BOOKING'].includes(ev.type)) {
    fx.push(`Going: ${before.going} → ${goingNow}`);
    if (goingNow) fx.push(`Per-person forecast ${before.pp ? fmt(before.pp) + ' → ' : ''}${fmt(costPerPerson(s, goingNow))}`);
    const v = viability(s);
    if (v && !v.met && !v.reachable && ['committing'].includes(s.phase)) fx.push(`Can’t reach ${v.need} with the people left. Lower the line or call it off`);
  }
  if (['WITHDRAW', 'REPLACE'].includes(ev.type)) {
    const after = balances(s);
    for (const id in after) if (after[id] !== (before.bal[id] ?? 0) && after[id] > 0 && (before.bal[id] ?? 0) <= 0) fx.push(`${name(s, id)} is now owed ${fmt(after[id])}`);
  }

  if (summary) s.log.unshift({ id: nextId(s, 'l'), at: s.clock, by: s.viewer, type: ev.type, summary, effects: fx });
  if (s.log.length > 60) s.log.length = 60;
  return { state: s, error: null, effects: fx };
}

// Apply many events; throws on the first error (used by presets and tests).
export function run(state, events) {
  let s = state;
  for (const e of events) {
    const r = dispatch(s, e);
    if (r.error) throw new Error(`${e.type}: ${r.error}`);
    s = r.state;
  }
  return s;
}

// ---------- invariants ----------
export function checkInvariants(s) {
  const v = [];
  if (s.schema !== SCHEMA) v.push('schema mismatch');
  if (!PHASES.includes(s.phase)) v.push('unknown phase ' + s.phase);
  const ids = s.people.map(p => p.id);
  if (new Set(ids).size !== ids.length) v.push('duplicate person ids');
  if (s.people.filter(p => p.organiser).length !== 1) v.push('exactly one organiser required');
  if (!s.people.every(p => ['invited', 'in', 'out', 'withdrawn', 'replaced'].includes(p.status))) v.push('invalid person status');
  const sum = Object.values(balances(s)).reduce((a, b) => a + b, 0);
  if (sum !== 0) v.push('balances do not sum to zero: ' + sum);
  for (const e of s.expenses) {
    if (!(e.amount > 0) || !Number.isInteger(e.amount)) v.push('bad expense amount ' + e.id);
    if (!e.among.length) v.push('expense with nobody to split ' + e.id);
    if (!person(s, e.paidBy)) v.push('expense payer missing ' + e.id);
    const t = Object.values(expenseShares(e)).reduce((a, b) => a + b, 0);
    if (t !== e.amount) v.push('expense shares do not add up ' + e.id);
  }
  for (const p of s.payments) if (!(p.amount > 0) || p.from === p.to) v.push('bad payment ' + p.id);
  const booked = ['booked', 'on_trip', 'settling', 'closed'];
  const adv = s.expenses.filter(e => e.source === 'advance');
  if (s.booking) {
    if (!s.booking.reference) v.push('booking without reference');
    if (adv.length !== 1 || adv[0].amount !== s.booking.amountPaid) v.push('advance expense does not match booking');
    if (!booked.includes(s.phase)) v.push('booking exists in phase ' + s.phase);
  } else {
    if (adv.length) v.push('advance expense without booking');
    if (['booked', 'on_trip'].includes(s.phase)) v.push('phase ' + s.phase + ' without booking');
  }
  if (s.phase === 'ready_to_book' && committed(s).length < s.pact.need) v.push('ready_to_book below the line');
  if (s.phase === 'failed' && !(Date.parse(s.clock) > Date.parse(s.pact.deadline))) v.push('failed before the deadline');
  if (['committing', 'failed', 'ready_to_book'].includes(s.phase) && !s.pact) v.push('pact phase without pact');
  if (s.phase === 'cancelled' && s.expenses.length) v.push('cancelled with money in the ledger');
  if (s.phase === 'closed' && !allSettled(s)) v.push('closed with open balances');
  if (s.phase === 'on_trip' && s.booking?.status !== 'confirmed') v.push('on trip without a confirmed booking');
  for (const it of s.items) if (it.expenseId && !s.expenses.some(e => e.id === it.expenseId)) v.push('item linked to missing expense ' + it.id);
  return v;
}

// ---------- next actions (role aware) ----------
export function nextActions(s, viewerId = s.viewer) {
  const me = person(s, viewerId); if (!me) return [];
  const org = me.organiser; const a = [];
  const v = viability(s);
  switch (s.phase) {
    case 'draft':
      if (org) a.push({ tab: 'align', text: s.people.length < 3 ? 'Add the friends you want on this trip' : s.dates.options.length ? 'Share the invite so friends can mark dates' : 'Add one or two date options' });
      break;
    case 'aligning':
      if (!Object.keys(me.avail).length) a.push({ tab: 'align', text: 'Mark which dates you can make' });
      if (me.budgetMax == null) a.push({ tab: 'align', text: 'Set your private budget (only you see the number)' });
      if (org) a.push({ tab: s.dates.chosenId ? 'commit' : 'align', text: s.dates.chosenId ? 'Open the pact: set the line and the deadline' : 'Pick the dates most people can make' });
      break;
    case 'committing':
      if (me.status === 'invited') a.push({ tab: 'commit', text: `Decide by ${fmtWhen(s.pact.deadline)}: in or out` });
      if (org) a.push({ tab: 'commit', text: v.reachable ? `${v.short} more to go. Pakka can remind the ${v.pending} who haven’t answered` : `Can’t reach ${v.need} now. Lower the line or call it off` });
      break;
    case 'failed':
      if (org) a.push({ tab: 'commit', text: 'The pact missed. Lower the line, give more time, or call it off' });
      else a.push({ tab: 'commit', text: 'The pact missed. Nobody owes anything' });
      break;
    case 'ready_to_book':
      if (org) a.push({ tab: 'book', text: 'Book the stay, then record the reference and what you paid' });
      else a.push({ tab: 'book', text: 'It’s pakka. Waiting for the booking to be confirmed' });
      if (me.status === 'invited') a.push({ tab: 'commit', text: 'There’s still room: say in or out' });
      break;
    case 'booked': {
      if (s.booking.status === 'needs_recheck' && org) a.push({ tab: 'book', text: 'Dates changed: re-confirm the booking with the host' });
      const owe = settlements(s).filter(t => t.from === me.id);
      for (const t of owe) a.push({ tab: 'money', text: `Pay ${name(s, t.to)} ${fmt(t.amount)} for your share` });
      if (org) {
        const unpaid = settlements(s).filter(t => t.to === me.id).length;
        if (unpaid) a.push({ tab: 'money', text: `${unpaid} share${unpaid > 1 ? 's' : ''} still to come in` });
        a.push({ tab: 'plan', text: s.items.length ? 'Plan is taking shape. Start the trip when you leave' : 'Sketch the plan for each day' });
      }
      break;
    }
    case 'on_trip': {
      const d = tripDayToday(s);
      a.push({ tab: 'plan', text: d ? `Day ${d}: see today’s plan` : 'See the plan' });
      a.push({ tab: 'money', text: 'Log costs as you go, split only among who joined' });
      break;
    }
    case 'settling': {
      const owe = settlements(s).filter(t => t.from === me.id);
      for (const t of owe) a.push({ tab: 'money', text: `Pay ${name(s, t.to)} ${fmt(t.amount)}` });
      if (!owe.length) a.push({ tab: 'money', text: allSettled(s) ? (org ? 'Everyone’s settled. Close the trip' : 'You’re settled') : 'Waiting on others to settle' });
      if (!s.pulse[me.id]) a.push({ tab: 'money', text: 'Rate the trip in one tap' });
      break;
    }
    case 'closed': a.push({ tab: 'money', text: org ? 'Plan the next one with this group' : 'Trip closed' }); break;
    case 'cancelled': a.push({ tab: 'home', text: 'This plan was called off' }); break;
  }
  return a;
}

// New trip seeded from a closed one: same people, fresh everything else.
export function planAgain(s) {
  const n = blankState(s.clock);
  n.trip = { name: 'Next trip', destination: s.trip.destination, occasion: s.trip.occasion };
  const keep = s.people.filter(p => !['withdrawn', 'replaced', 'out'].includes(p.status));
  n.people = keep.map(p => ({ id: p.id, name: p.name, organiser: p.organiser, status: p.organiser ? 'in' : 'invited', budgetMax: null, avail: {} }));
  n.seq = { ...s.seq }; n.viewer = organiser(s).id;
  n.costs = { ...s.costs, stayTotal: s.costs.stayTotal, advance: s.costs.advance };
  n.log = [{ id: nextId(n, 'l'), at: s.clock, by: n.viewer, type: 'PLAN_AGAIN', summary: `New trip started with ${n.people.length} from "${s.trip.name}"`, effects: ['Costs carried over as a starting point; budgets and dates start fresh'] }];
  return n;
}
