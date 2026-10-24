// Writes each preset (plus the app's own derived numbers) to JSON for the SQL cross-check.
import { mkdirSync, writeFileSync } from 'node:fs';
import { PRESETS } from '../src/presets.js';
import * as M from '../src/model.js';

mkdirSync(new URL('./fixtures/', import.meta.url), { recursive: true });
for (const [key, p] of Object.entries(PRESETS)) {
  const s = p.build();
  const out = {
    state: s,
    expected: {
      balances: M.balances(s),
      shares: Object.fromEntries(s.expenses.map(e => [e.id, M.expenseShares(e)])),
      committed: M.committed(s).length,
      pending: M.pending(s).length,
      budgetFit: M.budgetFit(s),
      dateTally: M.dateTally(s).map(o => ({ id: o.id, yes: o.yes.length }))
    }
  };
  writeFileSync(new URL(`./fixtures/${key}.json`, import.meta.url), JSON.stringify(out, null, 1));
}
console.log('fixtures written:', Object.keys(PRESETS).join(', '));
