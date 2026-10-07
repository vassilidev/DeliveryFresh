// Recettes + historique perso (mémoire long terme).
// CLI : node tools/recipes.js <commande>
//   list                                   recettes connues + note moyenne / nb de fois faite
//   made <slug> [AAAA-MM-JJ]               marque une recette comme faite
//   rate <slug> <1-5> [remarque...]        note une recette (+ remarque libre)
//   note <slug> <remarque...>              ajoute une remarque sans note
//   pdf <plan.json> [sortie.pdf]           fiches façon HelloFresh (plan = {title, meals:[{when, recipe}], shopping?:[...]})
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RECIPES = path.join(ROOT, 'recipes');
const HISTORY = path.join(ROOT, 'memory', 'history.json');

const recipe = slug => JSON.parse(fs.readFileSync(path.join(RECIPES, slug + '.json'), 'utf8'));
const allRecipes = () => fs.readdirSync(RECIPES).filter(f => f.endsWith('.json')).map(f => recipe(f.slice(0, -5)));
const loadHistory = () => fs.existsSync(HISTORY) ? JSON.parse(fs.readFileSync(HISTORY, 'utf8')) : {};
function saveHistory(h) { fs.mkdirSync(path.dirname(HISTORY), { recursive: true }); fs.writeFileSync(HISTORY, JSON.stringify(h, null, 1)); }
const today = () => new Date().toISOString().slice(0, 10);

function entry(h, slug) {
  recipe(slug); // vérifie que la recette existe
  return (h[slug] ||= { made: [], ratings: [], notes: [] });
}

function list() {
  const h = loadHistory();
  return allRecipes().map(r => {
    const e = h[r.slug] || { made: [], ratings: [], notes: [] };
    const avg = e.ratings.length ? +(e.ratings.reduce((a, x) => a + x.score, 0) / e.ratings.length).toFixed(1) : null;
    return { slug: r.slug, title: r.title, time: r.time, tags: r.tags, timesMade: e.made.length, lastMade: e.made.at(-1) || null, rating: avg, notes: e.notes.map(n => n.text) };
  });
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function html(plan) {
  const card = (m, i) => {
    const r = recipe(m.recipe);
    return `<section class="card">
  <header><div class="when">${esc(m.when)}</div><div class="num">${i + 1}</div>
    <h1>${esc(r.title)}</h1><p class="sub">${esc(r.subtitle)}</p>
    <div class="badges"><span>⏱ ${r.time} min</span><span>${esc(r.difficulty)}</span><span>🍽 ${r.servings} portion${r.servings > 1 ? 's' : ''}</span><span>${esc(r.equipment.join(' · '))}</span></div>
  </header>
  <div class="body">
    <aside><h2>Ingrédients</h2><ul>${r.ingredients.map(x => `<li class="${x.pantry ? 'pantry' : ''}"><b>${esc(x.qty)}</b> ${esc(x.name)}</li>`).join('')}</ul></aside>
    <ol>${r.steps.map(s => `<li><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p></li>`).join('')}</ol>
  </div>
  ${r.tip ? `<div class="tip"><b>Astuce</b> ${esc(r.tip)}</div>` : ''}
</section>`;
  };
  const shopping = plan.shopping?.length ? `<section class="card"><header><div class="when">Courses</div><h1>${esc(plan.title)}</h1>
    <p class="sub">${esc(plan.shoppingNote || '')}</p></header><div class="body"><ul class="shop">${plan.shopping.map(s => `<li><span>☐ ${esc(s.name)}</span><span>${esc(s.qty || '')}</span><span>${s.price != null ? s.price.toFixed(2).replace('.', ',') + ' €' : ''}</span></li>`).join('')}</ul></div></section>` : '';
  return `<!doctype html><html lang="fr"><meta charset="utf-8"><style>
@page { size: A4; margin: 0 }
* { box-sizing: border-box } body { margin: 0; font: 11pt/1.45 -apple-system, "Helvetica Neue", Arial, sans-serif; color: #1f2a1f }
.card { page-break-after: always; min-height: 297mm; padding: 0 0 14mm }
header { background: #91c11e; color: #fff; padding: 14mm 16mm 10mm; position: relative }
.when { text-transform: uppercase; letter-spacing: .12em; font-size: 9pt; font-weight: 700; opacity: .9 }
.num { position: absolute; right: 16mm; top: 12mm; font-size: 44pt; font-weight: 800; opacity: .35 }
h1 { margin: 4px 0 2px; font-size: 24pt; line-height: 1.1 } .sub { margin: 0 0 10px; font-size: 12pt; opacity: .95 }
.badges span { display: inline-block; background: rgba(255,255,255,.22); border-radius: 99px; padding: 3px 10px; margin: 0 6px 4px 0; font-size: 9pt; font-weight: 600 }
.body { display: flex; gap: 10mm; padding: 10mm 16mm 0 }
aside { flex: 0 0 62mm; background: #f3f7ea; border-radius: 8px; padding: 6mm } aside ul { list-style: none; padding: 0; margin: 0 }
aside li { padding: 4px 0; border-bottom: 1px solid #dfe8cc } aside li.pantry { color: #7a857a; font-style: italic } aside b { color: #4d7a00 }
h2 { margin: 0 0 8px; font-size: 13pt; color: #4d7a00 }
ol { flex: 1; margin: 0; padding: 0; list-style: none; counter-reset: s }
ol li { counter-increment: s; position: relative; padding: 0 0 12px 40px } ol li::before { content: counter(s); position: absolute; left: 0; top: 0; width: 28px; height: 28px; border-radius: 50%; background: #91c11e; color: #fff; font-weight: 800; display: grid; place-items: center }
h3 { margin: 3px 0 2px; font-size: 11.5pt } ol p { margin: 0 }
.tip { margin: 6mm 16mm 0; padding: 5mm 6mm; background: #fff6e0; border-left: 4px solid #f5a623; border-radius: 6px } .tip b { color: #b36b00; margin-right: 6px }
.shop { list-style: none; padding: 0; margin: 0; flex: 1 } .shop li { display: grid; grid-template-columns: 1fr 34mm 22mm; padding: 6px 0; border-bottom: 1px solid #e5e5e5 } .shop li span:last-child { text-align: right; font-weight: 600 }
</style><body>${shopping}${plan.meals.map(card).join('')}</body></html>`;
}

async function pdf(planFile, out) {
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  out ||= planFile.replace(/\.json$/, '') + '.pdf';
  const { chromium } = require('playwright');
  const b = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  const p = await b.newPage();
  await p.setContent(html(plan), { waitUntil: 'load' });
  await p.pdf({ path: out, format: 'A4', printBackground: true });
  await b.close();
  return out;
}

module.exports = { recipe, allRecipes, list, html, pdf };

if (require.main === module) {
  (async () => {
    const [cmd, slug, ...rest] = process.argv.slice(2);
    const h = loadHistory();
    switch (cmd) {
      case 'list': console.log(JSON.stringify(list(), null, 1)); break;
      case 'made': entry(h, slug).made.push(rest[0] || today()); saveHistory(h); console.log('ok'); break;
      case 'rate': {
        const score = Number(rest[0]);
        if (!(score >= 1 && score <= 5)) throw new Error('Note entre 1 et 5');
        const e = entry(h, slug); e.ratings.push({ date: today(), score });
        if (rest.length > 1) e.notes.push({ date: today(), text: rest.slice(1).join(' ') });
        saveHistory(h); console.log('ok'); break;
      }
      case 'note': entry(h, slug).notes.push({ date: today(), text: rest.join(' ') }); saveHistory(h); console.log('ok'); break;
      case 'pdf': console.log(await pdf(slug, rest[0])); break;
      default: console.error('Commandes : list | made | rate | note | pdf'); process.exitCode = 1;
    }
  })().catch(e => { console.error(e.message); process.exitCode = 1; });
}
