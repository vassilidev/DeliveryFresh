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

// opts.postUrl : la page envoie le choix au serveur web (sinon : window.submitChoice exposé par Playwright).
// Même feuille de style que l'interface web (web/style.css, incluse dans la page pour marcher aussi hors serveur).
const CSS = path.join(__dirname, '..', 'web', 'style.css');
const X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

function html(m, opts = {}) {
  const card = o => `<article class="menu" data-id="${esc(o.id)}" data-name="${esc(o.name)}">
  <span class="letter" aria-hidden="true">${esc(o.id)}</span>
  ${o.estimate ? `<span class="price">${esc(o.estimate)}</span>` : ''}
  <div><h2>${esc(o.name)}</h2><p class="pitch">${esc(o.pitch)}</p>
    ${(o.tags || []).length ? `<div class="tags">${o.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}</div>
  <ul class="meals">${o.meals.map((x, i) => `<li><div><span class="when">${esc(x.when)}</span><strong>${esc(x.title)}</strong>
      <p>${esc(x.desc)}${x.time ? `, ${x.time} min` : ''}</p><span class="swap">L'IA le remplacera</span></div>
    <label class="drop" title="Pas ce plat"><input type="checkbox" class="nomeal" data-i="${i}" aria-label="Retirer « ${esc(x.title)} »">${X}</label></li>`).join('')}</ul>
  <div class="decide" role="group" aria-label="Décision pour ${esc(o.name)}">
    <button type="button" class="btn" data-d="chosen" aria-pressed="false">Choisir ce menu</button>
    <button type="button" class="btn ghost" data-d="later" aria-pressed="false" title="Le garder pour une autre fois">Plus tard</button>
    <button type="button" class="btn ghost" data-d="rejected" aria-pressed="false" title="Ne plus me le proposer">Non</button>
  </div>
  <details class="more"><summary>Ajouter une remarque</summary>
    <textarea style="margin-top:8px" placeholder="Moins épicé, du bœuf plutôt que du poulet…" aria-label="Remarque sur ${esc(o.name)}"></textarea></details>
</article>`;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Choisis ton menu — DeliveryFresh</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;600&family=Young+Serif&display=swap">
<style>${fs.readFileSync(CSS, 'utf8')}
@media (max-width: 760px) { .dock { bottom: 0; padding-bottom: calc(14px + env(safe-area-inset-bottom)) } }
.done { text-align: center; padding: 120px 20px; font: 28px var(--serif) }</style></head><body>
<header class="bar"><div class="in"><span class="logo"><svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="var(--basil)"/><path d="M16 25c0-6 0-9-5-12 4 0 5 2 5 4 0-4 2-8 7-8-3 2-5 5-5 9" fill="none" stroke="var(--on-basil)" stroke-width="2.2" stroke-linecap="round"/></svg>DeliveryFresh</span>
${opts.backUrl ? `<a class="btn quiet" href="${esc(opts.backUrl)}">Retour à la commande</a>` : ''}</div></header>
<main class="page-pad">
  <div class="page-head"><div><h1>${esc(m.title || 'Choisis ton menu')}</h1>
    <p class="muted">Choisis un menu. Touche ✕ sur un plat qui ne te dit rien, l'IA le remplacera. Les autres menus : « Plus tard » pour les garder, « Non » pour ne plus les revoir.</p></div></div>
  <div class="menus">${m.options.map(card).join('')}</div>
</main>
<div class="dock"><div class="in"><div class="sum" id="sum"></div>
  <input id="note" type="text" placeholder="Une remarque générale ?" aria-label="Remarque générale"><button class="btn big" id="go" disabled></button></div></div>
<script>
const POST = ${JSON.stringify(opts.postUrl || '')}, BACK = ${JSON.stringify(opts.backUrl || '/')};
const state = {}, cards = [...document.querySelectorAll('.menu')];
cards.forEach(c => c.querySelectorAll('.decide button').forEach(b => b.onclick = () => {
  const id = c.dataset.id, d = b.dataset.d;
  if (d === 'chosen') for (const k in state) if (state[k] === 'chosen') state[k] = undefined; // un seul menu choisi
  state[id] = state[id] === d ? undefined : d;
  paint();
}));
document.addEventListener('change', e => e.target.matches('.nomeal') && paint());
function paint() {
  cards.forEach(c => {
    const d = state[c.dataset.id];
    c.className = 'menu ' + (d || '');
    c.querySelectorAll('.decide button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.d === d)));
    c.querySelector('[data-d=chosen]').textContent = d === 'chosen' ? '✓ Menu choisi' : 'Choisir ce menu';
  });
  const chosen = cards.find(c => state[c.dataset.id] === 'chosen'), any = Object.values(state).some(Boolean);
  const go = document.getElementById('go'), sum = document.getElementById('sum');
  const n = c => c.querySelectorAll('.nomeal:checked').length;
  if (chosen) {
    const k = n(chosen);
    sum.innerHTML = '<b></b><span class="muted small">' + (k ? k + ' plat' + (k > 1 ? 's' : '') + ' à remplacer, puis' : 'Ensuite,') + ' l’IA compare les paniers (5 à 15 min).</span>';
    go.textContent = 'Comparer les paniers';
  } else if (any) {
    sum.innerHTML = '<b>Aucun menu choisi</b><span class="muted small">L’IA en propose d’autres en tenant compte de tes refus.</span>';
    go.textContent = 'Proposer d’autres menus';
  } else {
    sum.innerHTML = '<b>Quel menu te tente ?</b><span class="muted small">Ou dis « Non » à tous pour en avoir d’autres.</span>';
    go.textContent = 'Valider';
  }
  if (chosen) sum.querySelector('b').textContent = 'Menu ' + chosen.dataset.id + ' : ' + chosen.dataset.name;
  go.disabled = !any;
}
paint();
document.getElementById('go').onclick = async () => {
  const go = document.getElementById('go');
  const options = cards.map(c => ({
    id: c.dataset.id, decision: state[c.dataset.id] || null, comment: c.querySelector('textarea').value.trim(),
    rejectedMeals: [...c.querySelectorAll('.nomeal:checked')].map(i => +i.dataset.i),
  }));
  const r = { options, note: document.getElementById('note').value.trim() };
  go.disabled = true; go.textContent = 'Envoi…';
  if (POST) {
    const res = await fetch(POST, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(r) });
    if (!res.ok) { go.disabled = false; paint(); return alert('Erreur : ' + ((await res.json().catch(() => ({}))).error || res.statusText)); }
    location.href = BACK;
  } else {
    await window.submitChoice(r);
    document.body.innerHTML = '<p class="done">C’est noté, tu peux fermer cette fenêtre.</p>';
  }
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

  return record(m, file, result);
}

// Enregistre les décisions dans memory/menus.json et renvoie { chosen, decisions, note }.
function record(m, source, result) {
  const date = new Date().toISOString().slice(0, 10);
  const out = (result.options || []).filter(o => ['chosen', 'rejected', 'later'].includes(o.decision)).map(o => {
    const opt = m.options.find(x => x.id === o.id);
    if (!opt) throw new Error('Menu inconnu : ' + o.id);
    return {
      date, source, id: o.id, name: opt.name, decision: o.decision, comment: String(o.comment || '').slice(0, 1000),
      rejectedMeals: (o.rejectedMeals || []).map(i => opt.meals[i]?.title).filter(Boolean), meals: opt.meals,
    };
  });
  if (out.filter(o => o.decision === 'chosen').length > 1) throw new Error('Un seul menu peut être choisi');
  save([...load(), ...out]);
  return { chosen: out.find(o => o.decision === 'chosen') || null, decisions: out, note: String(result.note || '').slice(0, 1000) };
}

module.exports = { html, choose, record, later, history: load };

if (require.main === module) {
  (async () => {
    const [cmd, arg] = process.argv.slice(2);
    const out = { choose: () => choose(arg), later: () => later(), history: () => load() }[cmd];
    if (!out) throw new Error('Commandes : choose <menus.json> | later | history');
    console.log(JSON.stringify(await out(), null, 1));
  })().catch(e => { console.error(e.message); process.exitCode = 1; });
}
