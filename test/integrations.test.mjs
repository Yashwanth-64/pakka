import test from 'node:test';
import assert from 'node:assert/strict';
import * as I from '../src/integrations.js';
import { PRESETS } from '../src/presets.js';

test('Maps URLs follow the documented api=1 format', () => {
  const u = new URL(I.mapsSearch('Raja’s Seat, Madikeri'));
  assert.equal(u.origin + u.pathname, 'https://www.google.com/maps/search/');
  assert.equal(u.searchParams.get('api'), '1');
  assert.equal(u.searchParams.get('query'), 'Raja’s Seat, Madikeri');
  const d = new URL(I.mapsDirections('Abbey Falls', 'transit'));
  assert.equal(d.searchParams.get('destination'), 'Abbey Falls');
  assert.equal(d.searchParams.get('travelmode'), 'transit');
  assert.ok(I.mapsSearch('x'.repeat(100)).length < 2048);
});

test('WhatsApp link carries the text and no phone number', () => {
  const u = new URL(I.waShare('In or out? 6 of 8 by Wed & nobody pays first'));
  assert.equal(u.host, 'wa.me'); assert.equal(u.pathname, '/');
  assert.equal(u.searchParams.get('text'), 'In or out? 6 of 8 by Wed & nobody pays first');
});

test('Calendar template is all-day with an exclusive end date', () => {
  const s = PRESETS.booked.build();
  const u = new URL(I.tripCalendarLink(s));
  assert.equal(u.searchParams.get('action'), 'TEMPLATE');
  assert.equal(u.searchParams.get('dates'), '20261113/20261117'); // 13–16 Nov inclusive
  assert.match(u.searchParams.get('details'), /HMX4K2T9Q/);
});

test('stay search links carry dates and headcount', () => {
  const s = PRESETS.booked.build();
  const [a, b] = I.staySearchLinks(s).map(l => new URL(l.href));
  assert.equal(a.searchParams.get('checkin'), '2026-11-13');
  assert.equal(a.searchParams.get('checkout'), '2026-11-16');
  assert.equal(a.searchParams.get('adults'), '6');
  assert.equal(b.searchParams.get('group_adults'), '6');
});

test('integration registry covers every class and marks off-build ones', () => {
  assert.ok(I.INTEGRATIONS.every(i => [1, 2, 3, 4, 5].includes(i.cls)));
  assert.ok(I.INTEGRATIONS.some(i => !i.live));
});
