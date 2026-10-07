// Client Uber Eats : passe par l'API interne du site (/_p/api/*) depuis un vrai Chrome connecté.
// CLI : node tools/ubereats.js <commande> [args]   (sortie JSON)
//   stores [requête]                 magasins livrables à l'adresse du profil (défaut : "supermarché")
//   search <storeUuid> <q1> [q2...]  produits d'un magasin pour chaque requête
//   carts                            paniers en cours (un par magasin)
//   fill <basket.json>               remplit le panier d'un magasin (idempotent : met chaque article à la quantité voulue) (basket = { storeUuid, items: [résultat de search + qty | grams si byWeight] })
//   qty <draftUuid> <cartItemUuid> <qté>  change la quantité (0 = supprimer)
//   remove <draftUuid> <cartItemUuid>     supprime un article
//   clear <draftUuid|all>            vide le panier (all = tous les paniers du compte)
//   checkout <draftUuid>             détail des frais + total final, SANS commander
//   verify <draftUuid>               relit le panier réel : articles devenus indisponibles (prix 0), coûts, total
//   order <draftUuid>                le panier a-t-il été payé ? status cart|missing|delivering|delivered|cancelled, total payé, articles facturés
//   (fill affiche directement le résultat de verify)
const { open, waitCloudflare } = require('./browser');
const profile = require('./profile');

const BASE = 'https://www.ubereats.com';

async function session() {
  const { ctx, page } = await open('ubereats');
  await page.goto(BASE + '/fr', { waitUntil: 'domcontentloaded' });
  await waitCloudflare(page);
  let last = 0;
  const api = async (ep, body = {}, retries = 2, pause = 15) => {
    // Rythme : 300 ms minimum entre deux appels (Uber freine les rafales : "too_many_requests").
    const gap = last + 300 - Date.now();
    if (gap > 0) await page.waitForTimeout(gap);
    last = Date.now();
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
    if (j.status !== 'success') {
      if (String(j.data?.code) === '401') throw new Error('Session Uber Eats expirée : reconnecte-toi (interface : Comptes → Se connecter, ou node tools/login.js ubereats)');
      if (/too_many_requests|rate.?limit/i.test(JSON.stringify(j.data))) {
        if (pause <= 60) {
          console.error(`⏳ Uber Eats limite les requêtes : pause ${pause} s puis nouvel essai`);
          await page.waitForTimeout(pause * 1000);
          return api(ep, body, retries, pause * 2);
        }
        throw new Error('Uber Eats limite les requêtes (trop d\'appels récents) : réessaie dans quelques minutes');
      }
      throw new Error(`${ep}: ${JSON.stringify(j.data).slice(0, 300)}`);
    }
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
        // Selon le magasin, vendu au gramme (prix en c/g, paliers en g) ou au kilo (c/kg, paliers en kg) : on ramène au gramme.
        const kg = opt?.soldByUnit?.weight?.unitType === 'WEIGHT_UNIT_TYPE_METRIC_KILOGRAM', f = kg ? 1000 : 1;
        const minG = +((q?.minPermittedNumber || 0) * f).toFixed(3), stepG = +((q?.incrementNumber || 0) * f).toFixed(3);
        out.push({
          itemUuid: it.uuid, title: it.title, available: it.isAvailable && !it.isSoldOut, sectionUuid, subsectionUuid: it.subsectionUuid,
          // Au poids : centimes/gramme et paliers en g (ex. 150 g). price = prix pour 1 palier minimum.
          ...(byWeight
            ? { byWeight: true, ...(kg && { kg }), centsPerGram: it.price / f, perKg: +(it.price * 10 / f).toFixed(2), minG, stepG, price: +(it.price / f * minG / 100).toFixed(2) }
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
const WEIGHT_KG = { measurementType: 'MEASUREMENT_TYPE_WEIGHT', weight: { unitType: 'WEIGHT_UNIT_TYPE_METRIC_KILOGRAM' } };

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
      // Renvoyé dans l'unité native du magasin (g ou kg).
      price: it.kg ? Math.round(it.centsPerGram * 1000) : it.centsPerGram, quantity: 1,
      pricedByUnit: WEIGHT_KG, soldByUnit: it.kg ? WEIGHT_KG : WEIGHT_G,
      itemQuantity: { inSellableUnit: { value: { coefficient: Math.round(grams(it) * 1e5 / (it.kg ? 1000 : 1)), exponent: -5 }, measurementUnit: it.kg ? WEIGHT_KG : WEIGHT_G } },
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
    // Idempotent : un article déjà présent est mis à la quantité voulue (pas ajouté une 2e fois) → relancer une
    // étape interrompue ne double rien ; les autres articles du panier ne sont jamais retirés.
    const d = await api('getDraftOrderByUuidV1', { draftOrderUuid: existing.draftUuid });
    const have = new Map(d.shoppingCart.items.map(i => [i.uuid, i]));
    const toAdd = [];
    for (const [k, it] of items.entries()) {
      const cur = have.get(it.itemUuid);
      if (!cur) toAdd.push(cartItems[k]);
      // ponytail: grammage d'un article au poids déjà présent non modifié (le retirer puis le remettre si besoin)
      else if (!it.byWeight && cur.quantity !== (it.qty || 1))
        await api('updateItemInDraftOrderV2', { draftOrderUUID: existing.draftUuid, cartUUID: d.shoppingCart.cartUuid, item: { ...cur, quantity: it.qty || 1 } });
    }
    if (toAdd.length) await api('addItemsToDraftOrderV2', { draftOrderUUID: existing.draftUuid, cartUUID: d.shoppingCart.cartUuid, items: toAdd, shouldUpdateDraftOrderMetadata: true });
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

// Article d'un panier ou d'une commande -> { title, qty, grams, cost (€) }.
function line(i) {
  const q = i.itemQuantity?.inSellableUnit;
  const g = q?.measurementUnit?.measurementType === 'MEASUREMENT_TYPE_WEIGHT' ? q.value.coefficient * 10 ** q.value.exponent : null;
  const kg = q?.measurementUnit?.weight?.unitType === 'WEIGHT_UNIT_TYPE_METRIC_KILOGRAM';
  return {
    cartItemUuid: i.shoppingCartItemUuid, itemUuid: i.uuid, title: i.title, qty: i.quantity, grams: g && Math.round(kg ? g * 1000 : g),
    cost: +((g ? i.price * g : i.price * i.quantity) / 100).toFixed(2), unavailable: !i.price,
  };
}

// Relit le panier réel. Un article passé en rupture reste dans le panier avec price = 0 (refusé au paiement),
// même si la recherche le montre encore disponible : c'est ce qu'il faut remplacer.
async function verify(api, draftUuid) {
  // Panier disparu (vidé, expiré ou déjà commandé) : missing = true, à recréer seulement si l'utilisateur le demande.
  if (!(await carts(api)).some(c => c.draftUuid === draftUuid))
    return { platform: 'ubereats', cartRef: draftUuid, missing: true, checkedAt: new Date().toISOString(), items: [], unavailable: [] };
  const d = await api('getDraftOrderByUuidV1', { draftOrderUuid: draftUuid });
  const items = d.shoppingCart.items.map(line);
  const co = await checkout(api, draftUuid);
  return {
    platform: 'ubereats', cartRef: draftUuid, draftUuid, storeUuid: d.storeUuid, checkedAt: new Date().toISOString(),
    items, unavailable: items.filter(i => i.unavailable), subtotal: co.subtotal, total: co.total, lines: co.lines,
  };
}

// Une commande payée garde l'uuid de son panier. Ses articles sont ceux réellement facturés : le magasin a pu en
// remplacer (même cartItemUuid, autre titre) ou en retirer.
async function order(api, draftUuid) {
  const base = { platform: 'ubereats', cartRef: draftUuid, checkedAt: new Date().toISOString() };
  const o = (await api('getPastOrdersV1', { lastWorkflowUUID: '' })).ordersMap?.[draftUuid];
  if (!o) {
    if ((await carts(api)).some(c => c.draftUuid === draftUuid)) return { ...base, status: 'cart' };
    // ponytail: format de getActiveOrdersV1 jamais vu rempli : on cherche juste l'uuid dans la réponse.
    const active = JSON.stringify(await api('getActiveOrdersV1', { orderUuid: null, timezone: 'Europe/Paris', showAppUpsellIllustration: true }));
    return { ...base, status: active.includes(draftUuid) ? 'delivering' : 'missing' };
  }
  const b = o.baseEaterOrder;
  return {
    ...base, status: b.isCancelled ? 'cancelled' : b.isCompleted ? 'delivered' : 'delivering',
    paidAt: b.orderStateChanges?.find(s => s.type === 'CREATED')?.stateChangeTime, deliveredAt: b.isCompleted ? b.completedAt : null,
    subtotal: o.fareInfo?.checkoutInfo?.find(c => c.key === 'eats_fare.subtotal')?.rawValue, total: o.fareInfo?.totalPrice / 100,
    items: b.shoppingCart.items.map(line),
  };
}

module.exports = { order, session, stores, search, getStore, flattenCatalog, grams, carts, fill, setQty, remove, clear, checkout, verify };

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
        order: () => order(api, args[0]),
      }[cmd];
      if (!out) throw new Error('Commande inconnue : ' + cmd);
      console.log(JSON.stringify(await out(), null, 1));
    } catch (e) { console.error(e.message); process.exitCode = 1; }
    finally { await ctx.close(); }
  })();
}
