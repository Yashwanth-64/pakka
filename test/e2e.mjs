// End-to-end journeys in headless Chromium against the built single-file app.
import { createRequire } from 'node:module';
const require = createRequire((process.env.NODE_PATH || '/opt/npm-tools/node_modules') + '/');
const { chromium } = require('playwright');
import { readFileSync, mkdirSync } from 'node:fs';

const HTML = readFileSync(new URL('../dist/pakka.html', import.meta.url), 'utf8');
const URL_ = 'https://pakka.test/';
const OUT = new URL('../test-results/', import.meta.url); mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail && !ok ? ' — ' + detail : ''}`); };

const browser = await chromium.launch();
async function newPage(viewport = { width: 1280, height: 900 }, colorScheme = 'light') {
  const ctx = await browser.newContext({ viewport, colorScheme });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); }); // fonts are blocked on purpose in the harness
  await page.route('**/*', r => r.request().url() === URL_ ? r.fulfill({ body: HTML, contentType: 'text/html; charset=utf-8' }) : r.abort());
  await page.goto(URL_);
  return { page, errors, ctx };
}
const phase = page => page.locator('.title .phase').innerText();
const tab = (page, name) => page.locator('.tabs .tab', { hasText: name }).click();
const preset = (page, label) => page.locator('.rail .steps button', { hasText: label }).click();
const viewAs = (page, name) => page.selectOption('#viewer', { label: name }).catch(() => page.selectOption('#viewer', { label: name + ' (organiser)' }));
const toastText = page => page.locator('#toast').innerText();
const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

try {
  // 1. Load + layout on desktop and phone
  for (const [label, vp] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    const { page, errors, ctx } = await newPage(vp);
    check(`${label}: renders default scenario`, (await phase(page)) .toLowerCase().includes('pact open'));
    check(`${label}: no horizontal overflow`, (await overflow(page)) <= 0, `overflow ${await overflow(page)}px`);
    for (const t of ['Commit', 'Book', 'Plan', 'Money']) { await tab(page, t); if ((await overflow(page)) > 0) check(`${label}: ${t} overflows`, false); }
    await tab(page, 'Commit');
    await page.screenshot({ path: new URL(`${label}-commit.png`, OUT).pathname, fullPage: label === 'phone' });
    check(`${label}: no console errors`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // 2. Core moment: friends commit, threshold unlocks booking, booking recorded by hand
  {
    const { page, errors, ctx } = await newPage();
    await tab(page, 'Book');
    check('book locked under the line', await page.getByText('isn’t open yet').isVisible());
    await tab(page, 'Commit');
    await viewAs(page, 'Rohan');
    await page.getByRole('button', { name: 'I’m committing' }).click();
    check('commit increments count', (await page.locator('.meter .count').innerText()).startsWith('5'));
    await viewAs(page, 'Dev');
    await page.getByRole('button', { name: 'I’m committing' }).click();
    check('threshold met shows It’s pakka', await page.locator('.banner.go').first().isVisible());
    check('phase is ready to book', (await phase(page)).toLowerCase().includes('ready'));
    await viewAs(page, 'Yash');
    await tab(page, 'Book');
    const links = await page.locator('a.ext').evaluateAll(as => as.map(a => [a.href, a.target]));
    check('stay search links carry dates and open in new tab', links.some(([h, t]) => h.includes('checkin=2026-11-13') && t === '_blank'));
    await page.getByRole('button', { name: 'Record booking' }).click();
    check('booking without reference is refused', (await toastText(page)).includes('reference') && (await phase(page)).toLowerCase().includes('ready'));
    await page.fill('#f-ref', 'VH-22931');
    await page.getByRole('button', { name: 'Record booking' }).click();
    check('booking recorded moves to Booked', (await phase(page)).toLowerCase() === 'booked');
    check('advance shares requested (5 owe)', (await page.getByText(/^Owes ₹2,000$/).count()) === 5);
    const cal = await page.locator('a.ext', { hasText: 'Add to Google Calendar' }).getAttribute('href');
    check('calendar link is a TEMPLATE with exclusive end', cal.includes('action=TEMPLATE') && cal.includes('dates=20261113%2F20261117') || cal.includes('dates=20261113/20261117'));
    await page.locator('button', { hasText: 'Received' }).first().click();
    check('marking a share received updates status', (await page.getByText(/^Owes ₹2,000$/).count()) === 4);
    await page.reload();
    check('state survives reload', (await phase(page)).toLowerCase() === 'booked' && (await page.getByText(/^Owes ₹2,000$/).count()) === 4);
    check('core journey: no console errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // 3. Deadline passes below the line → recovery
  {
    const { page, ctx } = await newPage();
    await preset(page, 'Pact open');
    await page.getByRole('button', { name: 'Past the deadline' }).click();
    check('deadline expiry fails the pact', (await phase(page)).toLowerCase().includes('missed'));
    await tab(page, 'Commit');
    check('failure says nobody owes anything', await page.getByText('nobody owes anything').first().isVisible());
    await page.getByRole('button', { name: /Go with the 4/ }).click();
    check('revising to the 4 who said yes unlocks booking', (await phase(page)).toLowerCase().includes('ready'));
    await ctx.close();
  }

  // 4. Withdrawal after booking applies the agreed rule
  {
    const { page, ctx } = await newPage();
    await preset(page, 'Booked');
    await viewAs(page, 'Arjun');
    await tab(page, 'Commit');
    await page.getByRole('button', { name: 'I can’t come any more' }).click();
    const body = await page.locator('.sheet').innerText();
    check('withdraw sheet explains the agreed rule', body.includes('still owe ₹2,000'));
    await page.keyboard.press('Escape');
    check('Escape closes the sheet', (await page.locator('.sheet').count()) === 0);
    await page.getByRole('button', { name: 'I can’t come any more' }).click();
    await page.getByRole('button', { name: 'Pull out' }).click();
    check('withdrawal recorded', (await page.locator('.list li', { hasText: 'Arjun' }).innerText()).includes('Pulled out'));
    await viewAs(page, 'Yash');
    await tab(page, 'Commit');
    await page.fill('[id^="f-replace-"]', 'Zoya');
    await page.getByRole('button', { name: 'Take the spot' }).click();
    await tab(page, 'Money');
    check('replacement inherits the share', await page.locator('.list li', { hasText: 'Zoya' }).first().isVisible());
    await ctx.close();
  }

  // 5. Itinerary conflicts + date change propagation
  {
    const { page, ctx } = await newPage();
    await preset(page, 'Booked');
    await tab(page, 'Plan');
    await page.selectOption('#f-day', '2');
    await page.fill('#f-start', '11:00'); await page.fill('#f-end', '12:30'); await page.fill('#f-title', 'Late breakfast');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    check('overlapping item is flagged', (await page.locator('.item.clash').count()) >= 2);
    await page.selectOption('#f-day', '4');
    await page.fill('#f-start', '09:00'); await page.fill('#f-end', '08:00'); await page.fill('#f-title', 'Checkout');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    check('end-before-start is refused with a clear message', (await toastText(page)).includes('End time'));
    await page.fill('#f-end', '10:30');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await tab(page, 'Book');
    await page.getByRole('button', { name: /20 Nov, 2 nights/ }).click();
    await page.getByRole('button', { name: 'Move the dates' }).click();
    check('date change flags the booking', await page.locator('.banner.warn', { hasText: 'Re-confirm with the host' }).isVisible());
    await tab(page, 'Plan');
    check('item outside the new dates is flagged', (await page.locator('.item.outside').count()) === 1);
    check('trip start blocked until re-confirmed', await page.getByRole('button', { name: 'Start the trip' }).isDisabled());
    await tab(page, 'Book');
    await page.getByRole('button', { name: 'Host confirmed' }).click();
    await tab(page, 'Plan');
    check('start allowed after re-confirmation', await page.getByRole('button', { name: 'Start the trip' }).isEnabled());
    await ctx.close();
  }

  // 6. On the trip: log an itinerary cost, uneven split; then settle everyone and close
  {
    const { page, errors, ctx } = await newPage();
    await preset(page, 'On the trip');
    await tab(page, 'Plan');
    await page.getByRole('button', { name: 'Log cost' }).first().click();
    await page.locator('form[data-form="logitem"] input[type=checkbox]').nth(1).uncheck();
    await page.getByRole('button', { name: 'Log it' }).click();
    check('itinerary cost logged with uneven participation', (await page.locator('.pill', { hasText: 'Logged' }).count()) === 2);
    await tab(page, 'Money');
    await page.fill('#f-exp-label', 'Fuel'); await page.fill('#f-exp-amt', 'abc');
    await page.getByRole('button', { name: 'Add expense' }).click();
    check('invalid amount refused', (await toastText(page)).toLowerCase().includes('amount'));
    await tab(page, 'Plan');
    await page.getByRole('button', { name: 'End the trip and settle up' }).click();
    await page.getByRole('button', { name: 'End the trip', exact: true }).click();
    check('trip ended into settling', (await phase(page)).toLowerCase().includes('settling'));
    for (let i = 0; i < 20; i++) {
      const recv = page.locator('button', { hasText: 'Received' });
      if (await recv.count()) { await recv.first().click(); continue; }
      const paid = page.locator('button', { hasText: 'I’ve paid' });
      if (await paid.count()) { await paid.first().click(); await page.getByRole('button', { name: 'Yes, I’ve paid' }).click(); continue; }
      break;
    }
    check('everyone settled', await page.getByText('Everyone is settled.').isVisible());
    await page.getByRole('button', { name: 'Close the trip' }).click();
    check('trip closes only when settled', (await phase(page)).toLowerCase() === 'closed');
    await page.getByRole('button', { name: 'Plan the next one with this group' }).click();
    check('plan again starts a new draft with the group', (await phase(page)).toLowerCase() === 'draft');
    check('settle journey: no console errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // 7. Draft → aligning → pact, as the organiser, on a phone
  {
    const { page, errors, ctx } = await newPage({ width: 390, height: 844 });
    await preset(page, 'Fresh idea');
    await tab(page, 'Align');
    await page.fill('#f-person', 'Zoya'); await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.fill('#f-person', 'zoya'); await page.getByRole('button', { name: 'Add', exact: true }).click();
    check('duplicate name refused', (await toastText(page)).includes('already'));
    await page.fill('#f-person', '<img src=x onerror=1>'); await page.getByRole('button', { name: 'Add', exact: true }).click();
    check('names render as text, never as markup', (await page.locator('#view img').count()) === 0 && (await page.locator('.list', { hasText: '<img src=x onerror=1>' }).count()) === 1);
    await page.getByRole('button', { name: 'Share the invite' }).click();
    check('invite moves to aligning', (await phase(page)).toLowerCase() === 'aligning');
    await page.locator('[data-act="avail"][data-v="1"]').first().click();
    await page.fill('#f-budget', '11000'); await page.getByRole('button', { name: 'Save', exact: true }).click();
    check('budget saved privately', (await toastText(page)).includes('privately'));
    await tab(page, 'Commit');
    check('open pact disabled until dates chosen', await page.getByRole('button', { name: 'Open the pact' }).isDisabled());
    await tab(page, 'Align');
    await page.getByRole('button', { name: 'Choose' }).first().click();
    await tab(page, 'Commit');
    await page.getByRole('button', { name: 'Open the pact' }).click();
    check('pact opens', (await phase(page)).toLowerCase().includes('pact open'));
    check('draft journey: no overflow on phone', (await overflow(page)) <= 0);
    check('draft journey: no console errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // 8. Dark mode renders with a dark background
  {
    const { page, ctx } = await newPage({ width: 1280, height: 900 }, 'dark');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check('dark mode uses dark tokens', bg !== 'rgb(255, 255, 255)' && bg !== 'rgb(238, 241, 236)', bg);
    await page.screenshot({ path: new URL('desktop-dark-home.png', OUT).pathname });
    await ctx.close();
  }
} catch (e) {
  check('e2e run completed without crashing', false, e.message.split('\n')[0]);
} finally {
  await browser.close();
}
const failed = results.filter(r => !r.ok);
console.log(`\ne2e: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
