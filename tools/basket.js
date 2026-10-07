// Construit un panier précis à partir des choix de l'agent (titre approximatif + quantité),
// en résolvant les identifiants dans le cache de recherche (<compare>.raw.json).
// Usage : node tools/basket.js <compare.raw.json> <choix.json> <sortie.json>
//   choix.json : { "platform": "ubereats", "store": "<storeUuid|menuPath>", "picks": [{ "for": "Œufs", "title": "Volaé - Œufs frais ... Gros (6)", "qty": 1 }] }
//   Article au poids (byWeight) : "grams" au lieu de "qty" (arrondi au palier de la plateforme).
//   "price" optionnel pour départager deux produits au même titre.
const fs = require('fs');

const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

function resolve(raw, { platform, store, picks }) {
  const res = raw[platform + '|' + store];
  if (!res) throw new Error(`Magasin absent du cache : ${platform}|${store}`);
  const all = Object.values(res.results).flat();
  const items = picks.map(p => {
    // "price" optionnel : départage les homonymes (ex. même titre en 100 g et 200 g sur Deliveroo).
    const ok = i => p.price == null || Math.abs(i.price - p.price) < 0.005;
    const hit = all.find(i => norm(i.title) === norm(p.title) && ok(i)) || all.find(i => norm(i.title).includes(norm(p.title)) && ok(i));
    if (!hit) throw new Error(`Introuvable chez ${res.store} : "${p.title}"`);
    if (hit.byWeight) {
      const g = require('./ubereats').grams({ ...hit, grams: p.grams });
      return { ...hit, for: p.for, grams: g, qty: 1, cost: +(hit.centsPerGram * g / 100).toFixed(2) };
    }
    return { ...hit, for: p.for, qty: p.qty || 1, cost: +(hit.price * (p.qty || 1)).toFixed(2) };
  });
  const subtotal = +items.reduce((s, i) => s + i.cost, 0).toFixed(2);
  return { platform, store: res.store, storeUuid: res.storeUuid, menuPath: res.menuPath, subtotal, items };
}

module.exports = { resolve };

if (require.main === module) {
  const [rawFile, picksFile, out] = process.argv.slice(2);
  const b = resolve(JSON.parse(fs.readFileSync(rawFile, 'utf8')), JSON.parse(fs.readFileSync(picksFile, 'utf8')));
  fs.writeFileSync(out, JSON.stringify(b, null, 1));
  console.log(`${b.store} : ${b.items.length} articles, sous-total ${b.subtotal.toFixed(2)} €`);
}
