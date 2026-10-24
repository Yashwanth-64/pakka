// Bundles src/ into one self-contained HTML page (the Artifact host allows no local imports).
// Each ES module becomes an IIFE namespace; named imports become destructuring.
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, copyFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const src = f => readFileSync(new URL('./src/' + f, import.meta.url), 'utf8');
const NS = { './model.js': 'M', './presets.js': 'P', './integrations.js': 'I' };

function wrap(file, ns) {
  let code = src(file);
  const names = new Set();
  code = code.replace(/^import \* as (\w+) from '([^']+)';\n/gm, (_, alias, from) => (alias === NS[from] ? '' : `const ${alias} = ${NS[from]};\n`));
  code = code.replace(/^import \{([^}]+)\} from '([^']+)';\n/gm, (_, list, from) => `const {${list}} = ${NS[from]};\n`);
  code = code.replace(/^export \{([^}]+)\};?\n/gm, (_, list) => { list.split(',').map(x => x.trim()).filter(Boolean).forEach(n => names.add(n)); return ''; });
  code = code.replace(/^export (const|function|let) (\w+)/gm, (_, kw, n) => { names.add(n); return `${kw} ${n}`; });
  if (/^\s*(import|export)\s/m.test(code)) throw new Error(`unhandled import/export in ${file}`);
  if (!ns) return code;
  return `const ${ns} = (() => {\n${code}\nreturn { ${[...names].join(', ')} };\n})();\n`;
}

const js = [wrap('model.js', 'M'), wrap('integrations.js', 'I'), wrap('presets.js', 'P'), wrap('app.js', null)].join('\n');
if (js.includes('</script')) throw new Error('script contains a closing script tag');
const html = src('index.html').replace('/*@STYLES@*/', () => src('styles.css')).replace('/*@SCRIPT@*/', () => js);
mkdirSync(new URL('./dist/', import.meta.url), { recursive: true });
writeFileSync(new URL('./dist/pakka.html', import.meta.url), html);

// site/: the same page as a full standalone document for static hosting (GitHub Pages), plus
// what a phone needs to install it from the browser: manifest, icons and an offline worker.
const split = html.indexOf('<div class="wrap">');
if (split < 0) throw new Error('index.html is missing the .wrap root');
const head = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#FF5E3A">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="icon-192.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Pakka">
<script>if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));</script>
`;
const site = `<!doctype html>\n<html lang="en">\n<head>\n${head}${html.slice(0, split).trim()}\n</head>\n<body>\n${html.slice(split)}</body>\n</html>\n`;
rmSync(new URL('./site/', import.meta.url), { recursive: true, force: true });
mkdirSync(new URL('./site/', import.meta.url), { recursive: true });
writeFileSync(new URL('./site/index.html', import.meta.url), site);
for (const f of readdirSync(new URL('./public/', import.meta.url))) copyFileSync(new URL('./public/' + f, import.meta.url), new URL('./site/' + f, import.meta.url));

const kb = b => (b / 1024).toFixed(1) + ' KB';
const jsGz = gzipSync(js).length, totalGz = gzipSync(html).length;
console.log(`dist/pakka.html  ${kb(html.length)} raw · ${kb(totalGz)} gzip · JS ${kb(jsGz)} gzip`);
console.log(`site/index.html  + ${readdirSync(new URL('./public/', import.meta.url)).length} app files`);
const BUDGET = 80 * 1024; // senior-frontend profile: low-JS mobile-4G, 80 KB gzip per route
if (jsGz > BUDGET) { console.error(`JS over budget: ${kb(jsGz)} > ${kb(BUDGET)}`); process.exit(1); }
