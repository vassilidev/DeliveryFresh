// Choix du menu par l'utilisateur sur une page HTML (2-3 propositions), décisions mémorisées dans memory/menus.json.
// CLI : node tools/menus.js <commande>
//   choose <menus.json>   ouvre la page, attend la validation, affiche le résultat JSON et l'enregistre
//   later                 menus mis de côté ("plus tard") pas encore repris -> à reproposer
//   history               toutes les décisions passées (choisis, refusés + raisons)
// menus.json : { title, options: [{ id, name, pitch, estimate, tags: [], meals: [{ when, title, desc, time, recipe? }] }] }
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'memory', 'menus.json');
const load = () => fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : [];
function save(h) { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(h, null, 1)); }

// Menus "plus tard" jamais choisis depuis (par nom).
function later(h = load()) {
  const chosen = new Set(h.filter(d => d.decision === 'chosen').map(d => d.name));
  const seen = new Set();
  return h.filter(d => d.decision === 'later' && !chosen.has(d.name)).reverse().filter(d => !seen.has(d.name) && seen.add(d.name));
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function html(m) {
  const card = o => `<article class="card" data-id="${esc(o.id)}">
  <header><span class="id">${esc(o.id)}</span><div><h2>${esc(o.name)}</h2><p>${esc(o.pitch)}</p></div>
    <div class="meta">${o.estimate ? `<b>${esc(o.estimate)}</b>` : ''}${(o.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div></header>
  <ul class="meals">${o.meals.map((x, i) => `<li><label><input type="checkbox" class="nomeal" data-i="${i}"><span class="x" title="Je ne veux pas ce plat">✕</span></label>
    <div><small>${esc(x.when)}${x.time ? ` · ${x.time} min` : ''}</small><strong>${esc(x.title)}</strong><p>${esc(x.desc)}</p></div></li>`).join('')}</ul>
  <div class="actions" role="radiogroup" aria-label="Décision pour ${esc(o.name)}">
    <button type="button" data-d="chosen">✅ Je prends</button>
    <button type="button" data-d="rejected">👎 Pas pour moi</button>
    <button type="button" data-d="later">⏰ Plus tard</button>
  </div>
  <textarea placeholder="Remarque (optionnel) : ex. moins épicé, remplacer le poulet par du bœuf…"></textarea>
</article>`;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Choix du menu</title><style>
:root { --g: #91c11e; --gd: #4d7a00; --bg: #f6f7f2; --card: #fff; --tx: #1f2a1f; --mu: #6b756b; --bd: #e3e8d8 }
@media (prefers-color-scheme: dark) { :root { --bg: #151a14; --card: #1f261d; --tx: #eef2e8; --mu: #a3ad9f; --bd: #333d30; --gd: #b4e04a } }
* { box-sizing: border-box } body { margin: 0; background: var(--bg); color: var(--tx); font: 15px/1.45 -apple-system, "Helvetica Neue", Arial, sans-serif }
.top { background: var(--g); color: #fff; padding: 28px 16px 22px } .top div, main { max-width: 1180px; margin: 0 auto }
.top h1 { margin: 0 0 4px; font-size: 26px } .top p { margin: 0; opacity: .95 }
main { padding: 20px 16px 120px; display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(330px, 1fr)) }
.card { background: var(--card); border: 2px solid var(--bd); border-radius: 14px; padding: 16px; display: flex; flex-direction: column; gap: 12px }
.card.chosen { border-color: var(--g) } .card.rejected { opacity: .55 } .card.later { border-style: dashed }
header { display: grid; grid-template-columns: auto 1fr; gap: 10px } .id { width: 34px; height: 34px; border-radius: 50%; background: var(--g); color: #fff; font-weight: 800; display: grid; place-items: center }
h2 { margin: 2px 0; font-size: 18px } header p { margin: 0; color: var(--mu) } .meta { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 6px; align-items: center }
.meta b { color: var(--gd); margin-right: 4px } .tag { font-size: 12px; padding: 2px 8px; border-radius: 99px; background: var(--bg); border: 1px solid var(--bd) }
.meals { list-style: none; margin: 0; padding: 0 } .meals li { display: grid; grid-template-columns: 26px 1fr; gap: 8px; padding: 8px 0; border-top: 1px solid var(--bd) }
.meals small { display: block; color: var(--mu); text-transform: uppercase; font-size: 11px; letter-spacing: .06em } .meals p { margin: 2px 0 0; color: var(--mu); font-size: 13px }
.meals label { position: relative; width: 24px; height: 24px } .meals input { position: absolute; inset: 0; margin: 0; opacity: 0; cursor: pointer } .x { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 6px; border: 1px solid var(--bd); color: var(--mu); cursor: pointer; font-size: 12px }
.meals input:checked + .x { background: #d64545; border-color: #d64545; color: #fff } .meals input:focus-visible + .x { outline: 2px solid var(--gd) }
.meals li:has(input:checked) strong { text-decoration: line-through; color: var(--mu) }
.actions { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px } .actions button { padding: 10px 4px; border-radius: 10px; border: 1px solid var(--bd); background: var(--bg); color: var(--tx); font: inherit; font-size: 13px; cursor: pointer }
.actions button[aria-checked=true] { background: var(--g); border-color: var(--g); color: #fff; font-weight: 700 }
textarea { width: 100%; min-height: 52px; border-radius: 10px; border: 1px solid var(--bd); background: var(--bg); color: var(--tx); padding: 8px; font: inherit; font-size: 13px; resize: vertical }
footer { position: fixed; inset: auto 0 0 0; background: var(--card); border-top: 1px solid var(--bd); padding: 12px 16px } footer div { max-width: 1180px; margin: 0 auto; display: flex; gap: 10px; align-items: center }
footer input { flex: 1; min-width: 0; padding: 10px; border-radius: 10px; border: 1px solid var(--bd); background: var(--bg); color: var(--tx); font: inherit }
#go { padding: 11px 20px; border: 0; border-radius: 10px; background: var(--g); color: #fff; font-weight: 800; font: inherit; cursor: pointer } #go:disabled { opacity: .45; cursor: default }
.done { text-align: center; padding: 60px 16px; font-size: 20px }
</style></head><body>
<section class="top"><div><h1>${esc(m.title || 'Choisis ton menu')}</h1><p>Un menu à prendre, les autres à refuser ou garder pour plus tard. ✕ sur un plat = « pas celui-là ».</p></div></section>
<main>${m.options.map(card).join('')}</main>
<footer><div><input id="note" placeholder="Remarque générale (optionnel)"><button id="go" disabled>Valider</button></div></footer>
<script>
const state = {};
document.querySelectorAll('.card').forEach(c => c.querySelectorAll('.actions button').forEach(b => {
  b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', 'false');
  b.onclick = () => {
    const id = c.dataset.id, d = b.dataset.d;
    if (d === 'chosen') for (const [k, v] of Object.entries(state)) if (v === 'chosen') { state[k] = undefined; paint(k); } // un seul menu choisi
    state[id] = state[id] === d ? undefined : d; paint(id);
  };
}));
function paint(id) {
  const c = document.querySelector('.card[data-id="' + CSS.escape(id) + '"]');
  c.className = 'card ' + (state[id] || '');
  c.querySelectorAll('.actions button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.d === state[id])));
  document.getElementById('go').disabled = !Object.values(state).some(Boolean);
}
document.getElementById('go').onclick = async () => {
  const options = [...document.querySelectorAll('.card')].map(c => ({
    id: c.dataset.id, decision: state[c.dataset.id] || null, comment: c.querySelector('textarea').value.trim(),
    rejectedMeals: [...c.querySelectorAll('.nomeal:checked')].map(i => +i.dataset.i),
  }));
  await window.submitChoice({ options, note: document.getElementById('note').value.trim() });
  document.body.innerHTML = '<p class="done">✅ C\\'est noté ! Tu peux fermer cette fenêtre.</p>';
};
</script></body></html>`;
}

async function choose(file) {
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { chromium } = require('playwright');
  const b = await chromium.launch({ channel: 'chrome', headless: false }).catch(() => chromium.launch({ headless: false }));
  const page = await b.newPage({ viewport: null });
  const result = await new Promise(async resolve => {
    page.on('close', () => resolve(null));
    await page.exposeFunction('submitChoice', resolve);
    await page.setContent(html(m));
  });
  await page.waitForTimeout(800).catch(() => {});
  await b.close().catch(() => {});
  if (!result) throw new Error('Fenêtre fermée sans validation');

  const date = new Date().toISOString().slice(0, 10);
  const h = load();
  const out = result.options.filter(o => o.decision).map(o => {
    const opt = m.options.find(x => x.id === o.id);
    return {
      date, source: file, id: o.id, name: opt.name, decision: o.decision, comment: o.comment,
      rejectedMeals: o.rejectedMeals.map(i => opt.meals[i].title), meals: opt.meals,
    };
  });
  save([...h, ...out]);
  return { chosen: out.find(o => o.decision === 'chosen') || null, decisions: out, note: result.note };
}

module.exports = { html, choose, later };

if (require.main === module) {
  (async () => {
    const [cmd, arg] = process.argv.slice(2);
    const out = { choose: () => choose(arg), later: () => later(), history: () => load() }[cmd];
    if (!out) throw new Error('Commandes : choose <menus.json> | later | history');
    console.log(JSON.stringify(await out(), null, 1));
  })().catch(e => { console.error(e.message); process.exitCode = 1; });
}
