// Compare une liste de courses sur plusieurs magasins Uber Eats et Deliveroo (sous-total produits).
// Usage : node tools/compare.js <list.json> <targets.json> <sortie.json> [--refresh]
//   Les résultats bruts sont mis en cache dans <sortie>.raw.json : relancer sans --refresh recalcule les choix
//   instantanément (utile pour ajuster match/exclude). Les requêtes absentes du cache sont re-téléchargées.
//   list.json    : [{ name, need, query, match (regex), exclude (regex) }]
//   targets.json : { ubereats: [storeUuid...], deliveroo: [menuPath...] }
//   + optionnels : min (g/ml nécessaires, lus dans le titre), units (nb de pièces/paquets à prendre)
// Choix par article = le coût le plus bas pour couvrir le besoin (à relire : "pick" + "alternatives").
// ponytail: tri par coût seul, la qualité (marque, bio, label) reste un arbitrage de l'agent.
const fs = require('fs');
const ue = require('./ubereats');
const dr = require('./deliveroo');

// Contenance en g ou ml lue dans le titre : "(400g)", "1kg", "20 cl", "2 x 75g".
function size(title) {
  const m = title.match(/(?:(\d+)\s*x\s*)?(\d+(?:[.,]\d+)?)\s*(kg|g|ml|cl|l)\b/i);
  if (!m) return null;
  const v = parseFloat(m[2].replace(',', '.')) * ({ kg: 1000, g: 1, ml: 1, cl: 10, l: 1000 })[m[3].toLowerCase()];
  return v * (m[1] ? +m[1] : 1);
}

function pick(item, results) {
  const m = new RegExp(item.match, 'i'), x = item.exclude ? new RegExp(item.exclude, 'i') : null;
  const ok = results
    .filter(r => r.price > 0 && m.test(r.title) && !(x && x.test(r.title))) // prix 0 = vendu au poids, inconnu
    .map(r => {
      const sz = size(r.title);
      const packs = item.units || (item.min && sz ? Math.ceil(item.min / sz) : 1);
      return { ...r, size: sz, packs, cost: +(r.price * packs).toFixed(2) };
    })
    .sort((a, b) => a.cost - b.cost);
  return { pick: ok[0] || null, alternatives: ok.slice(1, 4) };
}

function basket(platform, res, list) {
  const lines = list.map(item => ({ name: item.name, need: item.need, ...pick(item, res.results[item.query] || []) }));
  const missing = lines.filter(l => !l.pick).map(l => l.name);
  return {
    platform, store: res.store, id: res.storeUuid || res.menuPath, eta: res.eta,
    subtotal: +lines.reduce((s, l) => s + (l.pick?.cost || 0), 0).toFixed(2), missing, lines,
  };
}

// Télécharge les résultats de recherche manquants dans raw = { "<platform>|<id>": { store, eta, results: { query: [...] } } }.
async function fetchRaw(list, targets, raw) {
  const queries = [...new Set(list.map(i => i.query))];
  for (const [platform, mod, ids] of [['ubereats', ue, targets.ubereats || []], ['deliveroo', dr, targets.deliveroo || []]]) {
    const todo = ids.filter(id => queries.some(q => !raw[platform + '|' + id]?.results[q]));
    if (!todo.length) continue;
    const s = await mod.session();
    try {
      for (const id of todo) {
        const key = platform + '|' + id, missingQ = queries.filter(q => !raw[key]?.results[q]);
        try {
          const res = platform === 'ubereats' ? await ue.search(s.api, id, missingQ) : await dr.search(s, id, missingQ);
          raw[key] = { ...res, results: { ...raw[key]?.results, ...res.results } };
          console.error(`✓ ${platform} ${res.store}`);
        } catch (e) { console.error(`✗ ${platform} ${id}: ${e.message}`); }
      }
    } finally { await s.ctx.close(); }
  }
  return raw;
}

function rank(list, raw) {
  const out = Object.entries(raw).map(([key, res]) => basket(key.split('|')[0], res, list));
  // Classement : le moins d'articles manquants, puis le sous-total.
  return out.sort((a, b) => a.missing.length - b.missing.length || a.subtotal - b.subtotal);
}

module.exports = { fetchRaw, rank, pick, size };

if (require.main === module) {
  (async () => {
    const [listFile, targetsFile, outFile] = process.argv.slice(2);
    const rawFile = outFile.replace(/\.json$/, '.raw.json');
    const list = JSON.parse(fs.readFileSync(listFile, 'utf8'));
    const targets = JSON.parse(fs.readFileSync(targetsFile, 'utf8'));
    const cached = !process.argv.includes('--refresh') && fs.existsSync(rawFile) ? JSON.parse(fs.readFileSync(rawFile, 'utf8')) : {};
    const keep = new Set([...(targets.ubereats || []).map(i => 'ubereats|' + i), ...(targets.deliveroo || []).map(i => 'deliveroo|' + i)]);
    const raw = await fetchRaw(list, targets, Object.fromEntries(Object.entries(cached).filter(([k]) => keep.has(k))));
    fs.writeFileSync(rawFile, JSON.stringify(raw));
    const r = rank(list, raw);
    fs.writeFileSync(outFile, JSON.stringify(r, null, 1));
    for (const b of r) console.log(`${b.subtotal.toFixed(2).padStart(7)} €  ${b.platform.padEnd(9)} ${b.store}  ${b.missing.length ? '— manque : ' + b.missing.join(', ') : ''}`);
  })();
}
