// Pakka UI. One store (S), every change goes through M.dispatch, every view reads selectors.
import * as M from './model.js';
import { PRESETS, DEFAULT_PRESET, nextScriptedReply } from './presets.js';
import * as I from './integrations.js';

const KEY = 'pakka.v2';
const TABS = [['home', 'Home'], ['align', 'Align'], ['commit', 'Commit'], ['book', 'Book'], ['plan', 'Plan'], ['money', 'Money']];
const TAB_ICON = { home: '🏝️', align: '🗓️', commit: '🤝', book: '🏡', plan: '🗺️', money: '💸' };
const ICON = {
  ADD_PERSON: '🙋', INVITE: '💌', SET_AVAIL: '🗓️', ADD_DATE_OPTION: '🗓️', SET_BUDGET: '🔒', CHOOSE_DATES: '📌', SET_COSTS: '🧾', SET_TRIP: '✏️',
  OPEN_PACT: '🤝', REVISE_PACT: '🔁', WITHDRAW: '🚪', REPLACE: '🔄', NUDGE: '🔔', CONFIRM_BOOKING: '🏡', RECHECK_BOOKING: '✅',
  ADD_ITEM: '📍', REMOVE_ITEM: '🗑️', LOG_ITEM_EXPENSE: '💸', ADD_EXPENSE: '💸', REMOVE_EXPENSE: '🗑️', RECORD_PAYMENT: '💰',
  START_TRIP: '🚐', END_TRIP: '🌅', CALL_OFF: '🛑', CANCEL: '🛑', CLOSE: '🏁', SET_ALBUM: '📸', RATE: '⭐', PLAN_AGAIN: '🔁'
};
const PATH = ['draft', 'aligning', 'committing', 'ready_to_book', 'booked', 'on_trip', 'settling', 'closed'];

const STORY = {
  draft: 'Organiser adds the group, date options and rough costs',
  aligning: 'Friends mark dates and a private budget',
  pact: 'A conditional yes: nobody pays unless enough commit',
  booked: 'The line is hit, the stay is booked, shares go out',
  trip: 'Day plan and costs logged as you go',
  settle: 'Fewest transfers to square everyone up'
};

let S, ui = { tab: 'home', preset: DEFAULT_PRESET, last: null, sheet: null, logItem: null, pact: null };

// ---------- helpers ----------
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ini = n => esc(String(n).split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase());
const hue = n => [...String(n)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const av = (n, cls = '') => `<span class="av ${cls}" style="--h:${hue(n)}" aria-hidden="true">${ini(n)}</span>`;
const who = id => esc(M.person(S, id)?.name || 'Someone');
const me = () => M.person(S, S.viewer);
const isOrg = () => !!me()?.organiser;
const parseRs = v => { const n = parseInt(String(v ?? '').replace(/[^\d]/g, ''), 10); return Number.isFinite(n) ? M.rupees(n) : NaN; };
const rs = p => Math.round(p / 100);
const idx = p => PATH.indexOf(p === 'failed' ? 'committing' : p);
const atLeast = p => S.phase !== 'cancelled' && idx(S.phase) >= idx(p);
const going = () => M.committed(S);
const phaseTone = { committing: 'mid', ready_to_book: 'go', booked: 'go', on_trip: 'go', failed: 'no', cancelled: 'no', settling: 'mid' };
const ext = (href, label) => `<a class="ext" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;

function save() { try { localStorage.setItem(KEY, JSON.stringify({ s: S, tab: ui.tab, preset: ui.preset })); } catch (e) { /* storage unavailable: demo still works */ } }
function load() {
  try {
    const raw = localStorage.getItem(KEY); if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || !d.s || d.s.schema !== M.SCHEMA || M.checkInvariants(d.s).length) return { bad: true };
    return d;
  } catch (e) { return { bad: true }; }
}

let toastTimer;
function toast(msg, err = false) {
  const t = document.getElementById('toast'); if (!t) return;
  t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
  t.setAttribute('role', err ? 'alert' : 'status');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = 'toast'; }, err ? 4200 : 2600);
}

function act(ev, okMsg) {
  const r = M.dispatch(S, ev);
  if (r.error) { toast(r.error, true); console.warn('[pakka] rejected', ev.type, r.error); return false; }
  const v = M.checkInvariants(r.state);
  if (v.length) { console.error('[pakka] invariant violation', v, ev); toast('That change would leave the trip inconsistent, so it wasn’t applied.', true); return false; }
  S = r.state;
  if (ev.type !== 'SET_VIEWER') ui.last = { summary: S.log[0]?.summary, effects: r.effects };
  console.info('[pakka]', ev.type, r.effects);
  save(); render();
  if (okMsg) toast(okMsg);
  return true;
}

function loadPreset(key) {
  S = PRESETS[key].build(); ui = { ...ui, tab: 'home', preset: key, last: null, sheet: null, logItem: null, pact: null };
  save(); render(); toast(`Loaded "${PRESETS[key].label}"`);
}

// ---------- tab state ----------
function tabInfo(id) {
  const p = S.phase, v = M.viability(S);
  const lockWhy = (() => {
    if (p === 'cancelled') return 'This plan was called off.';
    if (p === 'failed') return 'The pact missed its line. Revise it on Commit or call it off.';
    if (p === 'committing') return `Unlocks when ${v.need} commit. ${v.short} to go.`;
    return 'Unlocks once the pact reaches its line.';
  })();
  switch (id) {
    case 'home': return { st: 'open' };
    case 'align': return { st: ['draft', 'aligning'].includes(p) ? 'now' : 'done' };
    case 'commit': return p === 'draft' ? { st: 'lock', why: 'Opens after the invite goes out and dates are picked.' } : { st: ['committing', 'failed'].includes(p) || (p === 'aligning' && isOrg()) ? 'now' : atLeast('ready_to_book') ? 'done' : 'open' };
    case 'book': return !atLeast('ready_to_book') ? { st: 'lock', why: lockWhy } : { st: p === 'ready_to_book' || S.booking?.status === 'needs_recheck' ? 'now' : 'done' };
    case 'plan': return !atLeast('ready_to_book') ? { st: 'lock', why: lockWhy } : { st: p === 'on_trip' ? 'now' : atLeast('settling') ? 'done' : 'open' };
    case 'money': return !atLeast('booked') ? { st: 'lock', why: p === 'cancelled' ? 'This plan was called off before any money moved.' : 'Opens when the booking is recorded. Until then nobody owes anything.' } : { st: p === 'settling' ? 'now' : p === 'closed' ? 'done' : 'open' };
  }
}

// ---------- render ----------
function render() { renderFrame(); renderRail(); }

function renderFrame() {
  const frame = document.getElementById('frame'); if (!frame) return;
  const view = document.getElementById('view'); const prevScroll = view && view.dataset.tab === ui.tab ? view.scrollTop : 0;
  const people = S.people.filter(p => p.status !== 'replaced');
  const v0 = me();
  frame.innerHTML = `
    <header class="status">
      <span class="clock">${esc(M.fmtWhen(S.clock))}</span>
      <label class="who">${av(v0?.name || '', 'sm')}<span class="vh">Viewing as</span>
        <select id="viewer" data-change="viewer">
          ${people.map(p => `<option value="${p.id}" ${p.id === S.viewer ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
        </select></label>
    </header>
    <div class="title"><b>${esc(S.trip.name)}</b><span class="phase ${phaseTone[S.phase] || ''}">${esc(M.PHASE_LABEL[S.phase])}</span></div>
    <main class="view" id="view" data-tab="${ui.tab}">${viewFor(ui.tab)}</main>
    <nav class="tabs" aria-label="Trip stages">
      ${TABS.map(([id, label]) => { const t = tabInfo(id); return `<button class="tab ${t.st === 'lock' ? 'locked' : ''}" data-act="tab" data-tab="${id}" ${ui.tab === id ? 'aria-current="page"' : ''}><span class="ti" aria-hidden="true">${TAB_ICON[id]}<span class="st ${t.st === 'lock' ? 'off' : t.st}"></span></span>${label}${t.st === 'lock' ? '<span class="vh"> (locked)</span>' : ''}</button>`; }).join('')}
    </nav>
    ${ui.sheet ? sheetHTML() : ''}`;
  const v2 = document.getElementById('view'); if (v2) v2.scrollTop = prevScroll;
  if (ui.sheet) document.getElementById('sheet-ok')?.focus();
}

function viewFor(tab) {
  const t = tabInfo(tab);
  if (t.st === 'lock') return `<div class="lock"><span class="ic">Locked</span><h2>${esc(TABS.find(x => x[0] === tab)[1])} isn’t open yet</h2><p class="sub">${esc(t.why)}</p><button class="btn ghost sm" data-act="tab" data-tab="${S.phase === 'failed' || S.phase === 'committing' ? 'commit' : 'home'}">Go to ${S.phase === 'failed' || S.phase === 'committing' ? 'Commit' : 'Home'}</button></div>`;
  return ({ home: vHome, align: vAlign, commit: vCommit, book: vBook, plan: vPlan, money: vMoney })[tab]();
}

// ---------- HOME ----------
function vHome() {
  const r = M.tripRange(S), f = M.forecast(S), fit = M.budgetFit(S), acts = M.nextActions(S), m = me();
  const warn = [];
  const buf = M.deadlineBuffer(S);
  if (buf && buf.risky && ['committing', 'aligning'].includes(S.phase)) warn.push(`<div class="banner warn"><b>Deadline is close to check-in</b><span class="sub">The pact closes ${buf.days} days before the trip. Villas usually refund in full only 14+ days out, and collecting shares takes a few days, so a late dropout gets expensive.</span></div>`);
  if (S.booking?.status === 'needs_recheck') warn.push(`<div class="banner warn"><b>Booking needs re-confirming</b><span class="sub">${esc(S.booking.note)}</span></div>`);
  if (S.phase === 'booked' && S.booking) { const d = M.daysUntil(S, S.booking.cancelBy); if (d >= 0 && d <= 3) warn.push(`<div class="banner warn"><b>Free cancellation ends ${esc(M.fmtDay(S.booking.cancelBy))}</b><span class="sub">After that, dropping out costs the group by the agreed rule.</span></div>`); }
  const v = M.viability(S);
  if (S.phase === 'committing' && v && !v.reachable) warn.push(`<div class="banner no"><b>Can’t reach ${v.need} any more</b><span class="sub">Only ${v.committed + v.pending} people could still say yes.</span></div>`);
  if (S.phase === 'cancelled') warn.push(`<div class="banner no"><b class="big">Called off</b><span class="sub">No money moved. You can start again with the same group.</span>${isOrg() ? '<button class="btn sm" data-act="plan-again">Start a new plan with this group</button>' : ''}</div>`);

  const each = atLeast('booked') ? M.costPerPerson(S, f.going) : f.atNeed;
  const fitLine = m.organiser
    ? `Fits ${fit.fits} of ${fit.shared} shared budgets${fit.shared < fit.of ? ` · ${fit.of - fit.shared} not shared yet` : ''}`
    : m.budgetMax == null ? 'Your private budget isn’t set' : m.budgetMax >= fit.target ? 'Fits your private budget' : 'Over your private budget';
  const hero = ['committing', 'failed'].includes(S.phase) && v ? `
    <div class="meter">
      <div class="count">${v.committed}<small> committed · need ${v.need}</small></div>
      <div class="track" aria-hidden="true"><div class="fill" style="width:${Math.min(100, v.committed / Math.max(1, M.active(S).length) * 100)}%"></div><div class="mark" style="left:${Math.min(100, v.need / Math.max(1, M.active(S).length) * 100)}%"><span>${v.need} needed</span></div></div>
      <div class="timer"><span>${S.phase === 'failed' ? 'Closed below the line' : v.reachable ? `${v.short} more to go` : `Can’t reach ${v.need} now`}</span><span>Closes <b>${esc(M.fmtWhen(S.pact.deadline))}</b></span></div>
    </div>` : '';
  const [place, ...region] = S.trip.destination.split(/,\s*/);
  return `
    <div class="pass">
      <div class="pass-main">
        <span class="lbl">Squad trip · organised by ${who(M.organiser(S).id)}</span>
        <div class="pass-dest">${esc(place)}${region.length ? `<small>${esc(region.join(', '))}</small>` : ''}</div>
        <h2 class="pass-route">${r ? `<span>${esc(M.fmtDay(r.start))}</span><i aria-hidden="true">✈</i><span class="vh"> to </span><span>${esc(M.fmtDay(r.end))}</span>` : 'Dates not chosen yet'}</h2>
      </div>
      <div class="pass-stub">${r ? `<span><b>${r.nights}</b> nights</span><span><b>${going().length}</b> going</span>${S.pact ? `<span><b>${S.pact.need}</b> needed</span>` : ''}` : '<span>Pick dates on Align</span>'}</div>
    </div>
    ${warn.join('')}
    ${hero}
    <div class="calc">${atLeast('booked') ? 'Each person, all-in' : `Each person if ${f.need} go`}: <b class="money">${M.fmt(each)}</b><span class="sub">${esc(fitLine)}</span></div>
    ${acts.length ? `<div class="sec"><span class="lbl">Next for you</span><ul class="next">${acts.map(a => `<li><button data-act="tab" data-tab="${a.tab}">${esc(a.text)}</button></li>`).join('')}</ul></div>` : ''}
    <div class="sec"><span class="lbl">Recent activity</span>${activityHTML()}</div>`;
}

// Recent activity: one line per thing that happened. Clock jumps are hidden and runs of the
// same kind of event (e.g. eight people marking dates) fold into one line with a count.
const ago = iso => { const m = Math.round((Date.parse(S.clock) - Date.parse(iso)) / 60000); return m < 1 ? 'now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`; };
function activityHTML(n = 5) {
  const rows = [];
  for (const l of S.log) {
    if (l.type === 'SET_CLOCK') continue;
    const prev = rows[rows.length - 1];
    if (prev && prev.type === l.type && l.type !== 'RESPOND') { prev.more++; continue; }
    if (rows.length === n) break;
    rows.push({ ...l, more: 0 });
  }
  if (!rows.length) return '<p class="sub">Nothing yet. Quiet before the trip 🌊</p>';
  const GROUP = { SET_AVAIL: 'date replies', SET_BUDGET: 'private budgets set', ADD_PERSON: 'friends added to the group', ADD_DATE_OPTION: 'date options added', ADD_ITEM: 'things added to the plan', REMOVE_ITEM: 'plan items removed', ADD_EXPENSE: 'expenses added', LOG_ITEM_EXPENSE: 'plan costs logged', RECORD_PAYMENT: 'payments marked', RATE: 'trip ratings' };
  const text = l => l.more && GROUP[l.type] ? `${l.more + 1} ${GROUP[l.type]}` : `${esc(l.summary)}${l.more ? ` <span class="more">+${l.more}<span class="vh"> more like this</span></span>` : ''}`;
  const icon = l => l.type === 'RESPOND' ? (/committed$/.test(l.summary) ? '✅' : '👋') : ICON[l.type] || '✨';
  return `<ul class="feed">${rows.map(l => `<li><span class="fi" aria-hidden="true">${icon(l)}</span><span class="ft">${text(l)}</span><time datetime="${esc(l.at)}" title="${esc(M.fmtWhen(l.at))}">${ago(l.at)}</time></li>`).join('')}</ul>`;
}

// ---------- ALIGN ----------
function vAlign() {
  const org = isOrg(), p = S.phase;
  if (p === 'draft') {
    if (!org) return `<div class="lock"><h2>${who(M.organiser(S).id)} is still setting this up</h2><p class="sub">You’ll get a link in the group when it’s ready.</p></div>`;
    const block = M.blockedReason(S, 'INVITE');
    return `
      <div class="sec"><h4>Step 1 · The trip</h4>
        <form class="card" data-form="trip">
          <div class="grid2"><label class="f">Trip name<input type="text" id="f-trip-name" name="name" value="${esc(S.trip.name)}" maxlength="60"></label>
          <label class="f">Destination<input type="text" id="f-trip-dest" name="destination" value="${esc(S.trip.destination)}" maxlength="60"></label></div>
          <button class="btn ghost sm">Save trip details</button>
        </form></div>
      <div class="sec"><h4>Step 2 · Who's invited (${S.people.length})</h4>
        <div class="card"><ul class="list">${S.people.map(x => `<li>${av(x.name)}<span class="grow">${esc(x.name)}</span>${x.organiser ? '<span class="pill">organiser</span>' : ''}</li>`).join('')}</ul>
        <form class="row" data-form="person"><input type="text" id="f-person" name="name" placeholder="Friend’s name" maxlength="24" aria-label="Friend’s name" style="flex:1"><button class="btn sm">Add</button></form></div></div>
      <div class="sec"><h4>Step 3 · Date options</h4>
        <div class="card">${S.dates.options.map(o => `<div class="row between"><span>${esc(M.fmtDay(o.start))} → ${esc(M.fmtDay(M.addDays(o.start, o.nights)))}</span><span class="sub">${o.nights} nights</span></div>`).join('') || '<p class="sub">Add one or two weekends so friends can say which works.</p>'}
        <form class="grid2" data-form="date"><label class="f">Starts<input type="date" id="f-date" name="start" min="${M.ymdInIST(S.clock)}"></label>
          <label class="f">Nights<select class="in" id="f-nights" name="nights">${[1, 2, 3, 4, 5].map(n => `<option ${n === 2 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <button class="btn ghost sm" style="grid-column:1/-1">Add date option</button></form></div></div>
      <div class="sec"><h4>Step 4 · Rough costs</h4>${costsForm()}</div>
      <div class="sec">
        ${block ? `<p class="sub">${esc(block)}</p>` : ''}
        <button class="btn wide" data-act="invite" ${block ? 'disabled' : ''}>Share the invite</button>
        <p class="sub">Friends mark the dates they can make and a private budget. Nobody commits yet.</p>
      </div>`;
  }
  const tally = M.dateTally(S), act_ = M.active(S).length, m = me(), fit = M.budgetFit(S);
  const canMark = p === 'aligning';
  return `
    <div class="sec"><h4>Dates</h4>
      ${tally.map(o => `<div class="card">
        <div class="row between"><b>${esc(M.fmtDay(o.start))} → ${esc(M.fmtDay(M.addDays(o.start, o.nights)))}</b>${o.id === S.dates.chosenId ? '<span class="pill ok">Chosen</span>' : `<span class="sub">${o.nights} nights</span>`}</div>
        <div class="row between"><span class="sub">${o.yes.length} of ${act_} can make it</span><span class="sub">${o.no.length} can’t</span></div>
        <div class="bar" aria-hidden="true"><i style="width:${Math.round(o.yes.length / act_ * 100)}%"></i></div>
        ${canMark ? `<div class="row"><span class="sub">You:</span>
          <button class="chip" data-act="avail" data-opt="${o.id}" data-v="1" aria-pressed="${m.avail[o.id] === true}">I can</button>
          <button class="chip" data-act="avail" data-opt="${o.id}" data-v="0" aria-pressed="${m.avail[o.id] === false}">I can’t</button>
          ${isOrg() && o.id !== S.dates.chosenId ? `<button class="btn sm" data-act="choose" data-opt="${o.id}" style="margin-left:auto">Choose</button>` : ''}</div>` : ''}
      </div>`).join('')}
    </div>
    ${['aligning', 'committing', 'failed', 'ready_to_book'].includes(p) && !['withdrawn', 'replaced'].includes(m.status) ? `
    <div class="sec"><h4>Your private budget</h4>
      <form class="card" data-form="budget">
        <p class="sub">The most you’d spend on this trip, all-in. Only you see the number. The group only sees how many budgets the plan fits.</p>
        <div class="row"><label class="f" style="flex:1">Max ₹<input type="text" id="f-budget" name="budget" inputmode="numeric" value="${m.budgetMax == null ? '' : rs(m.budgetMax)}" placeholder="e.g. 12000"></label>
        <button class="btn sm" style="align-self:flex-end">Save</button>${m.budgetMax != null ? '<button type="button" class="btn ghost sm" data-act="clear-budget" style="align-self:flex-end">Clear</button>' : ''}</div>
        ${m.budgetMax != null ? `<span class="pill ${m.budgetMax >= fit.target ? 'ok' : 'bad'}" style="align-self:flex-start">${m.budgetMax >= fit.target ? 'The plan fits your budget' : `The plan is ${M.fmt(fit.target - m.budgetMax)} over your budget`}</span>` : ''}
      </form></div>` : ''}
    <div class="sec"><h4>Group fit</h4>
      <div class="banner info"><span>Forecast at ${S.pact?.need || Math.min(6, act_)} people: <b class="money">${M.fmt(fit.target)}</b> each, all-in.</span>
      <span class="sub">Fits ${fit.fits} of ${fit.shared} budgets shared${fit.shared < fit.of ? `; ${fit.of - fit.shared} not shared yet` : ''}.</span></div>
    </div>
    ${isOrg() && M.eventAllowed(S, 'SET_COSTS') && !S.booking ? `<div class="sec"><h4>Costs</h4>${costsForm()}</div>` : ''}
    ${isOrg() && p === 'aligning' ? `<div class="sec"><h4>Invite</h4><div class="row">${ext(I.waShare(I.inviteMessage(S)), 'Share in WhatsApp')}<button class="btn ghost sm" data-act="copy" data-text="${esc(I.inviteMessage(S))}">Copy message</button></div></div>` : ''}`;
}

function costsForm() {
  const c = S.costs, r = M.tripRange(S), n = S.pact?.need || Math.min(6, M.active(S).length);
  return `<form class="card" data-form="costs">
    <div class="grid2">
      <label class="f">Stay total ₹<input type="text" id="f-stay" name="stayTotal" inputmode="numeric" value="${rs(c.stayTotal)}"></label>
      <label class="f">Advance to book ₹<input type="text" id="f-adv" name="advance" inputmode="numeric" value="${rs(c.advance)}"></label>
      <label class="f">Travel per person ₹<input type="text" id="f-travel" name="transportPP" inputmode="numeric" value="${rs(c.transportPP)}"></label>
      <label class="f">Food & local per day ₹<input type="text" id="f-food" name="foodPPPerDay" inputmode="numeric" value="${rs(c.foodPPPerDay)}"></label>
    </div>
    <p class="sub">At ${n} people: <b class="money">${M.fmt(M.costPerPerson(S, n))}</b> each${r ? ` for ${r.days} days` : ''}. Estimates, not quotes.</p>
    <button class="btn ghost sm">Update costs</button></form>`;
}

// ---------- COMMIT ----------
function vCommit() {
  const p = S.phase, org = isOrg(), m = me();
  if (p === 'aligning') {
    if (!org) return `<div class="lock"><h2>The pact isn’t open yet</h2><p class="sub">${who(M.organiser(S).id)} will open it once the dates are settled. Meanwhile, mark your dates and budget on Align.</p><button class="btn ghost sm" data-act="tab" data-tab="align">Go to Align</button></div>`;
    return pactSetup();
  }
  const v = M.viability(S), act_ = M.active(S).length || 1, c = v.committed;
  const deadlineMs = Date.parse(S.pact.deadline) - Date.parse(S.clock);
  const left = deadlineMs > 0 ? (deadlineMs >= 86400000 ? `${Math.floor(deadlineMs / 86400000)}d ${Math.floor(deadlineMs % 86400000 / 3600000)}h left` : `${Math.max(1, Math.floor(deadlineMs / 3600000))}h left`) : 'closed';
  const lo = M.costPerPerson(S, act_), hi = M.costPerPerson(S, S.pact.need);
  const people = S.people.filter(x => x.status !== 'replaced' || x.replacedBy);
  const pill = x => x.status === 'in' ? '<span class="pill in">Committed</span>' : x.status === 'out' ? '<span class="pill out">Out</span>' : x.status === 'withdrawn' ? '<span class="pill out">Pulled out</span>' : x.status === 'replaced' ? `<span class="pill">Spot taken by ${who(x.replacedBy)}</span>` : '<span class="pill">Not yet</span>';
  let top = '';
  if (p === 'ready_to_book') top = `<div class="banner go"><b class="big">It’s pakka.</b><span class="sub">${c} committed before the deadline. The group agreed to this line, so booking now is the group’s call, not one person’s gamble.</span>${org ? '<button class="btn go sm" data-act="tab" data-tab="book" style="align-self:flex-start">Book the stay</button>' : ''}</div>`;
  if (p === 'failed') top = `<div class="banner no"><b class="big">Not this time.</b><span class="sub">${c} of ${v.need} by ${esc(M.fmtWhen(S.pact.deadline))}. The pact closed and nobody owes anything.</span></div>`;
  const mine = (() => {
    if (!['committing', 'ready_to_book'].includes(p) || m.organiser) return '';
    if (m.status === 'invited') return `<div class="card pact">
        <b style="font-family:var(--display);font-size:19px;line-height:1.2">Happens only if ${v.need} commit by ${esc(M.fmtWhen(S.pact.deadline))}.</b>
        <div class="row between"><span class="sub">Your share</span><b class="money">${M.fmt(lo)}–${M.fmt(hi)}</b></div>
        <div class="row between"><span class="sub">When you pay</span><span>Only once ${v.need} have committed</span></div>
        <span class="sub">${esc(M.RULES[S.pact.rule])}</span>
        <p class="sub">There’s no “maybe”. If it doesn’t reach ${v.need}, your yes costs nothing.</p>
        <div class="grid2"><button class="btn go" data-act="respond" data-a="in">I’m committing</button><button class="btn ghost" data-act="respond" data-a="out">Can’t make it</button></div></div>`;
    if (m.status === 'out') return `<div class="card"><span class="sub">You said you can’t make it.</span><button class="btn ghost sm" data-act="respond" data-a="in" style="align-self:flex-start">Actually, I’m in</button></div>`;
    return '';
  })();
  const withdraw = !m.organiser && m.status === 'in' && M.eventAllowed(S, 'WITHDRAW') ? `<button class="btn warn sm" data-act="withdraw" style="align-self:flex-start">I can’t come any more</button>` : '';
  const orgTools = org && p === 'committing' ? `<div class="sec"><h4>Organiser</h4><div class="row">
      ${v.pending ? `<button class="btn ghost sm" data-act="nudge">Let Pakka remind the ${v.pending}</button>` : ''}
      ${ext(I.waShare(I.inviteMessage(S)), 'Share in WhatsApp')}</div>
      ${M.pending(S).length ? `<div class="row"><span class="sub">See it as:</span>${M.pending(S).slice(0, 4).map(x => `<button class="chip" data-act="viewas" data-id="${x.id}">${esc(x.name)}</button>`).join('')}</div>` : ''}</div>` : '';
  const recovery = p === 'failed' && org ? `<div class="sec"><h4>What now</h4>
      ${c >= 2 ? `<button class="btn" data-act="revise" data-need="${c}">Go with the ${c} who said yes</button>` : ''}
      <button class="btn ghost" data-act="revise" data-need="${v.need}" data-more="1">Give everyone 2 more days</button>
      <button class="btn warn" data-act="cancel">Call it off</button>
      <p class="sub">Revising only asks people who haven’t said no.</p></div>` : '';
  const replace = org && ['booked', 'on_trip'].includes(p) && S.people.some(x => x.status === 'withdrawn') ? `<div class="sec"><h4>Fill a spot</h4>${S.people.filter(x => x.status === 'withdrawn').map(x => `<form class="row" data-form="replace" data-id="${x.id}"><span class="sub" style="flex-basis:100%">${esc(x.name)} pulled out. Who takes the spot?</span><input type="text" id="f-replace-${x.id}" name="name" placeholder="Name" aria-label="Replacement for ${esc(x.name)}" style="flex:1"><button class="btn sm">Take the spot</button></form>`).join('')}</div>` : '';
  return `
    ${top}
    <div class="meter">
      <span class="sub">${esc(S.trip.name)}</span>
      <div class="count">${c}<small> committed · need ${v.need}</small></div>
      <div class="track" role="progressbar" aria-valuemin="0" aria-valuemax="${act_}" aria-valuenow="${c}" aria-label="Commitments">
        <div class="fill" style="width:${Math.min(100, c / act_ * 100)}%"></div>
        <div class="mark" style="left:${Math.min(100, v.need / act_ * 100)}%"><span>${v.need} needed</span></div></div>
      <div class="timer"><span>${p === 'committing' ? (v.reachable ? `${v.short} more to go` : `Can’t reach ${v.need} now`) : p === 'failed' ? 'Closed below the line' : 'Reached the line'}</span><span>${p === 'committing' ? `Closes <b>${esc(M.fmtWhen(S.pact.deadline))}</b> · ${left}` : `Deadline <b>${esc(M.fmtWhen(S.pact.deadline))}</b>`}</span></div>
    </div>
    ${mine}
    <ul class="list">${people.map(x => `<li>${av(x.name)}<span class="grow">${esc(x.name)}${x.organiser ? ' <span class="sub">· organiser</span>' : ''}${x.id === S.viewer ? ' <span class="sub">· you</span>' : ''}</span>${pill(x)}</li>`).join('')}</ul>
    ${withdraw}
    ${orgTools}${recovery}${replace}`;
}

function pactSetup() {
  const act_ = M.active(S).length;
  const pc = ui.pact || (ui.pact = { need: Math.min(6, act_), day: 2, rule: 'keep' });
  pc.need = Math.min(Math.max(2, pc.need), act_);
  const today = M.ymdInIST(S.clock);
  const days = [1, 2, 3, 4].map(d => ({ d, iso: M.isoAt(M.addDays(today, d), '18:00') }));
  const deadline = days.find(x => x.d === pc.day).iso;
  const buf = M.deadlineBuffer(S, deadline);
  const noDates = !S.dates.chosenId;
  return `
    <div class="sec"><span class="sub">Open the pact</span><h2>When does this trip become real?</h2></div>
    ${noDates ? `<div class="banner warn"><b>Choose the dates first</b><span class="sub">The pact needs fixed dates so everyone knows what they’re saying yes to.</span><button class="btn sm" data-act="tab" data-tab="align" style="align-self:flex-start">Pick dates on Align</button></div>` : ''}
    <div class="sec"><h4>It’s on if at least</h4>
      <div class="stepper"><button data-act="need" data-d="-1" aria-label="Fewer people">−</button><b>${pc.need} <small>of ${act_} commit</small></b><button data-act="need" data-d="1" aria-label="More people">+</button></div></div>
    <div class="sec"><h4>Decide by</h4>
      <div class="chips">${days.map(x => `<button class="chip" data-act="pact-day" data-d="${x.d}" aria-pressed="${x.d === pc.day}">${esc(M.fmtWhen(x.iso))}</button>`).join('')}</div>
      ${buf ? `<span class="pill ${buf.risky ? 'warn' : 'ok'}" style="align-self:flex-start">${buf.days} days before check-in${buf.risky ? ` · under ${M.SAFE_BUFFER_DAYS}, dropouts get costly` : ''}</span>` : ''}</div>
    <div class="sec"><h4>If someone drops out after booking</h4>
      <div class="radios">${Object.entries(M.RULES).map(([k, t]) => `<label><input type="radio" name="rule" value="${k}" data-change="rule" ${k === pc.rule ? 'checked' : ''}><span>${esc(t)}</span></label>`).join('')}</div></div>
    <div class="banner info"><span>Each share: <b class="money">${M.fmt(M.costPerPerson(S, act_))}</b> if all ${act_} come, up to <b class="money">${M.fmt(M.costPerPerson(S, pc.need))}</b> at ${pc.need}.</span><span class="sub">Below ${pc.need}, the trip is off and nobody pays.</span></div>
    <button class="btn wide" data-act="open-pact" ${noDates ? 'disabled' : ''}>Open the pact</button>`;
}

// ---------- BOOK ----------
function vBook() {
  const p = S.phase, org = isOrg(), r = M.tripRange(S);
  if (p === 'ready_to_book') {
    if (!org) return `<div class="banner go"><b class="big">It’s pakka.</b><span class="sub">Waiting for ${who(M.organiser(S).id)} to book. Nobody has paid anything yet, and you’ll see your exact share as soon as the booking is recorded.</span></div>`;
    const links = I.staySearchLinks(S);
    const cancelDefault = M.addDays(r.start, -14) > M.ymdInIST(S.clock) ? M.addDays(r.start, -14) : M.ymdInIST(S.clock);
    return `
      <div class="banner go"><b class="big">It’s pakka · ${going().length} going</b><span class="sub">${esc(M.fmtDay(r.start))} → ${esc(M.fmtDay(r.end))}, ${r.nights} nights in ${esc(S.trip.destination)}.</span></div>
      <div class="sec"><h4>1 · Find and book the stay</h4>
        <div class="card"><div class="row">${links.map(l => ext(l.href, `Search ${l.label}`)).join('')}</div>
        <p class="sub">These open with your dates and ${going().length} guests. Pakka doesn’t book or pay for you.</p>
        <p class="sub">Planned: stay ${M.fmt(S.costs.stayTotal)}, advance ${M.fmt(S.costs.advance)}. Some platforms take the full stay upfront, so record what you actually paid.</p></div></div>
      <div class="sec"><h4>2 · Record the booking</h4>
        <form class="card" data-form="booking">
          <div class="grid2">
            <label class="f">Booked on<input type="text" id="f-provider" name="provider" value="Villa host (direct)" maxlength="40"></label>
            <label class="f">Booking reference<input type="text" id="f-ref" name="reference" placeholder="From the confirmation" maxlength="40"></label>
            <label class="f">Paid now ₹<input type="text" id="f-paid" name="amountPaid" inputmode="numeric" value="${rs(S.costs.advance)}"></label>
            <label class="f">Paid by<select class="in" id="f-paidby" name="paidBy">${going().map(x => `<option value="${x.id}" ${x.id === S.viewer ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
            <label class="f" style="grid-column:1/-1">Free cancellation until<input type="date" id="f-cancel" name="cancelBy" value="${cancelDefault}"></label>
          </div>
          <button class="btn go">Record booking</button>
          <p class="sub">The trip is only marked booked once a reference is entered here.</p>
        </form></div>`;
  }
  const b = S.booking;
  if (!b) return `<div class="lock"><h2>No booking</h2><p class="sub">This trip ended before anything was booked.</p></div>`;
  const cancelDays = M.daysUntil(S, b.cancelBy);
  const others = S.dates.options.filter(o => o.id !== S.dates.chosenId);
  const advance = S.expenses.find(e => e.source === 'advance');
  const sh = advance ? M.expenseShares(advance) : {};
  const bal = M.balances(S), owesOrg = M.settlements(S).filter(t => t.to === b.paidBy);
  return `
    ${b.status === 'needs_recheck' ? `<div class="banner warn"><b>Re-confirm with the host</b><span class="sub">${esc(b.note)}</span>
      ${org ? `<form class="row" data-form="recheck"><input type="text" id="f-recheck" name="reference" value="${esc(b.reference)}" aria-label="Confirmed reference" style="flex:1"><button class="btn sm">Host confirmed</button></form>` : ''}</div>` : ''}
    <div class="card">
      <div class="row between"><b>${esc(b.provider)}</b><span class="pill ${b.status === 'confirmed' ? 'ok' : 'warn'}">${b.status === 'confirmed' ? 'Confirmed' : 'Needs re-check'}</span></div>
      <div class="row between"><span class="sub">Reference</span><span class="money">${esc(b.reference)}</span></div>
      <div class="row between"><span class="sub">Paid by ${who(b.paidBy)}</span><span class="money">${M.fmt(b.amountPaid)}</span></div>
      <div class="row between"><span class="sub">Balance at check-in</span><span class="money">${M.fmt(Math.max(0, S.costs.stayTotal - b.amountPaid))}</span></div>
      <div class="row between"><span class="sub">Free cancellation</span><span>${cancelDays >= 0 ? `until ${esc(M.fmtDay(b.cancelBy))} · ${cancelDays} days` : `ended ${esc(M.fmtDay(b.cancelBy))}`}</span></div>
      <div class="row">${ext(I.tripCalendarLink(S), 'Add to Google Calendar')}${ext(I.mapsDirections(S.trip.destination), 'Directions')}</div>
    </div>
    ${p === 'booked' && advance ? `<div class="sec"><h4>Shares of the advance</h4>
      <ul class="list">${advance.among.map(id => { const t = owesOrg.find(x => x.from === id); return `<li>${av(M.person(S, id).name)}<span class="grow">${who(id)}<br><span class="sub money">${M.fmt(sh[id])}</span></span>${id === b.paidBy ? '<span class="pill ok">Paid the host</span>' : t ? `<span class="pill warn">Owes ${M.fmt(t.amount)}</span>${(org && S.viewer === b.paidBy) ? `<button class="btn ghost sm" data-act="mark-paid" data-from="${id}" data-to="${b.paidBy}" data-amount="${t.amount}">Received</button>` : ''}` : bal[id] >= 0 ? '<span class="pill ok">Paid</span>' : '<span class="pill">Settles later</span>'}</li>`; }).join('')}</ul>
      ${(() => { const t = owesOrg.find(x => x.from === S.viewer); return t ? `<div class="card"><span>Pay ${who(t.to)} <b class="money">${M.fmt(t.amount)}</b> in any UPI app, then tell the group here.</span><button class="btn go sm" data-act="i-paid" data-to="${t.to}" data-amount="${t.amount}" style="align-self:flex-start">I’ve paid</button></div>` : ''; })()}
      <p class="sub">Everyone gets the same ask at the same moment, so nobody pays first and nobody chases. Pakka never moves money; payments are marked by the people involved.</p>
      ${org && owesOrg.length ? `<div class="row">${ext(I.waShare(`Shares for the ${S.trip.name} advance: ${owesOrg.map(t => `${M.person(S, t.from).name} ${M.fmt(t.amount)}`).join(', ')}. Pay ${M.person(S, b.paidBy).name} on any UPI app and tap "I've paid" on Pakka.`), 'Send reminder in WhatsApp')}</div>` : ''}
    </div>` : ''}
    ${org && p === 'booked' ? `<div class="sec"><h4>Changes</h4>
      ${others.length ? `<div class="card"><span class="sub">Move the trip to other dates. The booking is flagged until the host confirms, and plan items that no longer fit are flagged too.</span>
      <div class="row">${others.map(o => `<button class="btn ghost sm" data-act="change-dates" data-opt="${o.id}">${esc(M.fmtDay(o.start))}, ${o.nights} nights</button>`).join('')}</div></div>` : ''}
      <button class="btn warn sm" data-act="call-off" style="align-self:flex-start">Call the trip off</button></div>` : ''}`;
}

// ---------- PLAN ----------
function vPlan() {
  const r = M.tripRange(S), flags = M.itemFlags(S), today = M.tripDayToday(S), p = S.phase, org = isOrg();
  const canEdit = M.eventAllowed(S, 'ADD_ITEM');
  const days = [];
  for (let d = 1; d <= r.days; d++) days.push(d);
  const outside = S.items.filter(it => it.day > r.days);
  const itemHTML = it => {
    const f = flags[it.id] || []; const clash = f.filter(x => x.startsWith('clash')).map(x => S.items.find(y => y.id === x.slice(6))?.title).filter(Boolean);
    const out = f.includes('outside');
    return `<div class="item ${out ? 'outside' : clash.length ? 'clash' : ''}">
      <time>${esc(it.start)}<br>${esc(it.end)}</time>
      <div><b>${esc(it.title)}</b><div class="meta">${it.place ? ext(I.mapsSearch(it.place), 'Map') : ''}${it.costPP ? `<span class="money">${M.fmt(it.costPP)} pp</span>` : ''}${it.expenseId ? '<span class="pill ok">Logged</span>' : ''}</div></div>
      <div>${canEdit && !it.expenseId && (org || true) ? `<button class="x" data-act="rm-item" data-id="${it.id}" aria-label="Remove ${esc(it.title)}">×</button>` : ''}</div>
      ${out ? `<span class="why">Outside the trip dates now</span>` : clash.length ? `<span class="why">Overlaps “${esc(clash.join('”, “'))}”</span>` : ''}
      ${p === 'on_trip' && it.costPP && !it.expenseId ? (ui.logItem === it.id ? logForm(it) : `<button class="btn ghost sm" data-act="log-item" data-id="${it.id}" style="grid-column:2/-1;justify-self:start">Log cost</button>`) : ''}
    </div>`;
  };
  const startBlock = p === 'booked' ? M.blockedReason(S, 'START_TRIP') : null;
  return `
    <div class="sec"><span class="sub">${esc(S.trip.destination)}</span><h2>${esc(M.fmtDay(r.start))} → ${esc(M.fmtDay(r.end))}</h2>
      <div class="row">${ext(I.tripCalendarLink(S), 'Add to Google Calendar')}</div></div>
    ${p === 'ready_to_book' ? '<div class="banner info"><span class="sub">Sketch the days now. Costs per person you add here go into everyone’s forecast.</span></div>' : ''}
    ${org && p === 'booked' ? `<div class="sec">${startBlock ? `<p class="sub">${esc(startBlock)}</p>` : ''}<button class="btn go" data-act="start-trip" ${startBlock ? 'disabled' : ''}>Start the trip</button></div>` : ''}
    ${days.map(d => { const list = S.items.filter(it => it.day === d); return `<div class="day ${today === d ? 'today' : ''}"><h4>${esc(I.dayLabel(S, d))}${today === d ? ' · today' : ''}</h4>${list.map(itemHTML).join('') || '<p class="sub">Nothing planned.</p>'}</div>`; }).join('')}
    ${outside.length ? `<div class="day"><h4>Outside the new dates</h4>${outside.map(itemHTML).join('')}</div>` : ''}
    ${canEdit ? `<div class="sec"><h4>Add to the plan</h4>
      <form class="card" data-form="item">
        <div class="grid2">
          <label class="f">Day<select class="in" id="f-day" name="day">${days.map(d => `<option value="${d}" ${d === (today || 1) ? 'selected' : ''}>${esc(I.dayLabel(S, d))}</option>`).join('')}</select></label>
          <label class="f">Cost per person ₹<input type="text" id="f-itemcost" name="costPP" inputmode="numeric" placeholder="0"></label>
          <label class="f">Starts<input type="time" id="f-start" name="start" value="10:00"></label>
          <label class="f">Ends<input type="time" id="f-end" name="end" value="12:00"></label>
          <label class="f" style="grid-column:1/-1">What<input type="text" id="f-title" name="title" maxlength="60" placeholder="e.g. Coffee estate walk"></label>
          <label class="f" style="grid-column:1/-1">Where (for the map)<input type="text" id="f-place" name="place" maxlength="80" placeholder="Place name or address"></label>
        </div>
        <button class="btn ghost sm">Add</button></form></div>` : ''}
    ${org && p === 'on_trip' ? '<button class="btn" data-act="end-trip">End the trip and settle up</button>' : ''}`;
}
function logForm(it) {
  const g = going();
  return `<form class="inline" data-form="logitem" data-id="${it.id}">
    <label class="f">Who paid<select class="in" id="f-logpaid-${it.id}" name="paidBy">${g.map(x => `<option value="${x.id}" ${x.id === S.viewer ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
    <span class="sub">Who went (${M.fmt(it.costPP)} each)</span>
    <div class="checks">${g.map(x => `<label><input type="checkbox" name="among" value="${x.id}" checked>${esc(x.name)}</label>`).join('')}</div>
    <div class="row"><button class="btn sm">Log it</button><button type="button" class="btn ghost sm" data-act="log-item" data-id="">Cancel</button></div></form>`;
}

// ---------- MONEY ----------
function vMoney() {
  const p = S.phase, org = isOrg(), bal = M.balances(S), st = M.settlements(S), mine = bal[S.viewer] || 0;
  const g = going(), spent = M.spentPerPerson(S), planned = M.costPerPerson(S, Math.max(g.length, 1));
  const myOwe = st.filter(t => t.from === S.viewer);
  const stayLogged = S.expenses.some(e => e.source === 'stay-balance');
  const stayBal = S.booking ? S.costs.stayTotal - S.booking.amountPaid : 0;
  const pulse = Object.values(S.pulse);
  return `
    <div class="banner ${mine < 0 ? 'warn' : mine > 0 ? 'info' : 'go'}">
      <b>${mine < 0 ? `You owe ${M.fmt(-mine)}` : mine > 0 ? `You’re owed ${M.fmt(mine)}` : 'You’re all square'}</b>
      ${myOwe.map(t => `<div class="row between"><span>Pay ${who(t.to)} <span class="money">${M.fmt(t.amount)}</span></span><button class="btn go sm" data-act="i-paid" data-to="${t.to}" data-amount="${t.amount}">I’ve paid</button></div>`).join('')}
    </div>
    <div class="sec"><h4>Settle up · ${st.length} transfer${st.length === 1 ? '' : 's'}</h4>
      ${st.length ? `<ul class="list">${st.map(t => `<li><span class="grow">${who(t.from)} → ${who(t.to)}</span><span class="money">${M.fmt(t.amount)}</span>${(org || S.viewer === t.to) && S.viewer !== t.from ? `<button class="btn ghost sm" data-act="mark-paid" data-from="${t.from}" data-to="${t.to}" data-amount="${t.amount}">Received</button>` : ''}</li>`).join('')}</ul>
      <p class="sub">Fewest transfers that settle everyone. Pay in any UPI app; Pakka records it only when someone marks it.</p>` : '<p class="sub">Everyone is settled.</p>'}
    </div>
    <div class="sec"><h4>Per person</h4>
      <div class="banner info"><span>Planned all-in: <b class="money">${M.fmt(planned)}</b> each for ${g.length}.</span></div>
      <ul class="list">${S.people.filter(x => spent[x.id] || bal[x.id]).map(x => `<li>${av(x.name)}<span class="grow">${esc(x.name)}<br><span class="sub">share of costs <span class="money">${M.fmt(spent[x.id])}</span></span></span><span class="money">${bal[x.id] > 0 ? '+' : ''}${M.fmt(bal[x.id])}</span></li>`).join('')}</ul></div>
    ${p === 'on_trip' && S.booking && stayBal > 0 && !stayLogged ? `<button class="btn ghost" data-act="log-stay">Log the villa balance paid at check-in (${M.fmt(stayBal)})</button>` : ''}
    <div class="sec"><h4>Expenses</h4>
      <ul class="list">${S.expenses.map(e => `<li><span class="grow">${esc(e.label)}<br><span class="sub">${who(e.paidBy)} paid · split ${e.among.length} ways</span></span><span class="money">${M.fmt(e.amount)}</span>${e.source !== 'advance' && M.eventAllowed(S, 'REMOVE_EXPENSE') && (org || e.paidBy === S.viewer) ? `<button class="x" data-act="rm-exp" data-id="${e.id}" aria-label="Remove ${esc(e.label)}">×</button>` : ''}</li>`).join('') || '<li class="sub">No expenses yet.</li>'}</ul></div>
    ${M.eventAllowed(S, 'ADD_EXPENSE') ? `<div class="sec"><h4>Add an expense</h4>
      <form class="card" data-form="expense">
        <div class="grid2"><label class="f">What for<input type="text" id="f-exp-label" name="label" maxlength="60" placeholder="e.g. Dinner"></label>
        <label class="f">Amount ₹<input type="text" id="f-exp-amt" name="amount" inputmode="numeric"></label>
        <label class="f" style="grid-column:1/-1">Paid by<select class="in" id="f-exp-paid" name="paidBy">${g.map(x => `<option value="${x.id}" ${x.id === S.viewer ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label></div>
        <span class="sub">Split among</span>
        <div class="checks">${g.map(x => `<label><input type="checkbox" name="among" value="${x.id}" checked>${esc(x.name)}</label>`).join('')}</div>
        <button class="btn ghost sm">Add expense</button></form></div>` : ''}
    ${['settling', 'closed'].includes(p) ? `<div class="sec"><h4>Wrap up</h4>
      <form class="card" data-form="album"><label class="f">Shared album link<input type="url" id="f-album" name="url" value="${esc(S.album)}" placeholder="https://photos.app.goo.gl/…"></label>
        <div class="row"><button class="btn ghost sm">Save link</button>${S.album ? ext(S.album, 'Open album') : ''}</div>
        <span class="sub">Make the album in Google Photos and paste its link. Apps can’t create shared albums any more.</span></form>
      <div class="card"><span>How was it? <span class="sub">${pulse.length ? `${pulse.length} rated · avg ${(pulse.reduce((a, b) => a + b, 0) / pulse.length).toFixed(1)}` : 'No ratings yet'}</span></span>
        <div class="chips">${[1, 2, 3, 4, 5].map(n => `<button class="chip" data-act="rate" data-n="${n}" aria-pressed="${S.pulse[S.viewer] === n}">${n}</button>`).join('')}</div></div>
      ${org && p === 'settling' ? `${M.blockedReason(S, 'CLOSE') ? `<p class="sub">${esc(M.blockedReason(S, 'CLOSE'))}</p>` : ''}<button class="btn" data-act="close" ${M.blockedReason(S, 'CLOSE') ? 'disabled' : ''}>Close the trip</button>` : ''}
      ${org && p === 'closed' ? '<button class="btn go" data-act="plan-again">Plan the next one with this group</button>' : ''}
    </div>` : ''}`;
}

// ---------- sheet ----------
function sheetHTML() {
  const sh = ui.sheet;
  return `<div class="scrim" data-act="sheet-cancel"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" data-stop="1">
    <h2 id="sheet-title" style="font-size:20px">${esc(sh.title)}</h2><p class="sub">${esc(sh.body)}</p>${sh.extra || ''}
    <div class="grid2"><button class="btn ghost" data-act="sheet-cancel">Not now</button><button class="btn ${sh.danger ? 'warn' : 'go'}" id="sheet-ok" data-act="sheet-ok">${esc(sh.ok)}</button></div></div></div>`;
}
function openSheet(s) { ui.sheet = s; renderFrame(); }

// ---------- rail ----------
function renderRail() {
  const rail = document.getElementById('rail'); if (!rail) return;
  const r = M.tripRange(S), cur = S.phase;
  const reply = ['committing', 'ready_to_book'].includes(cur) ? nextScriptedReply(S) : null;
  const jumps = [];
  if (cur === 'committing') jumps.push(['past-deadline', 'Past the deadline']);
  if (cur === 'booked' && r) jumps.push(['trip-day', 'Morning of day 1']);
  if (cur === 'on_trip' && r) jumps.push(['trip-end', 'Last evening']);
  const keys = Object.keys(PRESETS);
  rail.innerHTML = `
    <ol class="steps">${keys.map((k, i) => `<li><button data-act="preset" data-k="${k}" ${ui.preset === k ? 'aria-current="step"' : ''}><span class="n">0${i + 1}</span><span><span class="t">${esc(PRESETS[k].label)}</span><span class="d">${esc(STORY[k] || PRESETS[k].note)}</span></span></button></li>`).join('')}</ol>
    <div class="demo"><span class="lbl">Demo controls · <span class="money">${esc(M.fmtWhen(S.clock))}</span></span>
      <div class="btns">
        ${reply ? `<button class="btn ghost sm" data-act="sim-reply">Next friend replies</button>` : ''}
        ${jumps.map(([k, l]) => `<button class="btn ghost sm" data-act="jump" data-k="${k}">${l}</button>`).join('')}
        <button class="btn ghost sm" data-act="clock" data-h="3">+3 hours</button>
        <button class="btn ghost sm" data-act="clock" data-h="24">+1 day</button>
        <button class="btn ghost sm" data-act="reset">Reset</button>
      </div>
      <span class="note">Switch who you are with the name at the top of the phone.</span>
    </div>
    <details class="more"><summary>Under the hood</summary>
      <div class="path" aria-label="Trip lifecycle">${PATH.map((ph, i) => `${i ? '<i aria-hidden="true">›</i>' : ''}<span class="${ph === cur ? 'now' : idx(cur) > i && cur !== 'cancelled' ? 'done' : ''}">${esc(M.PHASE_LABEL[ph])}</span>`).join('')}${['failed', 'cancelled'].includes(cur) ? `<i aria-hidden="true">·</i><span class="off now">${esc(M.PHASE_LABEL[cur])}</span>` : ''}</div>
      ${ui.last ? `<p><b>Last change:</b> ${esc(ui.last.summary || '')}</p>${ui.last.effects.length ? `<ul class="fx">${ui.last.effects.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}` : ''}
      <ul class="integ">${I.INTEGRATIONS.map(x => `<li><span class="cls ${x.live ? 'on' : ''}">${x.live ? 'on' : 'off'}</span><span>${esc(x.name)}</span><small>${esc(x.how)}</small></li>`).join('')}</ul>
    </details>
    <p class="note rule">Everything is simulated and saved only in this browser. No real bookings, messages or payments.</p>`;
}

// ---------- actions ----------
const ACTIONS = {
  tab: d => { ui.tab = d.tab; ui.logItem = null; renderFrame(); document.getElementById('view')?.focus?.(); },
  preset: d => loadPreset(d.k),
  reset: () => loadPreset(ui.preset),
  'sim-reply': () => { const ev = nextScriptedReply(S); if (ev) act(ev, `${M.person(S, ev.id).name} ${ev.answer === 'in' ? 'committed' : 'is out'}`); },
  clock: d => act({ type: 'SET_CLOCK', clock: M.addHoursISO(S.clock, Number(d.h)) }),
  jump: d => {
    const r = M.tripRange(S);
    const to = d.k === 'past-deadline' ? M.addHoursISO(S.pact.deadline, 1) : d.k === 'trip-day' ? M.isoAt(r.start, '09:00') : M.isoAt(M.addDays(r.end, -1), '20:00');
    act({ type: 'SET_CLOCK', clock: to });
  },
  viewas: d => act({ type: 'SET_VIEWER', id: d.id }, `You’re now viewing as ${M.person(S, d.id).name}`),
  invite: () => { if (act({ type: 'INVITE' }, 'Invite ready. Share it in your group.')) { ui.tab = 'align'; renderFrame(); } },
  avail: d => act({ type: 'SET_AVAIL', id: S.viewer, option: d.opt, value: d.v === '1' }),
  choose: d => act({ type: 'CHOOSE_DATES', option: d.opt }, 'Dates chosen'),
  'clear-budget': () => act({ type: 'SET_BUDGET', id: S.viewer, value: null }),
  copy: d => { const done = () => toast('Copied'); try { navigator.clipboard.writeText(d.text).then(done, () => toast('Copy was blocked here. Select the text in WhatsApp instead.', true)); } catch (e) { toast('Copy isn’t available here.', true); } },
  need: d => { ui.pact.need += Number(d.d); renderFrame(); },
  'pact-day': d => { ui.pact.day = Number(d.d); renderFrame(); },
  'open-pact': () => { const pc = ui.pact; const deadline = M.isoAt(M.addDays(M.ymdInIST(S.clock), pc.day), '18:00'); if (act({ type: 'OPEN_PACT', need: pc.need, deadline, rule: pc.rule }, 'Pact is open. Share it in the group.')) { ui.pact = null; } },
  respond: d => act({ type: 'RESPOND', id: S.viewer, answer: d.a }, d.a === 'in' ? 'You’re in. You’ll only pay if the line is reached.' : 'Noted. No hard feelings, no follow-up.'),
  nudge: () => act({ type: 'NUDGE' }, 'Reminder sent from Pakka, not from you (simulated).'),
  revise: d => { const deadline = M.isoAt(M.addDays(M.ymdInIST(S.clock), 2), '18:00'); act({ type: 'REVISE_PACT', need: Number(d.need), deadline }, 'Pact revised'); },
  cancel: () => openSheet({ title: 'Call the plan off?', body: 'No money has moved, so nobody owes anything. Everyone sees that the plan is off.', ok: 'Call it off', danger: true, run: () => act({ type: 'CANCEL' }) }),
  withdraw: () => {
    let body;
    if (!S.booking) body = 'No money has moved yet, so pulling out costs nothing. The count drops by one' + (S.phase === 'ready_to_book' ? ', and booking locks again if the group falls under the line.' : '.');
    else { const adv = S.expenses.find(e => e.source === 'advance'); const share = M.expenseShares(adv)[S.viewer] || 0; body = S.pact.rule === 'absorb' ? `The advance is already paid. By the rule the group agreed, your ${M.fmt(share)} share moves to the ${adv.among.length - 1} still going.` : `The advance is already paid. By the rule the group agreed, you still owe ${M.fmt(share)} unless someone takes your spot.`; }
    openSheet({ title: 'Pull out of the trip?', body, ok: 'Pull out', danger: true, run: () => act({ type: 'WITHDRAW', id: S.viewer }, 'You’ve pulled out') });
  },
  'mark-paid': d => act({ type: 'RECORD_PAYMENT', from: d.from, to: d.to, amount: Number(d.amount) }, 'Marked as paid'),
  'i-paid': d => openSheet({ title: `Paid ${M.person(S, d.to).name} ${M.fmt(Number(d.amount))}?`, body: 'Only confirm once the UPI payment went through in your app. Pakka can’t see your bank.', ok: 'Yes, I’ve paid', extra: '<label class="f">UPI reference (optional)<input type="text" id="f-utr" maxlength="30" placeholder="Last 4 digits are enough"></label>', run: () => act({ type: 'RECORD_PAYMENT', from: S.viewer, to: d.to, amount: Number(d.amount), ref: document.getElementById('f-utr')?.value || '' }, 'Thanks. Marked as paid.') }),
  'change-dates': d => { const o = S.dates.options.find(x => x.id === d.opt); openSheet({ title: `Move to ${M.fmtDay(o.start)}?`, body: `The booking will be flagged until the host confirms the new dates, and any plan items beyond ${o.nights + 1} days get flagged.`, ok: 'Move the dates', run: () => act({ type: 'CHOOSE_DATES', option: d.opt }) }); },
  'call-off': () => openSheet({ title: 'Call the trip off after booking?', body: 'The advance stays split by the rule the group agreed. The trip moves to settling so everyone can square up.', ok: 'Call it off', danger: true, run: () => { if (act({ type: 'CALL_OFF' })) { ui.tab = 'money'; renderFrame(); } } }),
  'start-trip': () => { if (act({ type: 'START_TRIP' }, 'Have a great trip')) { ui.tab = 'plan'; renderFrame(); } },
  'end-trip': () => openSheet({ title: 'End the trip?', body: 'You can still add expenses afterwards. Settle-up starts now.', ok: 'End the trip', run: () => { if (act({ type: 'END_TRIP' })) { ui.tab = 'money'; renderFrame(); } } }),
  'rm-item': d => act({ type: 'REMOVE_ITEM', id: d.id }),
  'log-item': d => { ui.logItem = d.id || null; renderFrame(); },
  'log-stay': () => { const g = going().map(x => x.id); act({ type: 'ADD_EXPENSE', label: 'Villa balance at check-in', amount: S.costs.stayTotal - S.booking.amountPaid, paidBy: S.viewer, among: g, source: 'stay-balance' }, 'Logged'); },
  'rm-exp': d => act({ type: 'REMOVE_EXPENSE', id: d.id }),
  rate: d => act({ type: 'RATE', id: S.viewer, score: Number(d.n) }, 'Thanks'),
  close: () => act({ type: 'CLOSE' }, 'Trip closed'),
  'plan-again': () => { S = M.planAgain(S); ui.tab = 'align'; ui.last = { summary: S.log[0].summary, effects: S.log[0].effects }; save(); render(); toast('New plan started with the same group'); },
  'sheet-ok': () => { const s = ui.sheet; const run = s?.run; ui.sheet = null; if (run) { if (run() === false) renderFrame(); } else renderFrame(); },
  'sheet-cancel': (d, el, e) => { if (e && e.target.closest('[data-stop]') && !e.target.closest('[data-act="sheet-cancel"]:not(.scrim)')) return; ui.sheet = null; renderFrame(); }
};

const FORMS = {
  trip: f => act({ type: 'SET_TRIP', name: f.get('name'), destination: f.get('destination') }, 'Saved'),
  person: (f, el) => { if (act({ type: 'ADD_PERSON', name: f.get('name') })) document.getElementById('f-person')?.focus(); },
  date: f => act({ type: 'ADD_DATE_OPTION', start: f.get('start'), nights: Number(f.get('nights')) }),
  costs: f => {
    const c = {}; for (const k of ['stayTotal', 'advance', 'transportPP', 'foodPPPerDay']) { c[k] = parseRs(f.get(k)); if (Number.isNaN(c[k])) return toast('Enter costs as whole rupee amounts.', true); }
    if (S.booking) delete c.advance;
    act({ type: 'SET_COSTS', costs: c }, 'Costs updated');
  },
  budget: f => { const v = String(f.get('budget') || '').trim(); act({ type: 'SET_BUDGET', id: S.viewer, value: v ? parseRs(v) : null }, v ? 'Saved privately' : 'Cleared'); },
  booking: f => {
    const amt = parseRs(f.get('amountPaid'));
    if (Number.isNaN(amt)) return toast('Enter what you paid, in rupees.', true);
    if (act({ type: 'CONFIRM_BOOKING', provider: f.get('provider'), reference: f.get('reference'), amountPaid: amt, paidBy: f.get('paidBy'), cancelBy: f.get('cancelBy') }, 'Booking recorded. Shares are out.')) { ui.tab = 'book'; renderFrame(); }
  },
  recheck: f => act({ type: 'RECHECK_BOOKING', reference: f.get('reference') }, 'Booking re-confirmed'),
  replace: (f, el) => act({ type: 'REPLACE', id: el.dataset.id, name: f.get('name') }),
  item: f => { const raw = String(f.get('costPP') || '').trim(); const c = raw ? parseRs(raw) : 0; if (Number.isNaN(c)) return toast('Enter the cost in whole rupees.', true); act({ type: 'ADD_ITEM', day: Number(f.get('day')), start: f.get('start'), end: f.get('end'), title: f.get('title'), place: f.get('place'), costPP: c }, 'Added to the plan'); },
  logitem: (f, el) => { if (act({ type: 'LOG_ITEM_EXPENSE', id: el.dataset.id, paidBy: f.get('paidBy'), among: f.getAll('among') }, 'Logged')) ui.logItem = null; },
  expense: f => { const a = parseRs(f.get('amount')); if (Number.isNaN(a)) return toast('Enter the amount in whole rupees.', true); act({ type: 'ADD_EXPENSE', label: f.get('label'), amount: a, paidBy: f.get('paidBy'), among: f.getAll('among') }, 'Expense added'); },
  album: f => act({ type: 'SET_ALBUM', url: f.get('url') }, 'Saved')
};

const CHANGES = {
  viewer: el => act({ type: 'SET_VIEWER', id: el.value }, `You’re now viewing as ${M.person(S, el.value).name}`),
  rule: el => { ui.pact.rule = el.value; }
};

// ---------- boot ----------
function boot() {
  const app = document.getElementById('app');
  app.innerHTML = '<div class="frame" id="frame" style="display:flex;flex-direction:column;flex:1;min-height:0"></div><div class="toast" id="toast" role="status" aria-live="polite"></div>';
  const saved = load();
  if (saved && !saved.bad) { S = saved.s; ui.tab = saved.tab || 'home'; ui.preset = saved.preset || DEFAULT_PRESET; }
  else S = PRESETS[DEFAULT_PRESET].build();
  const h = (location.hash || '').slice(1);
  if (TABS.some(t => t[0] === h)) ui.tab = h;
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-act]'); if (!t) return;
    if (t.classList.contains('scrim') && e.target !== t) return;   // clicks inside the sheet don't close it
    const fn = ACTIONS[t.dataset.act]; if (!fn) return;
    e.preventDefault(); fn(t.dataset, t, e);
  });
  document.addEventListener('submit', e => { const f = e.target.closest('form[data-form]'); if (!f) return; e.preventDefault(); FORMS[f.dataset.form](new FormData(f), f); });
  document.addEventListener('change', e => { const t = e.target.closest('[data-change]'); if (t) CHANGES[t.dataset.change](t); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && ui.sheet) { ui.sheet = null; renderFrame(); } });
  render();
  if (saved && saved.bad) toast('Saved demo data couldn’t be read, so the demo was reset.', true);
}
boot();
