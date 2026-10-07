// Client Uber Eats : passe par l'API interne du site (/_p/api/*) depuis un vrai Chrome connecté.
// CLI : node tools/ubereats.js <commande> [args]   (sortie JSON)
//   stores [requête]                 magasins livrables à l'adresse du profil (défaut : "supermarché")
//   search <storeUuid> <q1> [q2...]  produits d'un magasin pour chaque requête
//   carts                            paniers en cours (un par magasin)
//   fill <basket.json>               remplit le panier d'un magasin (basket = { storeUuid, items: [résultat de search + qty | grams si byWeight] })
//   qty <draftUuid> <cartItemUuid> <qté>  change la quantité (0 = supprimer)
//   remove <draftUuid> <cartItemUuid>     supprime un article
//   clear <draftUuid|all>            vide le panier (all = tous les paniers du compte)
//   checkout <draftUuid>             détail des frais + total final, SANS commander
//   verify <draftUuid>               relit le panier réel : articles devenus indisponibles (prix 0), coûts, total
//   (fill affiche directement le résultat de verify)
const { open, waitCloudflare } = require('./browser');
const profile = require('./profile');

const BASE = 'https://www.ubereats.com';

async function session() {
  const { ctx, page } = await open('ubereats');
  await page.goto(BASE + '/fr', { waitUntil: 'domcontentloaded' });
  await waitCloudflare(page);
  const api = async (ep, body = {}, retries = 2) => {
    const r = await page.evaluate(async ([ep, body]) => {
      const res = await fetch(`/_p/api/${ep}?localeCode=fr`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': 'x' }, body: JSON.stringify(body),
      });
      return res.text();
    }, [ep, body]);
    let j; try { j = JSON.parse(r); } catch {
      // Erreurs réseau passagères ("upstream connect error") : on réessaie.
      if (retries) { await page.waitForTimeout(2000); return api(ep, body, retries - 1); }
      throw new Error(`${ep}: réponse non JSON (Cloudflare ?) ${r.slice(0, 100)}`);
    }
    if (j.status !== 'success') throw new Error(`${ep}: ${JSON.stringify(j.data).slice(0, 300)}`);
    return j.data;
  };
  await setAddress(ctx, api, profile().address);
  return { ctx, page, api };
}

// L'adresse de livraison est portée par le cookie uev2.loc.
async function setAddress(ctx, api, address) {
  const [place] = await api('mapsSearchV1', { query: address });
  if (!place) throw new Error('Adresse introuvable : ' + address);
  const l = (await api('getDeliveryLocationV2', { placeId: place.id, provider: place.provider, source: 'manual_auto_complete' })).deliveryLocation.location;
  const loc = {
    address: { address1: l.addressLine1, address2: l.addressLine2, aptOrSuite: '', eaterFormattedAddress: l.fullAddress, subtitle: l.subtitle, title: l.title, uuid: '' },
    latitude: l.coordinate.latitude, longitude: l.coordinate.longitude, reference: l.id,
    referenceType: place.provider, type: place.provider, source: 'manual_auto_complete',
  };
  await ctx.addCookies([{ name: 'uev2.loc', value: encodeURIComponent(JSON.stringify(loc)), domain: '.ubereats.com', path: '/', expires: Date.now() / 1000 + 86400 * 30 }]);
}

async function stores(api, query = 'supermarché') {
  const d = await api('getSearchFeedV1', {
    userQuery: query, date: '', startTime: 0, endTime: 0, sortAndFilters: [], vertical: 'ALL',
    searchSource: 'SEARCH_SUGGESTION', displayType: 'SEARCH_RESULTS', searchType: 'GLOBAL_SEARCH', keyName: '', cacheKey: '', recaptchaToken: '',
  });
  return d.feedItems.filter(f => f.store).map(({ store: s }) => ({
    storeUuid: s.storeUuid, name: s.title.text, url: BASE + '/fr' + s.actionUrl,
    rating: s.rating?.text, etaMin: s.tracking?.storePayload?.etdInfo?.dropoffETARange?.raw,
    orderable: s.tracking?.storePayload?.isOrderable,
  }));
}

// Aplati catalogSectionsMap -> [{ itemUuid, title, price (€), sectionUuid, subsectionUuid }]
function flattenCatalog(map) {
  const out = [];
  for (const [sectionUuid, sections] of Object.entries(map || {}))
    for (const s of sections)
      for (const it of s.payload?.standardItemsPayload?.catalogItems || [])
      {
        const opt = it.purchaseInfo?.purchaseOptions?.[0];
        const byWeight = opt?.soldByUnit?.measurementType === 'MEASUREMENT_TYPE_WEIGHT';
        const q = opt?.quantityConstraintsV2;
        out.push({
          itemUuid: it.uuid, title: it.title, available: it.isAvailable && !it.isSoldOut, sectionUuid, subsectionUuid: it.subsectionUuid,
          // Au poids : l'API donne des centimes/gramme et des paliers (ex. 150 g). price = prix pour 1 palier minimum.
          ...(byWeight
            ? { byWeight: true, centsPerGram: it.price, perKg: +(it.price * 10).toFixed(2), minG: q?.minPermittedNumber, stepG: q?.incrementNumber, price: +(it.price * (q?.minPermittedNumber || 0) / 100).toFixed(2) }
            : { price: it.price / 100 }),
        });
      }
  return out;
}

async function getStore(api, storeUuid) {
  return api('getStoreV1', { storeUuid, diningMode: 'DELIVERY', time: { asap: true }, cbType: 'EATER_ENDORSED' });
}

async function search(api, storeUuid, queries) {
  const store = await getStore(api, storeUuid);
  const res = { store: store.title, storeUuid, isOpen: store.isOpen, eta: store.etaRange?.text, results: {} };
  for (const q of queries) {
    const d = await api('getInStoreSearchV1', {
      diningMode: 'DELIVERY', sectionUUIDs: null, storeUUIDs: [storeUuid], userQuery: q, isGrocery: true,
      targetLocation: store.location, entrypointContext: 'IN_STORE_SEARCH',
    });
    res.results[q] = flattenCatalog(d.catalogSectionsMap).filter(i => i.available).slice(0, 15);
  }
  return res;
}

// ---- Paniers (draft orders) ----
async function carts(api) {
  const d = await api('getDraftOrdersByEaterUuidV1', {});
  return (d.draftOrders || []).map(o => ({
    draftUuid: o.uuid, storeUuid: o.storeUuid,
    items: o.shoppingCart.items.map(i => ({ cartItemUuid: i.shoppingCartItemUuid, itemUuid: i.uuid, title: i.title, qty: i.quantity })),
  }));
}

const WEIGHT_G = { measurementType: 'MEASUREMENT_TYPE_WEIGHT', weight: { unitType: 'WEIGHT_UNIT_TYPE_METRIC_GRAM' } };

// Article au poids : "grams" est arrondi au palier supérieur (ex. 400 g demandés, paliers de 150 -> 450 g).
function grams(it) {
  const step = it.stepG || it.minG || 1, g = Math.max(it.grams || it.minG || step, it.minG || 0);
  return Math.ceil(g / step) * step;
}

const cartItem = (storeUuid, it) => ({
  uuid: it.itemUuid, shoppingCartItemUuid: crypto.randomUUID(), storeUuid, sectionUuid: it.sectionUuid, subsectionUuid: it.subsectionUuid,
  title: it.title, customizations: {}, specialInstructions: '',
  ...(it.byWeight
    ? {
      price: it.centsPerGram, quantity: 1,
      pricedByUnit: { measurementType: 'MEASUREMENT_TYPE_WEIGHT', weight: { unitType: 'WEIGHT_UNIT_TYPE_METRIC_KILOGRAM' } }, soldByUnit: WEIGHT_G,
      itemQuantity: { inSellableUnit: { value: { coefficient: grams(it) * 1e5, exponent: -5 }, measurementUnit: WEIGHT_G } },
    }
    : { price: Math.round(it.price * 100), quantity: it.qty || 1 }),
});

// Ajoute les articles au panier du magasin (le crée s'il n'existe pas). Retourne le draftUuid.
async function fill(api, { storeUuid, items }) {
  const bad = items.filter(i => i.byWeight ? !i.centsPerGram : !i.price);
  if (bad.length) throw new Error('Prix inconnu (relancer la recherche) : ' + bad.map(i => i.title).join(', '));
  const existing = (await carts(api)).find(c => c.storeUuid === storeUuid);
  const cartItems = items.map(it => cartItem(storeUuid, it));
  if (existing) {
    const d = await api('getDraftOrderByUuidV1', { draftOrderUuid: existing.draftUuid });
    await api('addItemsToDraftOrderV2', { draftOrderUUID: existing.draftUuid, cartUUID: d.shoppingCart.cartUuid, items: cartItems, shouldUpdateDraftOrderMetadata: true });
    return existing.draftUuid;
  }
  const d = await api('createDraftOrderV2', {
    isMulticart: true, useCredits: true, extraPaymentProfiles: [], deliveryTime: { asap: true }, deliveryType: 'ASAP',
    currencyCode: 'EUR', interactionType: 'door_to_door', checkMultipleDraftOrdersCap: true, shoppingCartItems: cartItems,
  });
  return d.draftOrder.uuid;
}

async function setQty(api, draftUuid, cartItemUuid, qty) {
  const d = await api('getDraftOrderByUuidV1', { draftOrderUuid: draftUuid });
  if (+qty === 0) return remove(api, draftUuid, cartItemUuid);
  const item = d.shoppingCart.items.find(i => i.shoppingCartItemUuid === cartItemUuid);
  if (!item) throw new Error('Article absent du panier : ' + cartItemUuid);
  await api('updateItemInDraftOrderV2', { draftOrderUUID: draftUuid, cartUUID: d.shoppingCart.cartUuid, item: { ...item, quantity: +qty } });
}

async function remove(api, draftUuid, cartItemUuid) {
  const d = await api('getDraftOrderByUuidV1', { draftOrderUuid: draftUuid });
  await api('removeItemsFromDraftOrderV2', { draftOrderUUID: draftUuid, cartUUID: d.shoppingCart.cartUuid, shoppingCartItemUUIDs: [cartItemUuid] });
}

// Vide un panier (retirer tous ses articles le supprime). draftUuid = 'all' : tous les paniers du compte.
async function clear(api, draftUuid) {
  const targets = (await carts(api)).filter(c => draftUuid === 'all' || c.draftUuid === draftUuid);
  for (const c of targets) {
    const d = await api('getDraftOrderByUuidV1', { draftOrderUuid: c.draftUuid });
    await api('removeItemsFromDraftOrderV2', { draftOrderUUID: c.draftUuid, cartUUID: d.shoppingCart.cartUuid, shoppingCartItemUUIDs: c.items.map(i => i.cartItemUuid) });
  }
}

// Lit le récapitulatif de paiement (frais réels du compte connecté) sans rien valider.
async function checkout(api, draftUuid) {
  const d = (await api('getCheckoutPresentationV1', { payloadTypes: ['fareBreakdown', 'subtotal', 'total', 'eta', 'passBanner'], draftOrderUUID: draftUuid })).checkoutPayloads;
  const lines = [];
  for (const c of d.fareBreakdown?.charges || []) {
    const parts = c.action?.infoBottomSheet?.paragraphs;
    if (parts?.length) for (const p of parts) lines.push({ label: p.title, amount: p.endTitle });
    else lines.push({ label: c.title?.text, amount: c.value?.text });
  }
  const eur = v => v?.amountE5 != null ? v.amountE5 / 1e5 : null;
  return { draftUuid, subtotal: eur(d.subtotal?.subtotal?.value), total: eur(d.total?.total?.value), lines };
}

// Relit le panier réel. Un article passé en rupture reste dans le panier avec price = 0 (refusé au paiement),
// même si la recherche le montre encore disponible : c'est ce qu'il faut remplacer.
async function verify(api, draftUuid) {
  const d = await api('getDraftOrderByUuidV1', { draftOrderUuid: draftUuid });
  const items = d.shoppingCart.items.map(i => {
    const q = i.itemQuantity?.inSellableUnit;
    const g = q?.measurementUnit?.measurementType === 'MEASUREMENT_TYPE_WEIGHT' ? q.value.coefficient * 10 ** q.value.exponent : null;
    return {
      cartItemUuid: i.shoppingCartItemUuid, itemUuid: i.uuid, title: i.title, qty: i.quantity, grams: g,
      cost: +((g ? i.price * g : i.price * i.quantity) / 100).toFixed(2), unavailable: !i.price,
    };
  });
  const co = await checkout(api, draftUuid);
  return {
    platform: 'ubereats', cartRef: draftUuid, draftUuid, storeUuid: d.storeUuid, checkedAt: new Date().toISOString(),
    items, unavailable: items.filter(i => i.unavailable), subtotal: co.subtotal, total: co.total, lines: co.lines,
  };
}

module.exports = { session, stores, search, getStore, flattenCatalog, grams, carts, fill, setQty, remove, clear, checkout, verify };

if (require.main === module) {
  (async () => {
    const [cmd, ...args] = process.argv.slice(2);
    const { ctx, api } = await session();
    try {
      const out = {
        stores: () => stores(api, args[0]),
        search: () => search(api, args[0], args.slice(1)),
        carts: () => carts(api),
        fill: async () => verify(api, await fill(api, JSON.parse(require('fs').readFileSync(args[0], 'utf8')))),
        verify: () => verify(api, args[0]),
        qty: () => setQty(api, args[0], args[1], args[2]).then(() => carts(api)),
        remove: () => remove(api, args[0], args[1]).then(() => carts(api)),
        clear: () => clear(api, args[0]).then(() => carts(api)),
        checkout: () => checkout(api, args[0]),
      }[cmd];
      if (!out) throw new Error('Commande inconnue : ' + cmd);
      console.log(JSON.stringify(await out(), null, 1));
    } catch (e) { console.error(e.message); process.exitCode = 1; }
    finally { await ctx.close(); }
  })();
}
