// Captures App Store screenshots at exact iPhone 6.9" spec (1290x2796) by driving
// a headless Chrome over the DevTools Protocol (Node 22 has a built-in WebSocket,
// so no npm install). Navigates the marketplace SPA by clicking its bottom-nav
// buttons, since the tabs are React state with no distinct URLs.
//
// Run the dev server first (localhost:3000), then: node scripts/capture-appstore-shots.mjs

import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import http from 'node:http';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9222;
const APP = 'http://localhost:3000';
const OUT = 'C:/Users/brand/Downloads/cardstreet-tcg/appstore-screenshots';
const PROFILE = 'C:/Users/brand/Downloads/cardstreet-tcg/.chrome-shotprofile';

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJSON = (path) =>
  new Promise((res, rej) => {
    http.get(`http://127.0.0.1:${PORT}${path}`, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => res(JSON.parse(d)));
    }).on('error', rej);
  });

const chrome = spawn(
  CHROME,
  ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, 'about:blank'],
  { stdio: 'ignore' }
);

let target;
for (let i = 0; i < 40; i++) {
  try {
    const list = await getJSON('/json');
    target = list.find((t) => t.type === 'page');
    if (target?.webSocketDebuggerUrl) break;
  } catch {}
  await sleep(500);
}
if (!target) { console.error('Chrome did not expose a debugging target'); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
await new Promise((r) => ws.addEventListener('open', r));
const cmd = (method, params = {}) =>
  new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) =>
  (await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true })).result?.result?.value;
const shot = async (name) => {
  // Hide the Next.js dev-mode indicator (the "N" badge) — dev-only, not in production.
  await evaluate(`(()=>{let s=document.getElementById('__hide_next_dev');if(!s){s=document.createElement('style');s.id='__hide_next_dev';s.textContent='nextjs-portal,#__next-build-watcher,[data-nextjs-toast],[data-next-badge-root],[data-nextjs-dev-tools-button]{display:none!important}';document.head.appendChild(s);}return true;})()`).catch(() => {});
  await sleep(300);
  const r = await cmd('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}/${name}`, Buffer.from(r.result.data, 'base64'));
  console.log('saved', name);
};

await cmd('Page.enable');
await cmd('Runtime.enable');

// Device slots: [name, cssWidth, cssHeight, scale] -> output = w*scale x h*scale.
const DEVICES = [
  ['iphone69', 430, 932, 3], // 1290 x 2796 (App Store 6.9" iPhone)
  ['iphone65', 428, 926, 3], // 1284 x 2778 (App Store 6.5" iPhone)
  ['ipad', 1024, 1366, 2],   // 2048 x 2732 (App Store 12.9"/13" iPad)
];
const setMetrics = async (w, h, s) => {
  await cmd('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: s, mobile: true });
  await sleep(1500); // let the responsive layout settle
};
const pollCards = (budget) =>
  evaluate(`new Promise(res=>{const re=/supabase|pokemontcg|tcgdex|pokemon-card|cloudinary|pokedata/;const start=Date.now();const iv=setInterval(()=>{const c=[...document.querySelectorAll('img')].filter(i=>re.test(i.currentSrc||i.src||''));if(c.length>=3||Date.now()-start>${budget}){clearInterval(iv);res('cards:'+c.length);}},800);})`);

// Load ONCE (data fetch happens a single time), then re-capture per device by only
// changing the emulated metrics — avoids the flaky per-set re-navigation/re-fetch.
await setMetrics(430, 932, 3);
await cmd('Page.navigate', { url: APP });
await sleep(3000);
console.log('market load ->', await pollCards(70000));

// Market screen at each device size.
for (const [name, w, h, s] of DEVICES) {
  await setMetrics(w, h, s);
  await shot(`${name}-01-market.png`);
}

// Open a card detail once (still on the market screen), then capture at each size.
await evaluate(`(()=>{const re=/supabase|pokemontcg|tcgdex|pokemon-card|cloudinary|pokedata/;const imgs=[...document.querySelectorAll('img')].filter(i=>re.test(i.currentSrc||i.src||''));if(imgs[0]){imgs[0].click();return true;}return false;})()`);
await sleep(4000);
console.log('on detail ->', await evaluate(`/LISTING DETAILS|ASKING PRICE|BUY NOW|ราคา/i.test(document.body.innerText)`));
for (const [name, w, h, s] of DEVICES) {
  await setMetrics(w, h, s);
  await shot(`${name}-03-card-detail.png`);
}

ws.close(); chrome.kill(); console.log('all done'); process.exit(0);
