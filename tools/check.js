// Auto-tests hors-ligne de la logique non triviale (aucun navigateur). Usage : node tools/check.js
const assert = require('assert');
const { size, pick } = require('./compare');
const { grams } = require('./ubereats');
const { resolve } = require('./basket');

assert.equal(size('Riz basmati (220g)'), 220);
assert.equal(size('Lardons (2 x 75g)'), 150);
assert.equal(size('Lait de coco 20 cl'), 200);
assert.equal(size('Oignons 1kg'), 1000);

// Le moins cher pour couvrir le besoin, pas le moins cher tout court ; prix 0 (au poids) ignoré.
const p = pick({ match: 'riz', min: 400 }, [
  { title: 'Riz (250g)', price: 1.5 }, { title: 'Riz (500g)', price: 2.2 }, { title: 'Riz vrac', price: 0 },
]);
assert.equal(p.pick.title, 'Riz (500g)');

// Paliers de poids : arrondi au palier supérieur, minimum respecté.
assert.equal(grams({ stepG: 150, minG: 150, grams: 400 }), 450);
assert.equal(grams({ stepG: 150, minG: 150 }), 150);

// Produit vendu au kilo (Intermarché Gambetta) : ramené au gramme (4,87 €/kg, palier 0,14 kg).
const [citron] = require('./ubereats').flattenCatalog({ s: [{ payload: { standardItemsPayload: { catalogItems: [{ title: 'Citrons', isAvailable: true, price: 487,
  purchaseInfo: { purchaseOptions: [{ soldByUnit: { measurementType: 'MEASUREMENT_TYPE_WEIGHT', weight: { unitType: 'WEIGHT_UNIT_TYPE_METRIC_KILOGRAM' } },
    quantityConstraintsV2: { minPermittedNumber: 0.14, incrementNumber: 0.14 } }] } }] } } }] });
assert.deepEqual([citron.centsPerGram, citron.minG, citron.stepG, citron.price, citron.perKg], [0.487, 140, 140, 0.68, 4.87]);

// Homonymes départagés par le prix ; coût au poids.
const raw = { 'deliveroo|/m': { store: 'X', results: { q: [
  { title: 'Emmental râpé', price: 1.34 }, { title: 'Emmental râpé', price: 2.01 },
  { title: 'Oignon', byWeight: true, centsPerGram: 0.365, minG: 150, stepG: 150, price: 0.55 },
] } } };
const b = resolve(raw, { platform: 'deliveroo', store: '/m', picks: [{ title: 'emmental rape', price: 2.01 }, { title: 'Oignon', grams: 300 }] });
assert.equal(b.items[0].price, 2.01);
assert.equal(b.items[1].cost, 1.09); // 0,365 c/g × 300 g
// Menus "plus tard" : dédoublonnés, et retirés une fois choisis.
const { later } = require('./menus');
const lt = later([
  { name: 'Tex-mex', decision: 'later' }, { name: 'Asiat', decision: 'later' },
  { name: 'Tex-mex', decision: 'later' }, { name: 'Asiat', decision: 'chosen' },
]);
assert.deepEqual(lt.map(x => x.name), ['Tex-mex']);
// Tirage de variété : saison du mois, plats des 3 derniers menus choisis seulement.
const { draw } = require('./menus');
const dr = draw(new Date(2026, 0, 15), ['A', 'B', 'C', 'D'].map(t => ({ decision: 'chosen', meals: [{ title: t }] })).concat({ decision: 'rejected', meals: [{ title: 'E' }] }));
assert.deepEqual(dr.avoid, ['B', 'C', 'D']);
assert.ok(dr.seasonal.every(x => dr.allSeasonal.includes(x)) && dr.allSeasonal.includes('poireau') && dr.cuisines.length === 4);

// Commande payée : remplacement par le magasin (même ligne, autre titre), article non livré, prix changé.
const { orderChanges } = require('../server');
assert.deepEqual(orderChanges(
  [{ cartItemUuid: 'a', title: 'Thon 112g', cost: 2.18 }, { cartItemUuid: 'b', title: 'Riz', cost: 1.67 }, { cartItemUuid: 'c', title: 'Avocat', cost: 1.94 }],
  [{ cartItemUuid: 'a', title: 'Thon 140g', cost: 2.85 }, { cartItemUuid: 'b', title: 'Riz', cost: 1.67 }]).map(c => c.type), ['replaced', 'removed']);
console.log('ok');
