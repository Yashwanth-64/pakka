// Integration adapters. Every external action is a link-out the person completes
// themselves; nothing here reports an external action as done.
// Status of each integration lives in INTEGRATIONS so the UI and docs agree.
import { addDays, fmt, fmtDay, tripRange, committed } from './model.js';

export const INTEGRATIONS = [
  { id: 'whatsapp', name: 'WhatsApp share', cls: 1, how: 'wa.me/?text= link (official click-to-chat). You pick the group; Pakka never posts for you.', live: true },
  { id: 'maps', name: 'Google Maps', cls: 1, how: 'Maps URLs with api=1 (official, no key).', live: true },
  { id: 'calendar', name: 'Google Calendar', cls: 1, how: 'Event template link (works, but undocumented by Google). The Calendar API would need Google sign-in.', live: true },
  { id: 'stays', name: 'Airbnb / Booking.com search', cls: 4, how: 'Search links with dates and guests (URL formats are undocumented). Airbnb has no open API or affiliate programme; Booking.com data needs a managed partnership. The booking is recorded by hand.', live: true },
  { id: 'upi', name: 'UPI payment', cls: 3, how: 'Friend-to-friend collect requests stopped on 1 Oct 2025, so friends pay the organiser directly in any UPI app and mark it paid. Holding money (UPI Reserve Pay) is merchant-only and needs a licensed partner.', live: true },
  { id: 'photos', name: 'Google Photos album', cls: 4, how: 'Paste a shared-album link. Apps lost shared-album access in March 2025.', live: true },
  { id: 'weather', name: 'Weather', cls: 3, how: 'Not in this build: needs a server proxy and a commercial licence (Open-Meteo free tier is non-commercial).', live: false },
  { id: 'splitwise', name: 'Splitwise', cls: 3, how: 'Not needed: Pakka keeps one ledger. Splitwise asks commercial apps to contact them.', live: false }
];

const enc = encodeURIComponent;
const ymd = d => d.replaceAll('-', '');

export function waShare(text) {
  return 'https://wa.me/?text=' + enc(text);
}
export function mapsSearch(query) {
  return 'https://www.google.com/maps/search/?api=1&query=' + enc(query) + '&utm_source=pakka';
}
export function mapsDirections(destination, mode = 'driving') {
  return 'https://www.google.com/maps/dir/?api=1&destination=' + enc(destination) + '&travelmode=' + mode + '&utm_source=pakka';
}
// All-day event: end date is exclusive (the day after the last day).
export function calendarTemplate({ title, start, endExclusive, details = '', location = '' }) {
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE'
    + '&text=' + enc(title)
    + '&dates=' + ymd(start) + '/' + ymd(endExclusive)
    + '&details=' + enc(details)
    + '&location=' + enc(location);
}
export function airbnbSearch({ place, checkin, checkout, adults }) {
  return 'https://www.airbnb.co.in/s/' + enc(place) + '/homes?checkin=' + checkin + '&checkout=' + checkout + '&adults=' + adults;
}
export function bookingSearch({ place, checkin, checkout, adults }) {
  return 'https://www.booking.com/searchresults.html?ss=' + enc(place) + '&checkin=' + checkin + '&checkout=' + checkout + '&group_adults=' + adults + '&no_rooms=' + Math.max(1, Math.ceil(adults / 2));
}

// Trip-level helpers that read the shared model.
export function tripCalendarLink(s) {
  const r = tripRange(s); if (!r) return null;
  const going = committed(s).map(p => p.name).join(', ');
  const ref = s.booking ? `Booking ${s.booking.reference} (${s.booking.provider}). ` : '';
  return calendarTemplate({ title: s.trip.name, start: r.start, endExclusive: addDays(r.end, 1), details: `${ref}Going: ${going}. Planned in Pakka.`, location: s.trip.destination });
}
export function staySearchLinks(s) {
  const r = tripRange(s); if (!r) return [];
  const q = { place: s.trip.destination, checkin: r.start, checkout: r.end, adults: Math.max(committed(s).length, 1) };
  return [{ label: 'Airbnb', href: airbnbSearch(q) }, { label: 'Booking.com', href: bookingSearch(q) }];
}
export function inviteMessage(s) {
  const r = tripRange(s);
  if (s.pact && ['committing', 'failed', 'ready_to_book'].includes(s.phase)) {
    return `${s.trip.name} happens only if ${s.pact.need} of us commit. Nobody pays unless we hit ${s.pact.need}. In or out on Pakka 👇`;
  }
  return `Planning ${s.trip.name} (${s.trip.destination}). Mark the dates you can make and a private budget on Pakka. Nobody sees your number 👇`;
}
export function shareRequestMessage(s, from, amount) {
  return `Hi ${from}, your share of the ${s.trip.name} stay advance is ${fmt(amount)}. Pay via any UPI app and tap "I've paid" on Pakka.`;
}
export function dayLabel(s, day) {
  const r = tripRange(s); if (!r) return `Day ${day}`;
  return `Day ${day} · ${fmtDay(addDays(r.start, day - 1))}`;
}
