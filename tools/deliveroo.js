// Client Deliveroo : rejoue l'API GraphQL du site (api.fr.deliveroo.com) depuis un vrai Chrome connecté.
// CLI : node tools/deliveroo.js <commande> [args]   (sortie JSON)
//   stores                         commerces (courses) livrables à l'adresse du profil
//   search <menuPath> <q1> [q2...] produits d'un commerce (menuPath = /menu/Lyon/lyon-ztl/xxx)
//   basket <menuPath>              panier du commerce + détail des frais et total (SANS commander)
//   fill <basket.json>             met les articles dans le panier (idempotent : quantité voulue, pas d'ajout en double) (basket = { menuPath, items: [résultat de search + qty] })
//   qty <menuPath> <legacyId> <qté> change la quantité (0 = supprimer)
//   clear <menuPath|all>           vide le panier du commerce (all = tous les paniers en cours)
//   verify <menuPath>              relit le panier et re-contrôle la disponibilité de chaque article dans le catalogue
//   order <menuPath> [depuis ISO]   commande passée dans ce commerce depuis la date ? status cart|missing|delivering|delivered|cancelled, total payé
//   (fill affiche directement le résultat de verify)
const fs = require('fs');
const path = require('path');
const { open, SESSION_DIR } = require('./browser');
const profile = require('./profile');

const BASE = 'https://deliveroo.fr';
const API = 'https://api.fr.deliveroo.com';
const LOC_CACHE = path.join(SESSION_DIR, 'deliveroo-location.json');

async function session() {
  const { ctx, page } = await open('deliveroo');
  let headers, basketQuery;
  // Les appels API exigent les en-têtes x-roo-* du site : on les récupère sur sa première requête GraphQL.
  // On garde aussi la requête getBasketPage du site (son pied de page contient le détail des frais).
  page.on('request', r => {
    if (!/consumer\/.*graphql/.test(r.url())) return;
    headers ||= r.headers();
    const q = (() => { try { return JSON.parse(r.postData()).query; } catch { return ''; } })();
    if (/query getBasketPage\b/.test(q)) basketQuery = q;
  });
  const loc = await location(page);
  await page.goto(BASE + loc.listingPath, { waitUntil: 'domcontentloaded' })
    .catch(() => page.goto(BASE + loc.listingPath, { waitUntil: 'domcontentloaded' }));
  for (let i = 0; i < 20 && !headers; i++) await page.waitForTimeout(500);
  if (!headers) throw new Error('En-têtes Deliveroo non capturés');
  const H = Object.fromEntries(Object.entries(headers).filter(([k]) => !/^(sec-|user-agent|referer|accept-encoding)/.test(k)));
  let last = 0;
  const gql = async (endpoint, query, variables, pause = 15) => {
    const gap = last + 300 - Date.now(); // rythme : 300 ms minimum entre deux appels
    if (gap > 0) await page.waitForTimeout(gap);
    last = Date.now();
    const r = await page.evaluate(async ([url, H, body]) => {
      const res = await fetch(url, { method: 'POST', headers: H, body });
      return res.status + '\n' + await res.text();
    }, [API + endpoint, H, JSON.stringify({ query, variables })]);
    const [status, ...rest] = r.split('\n');
    if (status === '429') {
      if (pause > 60) throw new Error('Deliveroo limite les requêtes (trop d\'appels récents) : réessaie dans quelques minutes');
      console.error(`⏳ Deliveroo limite les requêtes : pause ${pause} s puis nouvel essai`);
      await page.waitForTimeout(pause * 1000);
      return gql(endpoint, query, variables, pause * 2);
    }
    const j = JSON.parse(rest.join('\n'));
    if (status !== '200' || j.errors) throw new Error(`${endpoint} ${status}: ${JSON.stringify(j.errors || j).slice(0, 300)}`);
    return j.data;
  };
  return { ctx, page, gql, loc, basketQuery: () => basketQuery };
}

// Adresse -> geohash / quartier via le formulaire du site (mis en cache par adresse).
async function location(page) {
  const address = profile().address;
  const cache = fs.existsSync(LOC_CACHE) ? JSON.parse(fs.readFileSync(LOC_CACHE, 'utf8')) : {};
  if (cache.address === address) return cache;
  let body;
  page.on('request', r => { if (r.url().includes('location_routing')) body = JSON.parse(r.postData()); });
  await page.goto(BASE + '/fr/', { waitUntil: 'domcontentloaded' });
  await page.locator('#onetrust-accept-btn-handler').click({ timeout: 4000 }).catch(() => {});
  const inp = page.locator('#location-search');
  await inp.click();
  await inp.pressSequentially(address, { delay: 40 });
  // Première suggestion qui contient le code postal / la ville de l'adresse.
  const hint = (address.match(/\b\d{5}\b/) || [address.split(',').pop().trim()])[0];
  await page.getByText(new RegExp(hint)).first().click({ timeout: 10000 });
  await page.waitForURL(/geohash=/, { timeout: 20000 });
  const u = new URL(page.url());
  const [, , city, neighborhood] = u.pathname.split('/'); // /fr/restaurants/<city>/<neighborhood>
  const loc = {
    address, geohash: u.searchParams.get('geohash'), city_uname: city, neighborhood_uname: neighborhood,
    lat: body?.location?.lat, lon: body?.location?.lng, listingPath: u.pathname + u.search,
  };
  fs.mkdirSync(SESSION_DIR, { recursive: true });
  fs.writeFileSync(LOC_CACHE, JSON.stringify(loc, null, 1));
  return loc;
}

function nextData(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  return m && JSON.parse(m[1]);
}

const GROCERY = /carrefour|monoprix|monop|franprix|casino|auchan|intermarch|lidl|picard|naturalia|spar|g20|u-express|super-u|biocoop|vival|leclerc|market|epicerie|grocer|cocci|proxi|utile|bio-c-bon|la-vie-claire|grand-frais/i;

async function stores({ page, loc }) {
  await page.goto(`${BASE}${loc.listingPath}&collection=groceries`, { waitUntil: 'domcontentloaded' });
  const s = JSON.stringify(nextData(await page.content()) || {});
  const paths = [...new Set(s.match(/\/menu\/[^"?\\]+/g) || [])];
  return paths.filter(p => GROCERY.test(p)).map(p => ({ menuPath: p, url: BASE + '/fr' + p }));
}

// Infos d'un commerce, mises en cache le temps du process (évite de recharger sa page à chaque opération).
const storeCache = new Map();
async function storeInfo(page, menuPath, loc) {
  const key = menuPath.toLowerCase();
  if (!storeCache.has(key)) storeCache.set(key, loadStoreInfo(page, menuPath, loc).catch(e => { storeCache.delete(key); throw e; }));
  return storeCache.get(key);
}

async function loadStoreInfo(page, menuPath, loc) {
  await page.goto(`${BASE}/fr${menuPath}?geohash=${loc.geohash}`, { waitUntil: 'domcontentloaded' });
  const r = nextData(await page.content()).props.initialState.menuPage.menu.metas.root.restaurant;
  return { name: r.name, restaurantId: r.id, menuId: r.menuId, drnId: r.drnId, deliversHere: r.deliversToCustomerLocation, menuDisabled: r.menuDisabled };
}

const SEARCH_Q = `query s($options: SearchOptionsInput!) { result: get_search_results(options: $options) {
  layouts: ui_layouts { ... on UILayoutList { ui_blocks { ... on UIMenuItemCard { properties { id } } } } }
  meta { items { id drn_id name description price { fractional } price_discounted { fractional } available } } } }`;

// all = true : garde aussi les articles indisponibles (champ available), pour verify.
async function search({ page, gql, loc }, menuPath, queries, { all = false } = {}) {
  const st = await storeInfo(page, menuPath, loc);
  const res = { store: st.name, menuPath, ...st, results: {} };
  for (const q of queries) {
    const d = await gql('/consumer/menus/graphql/', SEARCH_Q, { options: {
      branch_drn_id: st.drnId, restaurant_id: st.restaurantId, menu_id: st.menuId,
      location: { geohash: loc.geohash, city_uname: loc.city_uname, neighborhood_uname: loc.neighborhood_uname, country_iso_code: 'FR', lat: loc.lat, lon: loc.lon },
      delivery_day: 'TODAY', delivery_time: 'ASAP', fulfillment_method: 'DELIVERY',
      params: [{ id: 'search_type', value: ['IN_MENU'] }], query: q,
    } });
    const byId = Object.fromEntries(d.result.meta.items.map(i => [i.id, i]));
    const ids = d.result.layouts.flatMap(l => l.ui_blocks || []).map(b => b.properties?.id).filter(Boolean);
    res.results[q] = ids.map(id => byId[id]).filter(i => i && (all || i.available)).slice(0, 15).map(i => ({
      available: i.available,
      itemId: i.id, drnId: i.drn_id, title: i.name, price: (i.price_discounted || i.price).fractional / 100,
      perKg: (i.description || '').match(/^[\d.,]+ € \/ \w+/)?.[0],
    }));
  }
  return res;
}

// ---- Panier (un par commerce, identifié par son branch drnId) ----
const basketOptions = (loc, branchId) => ({
  fulfillment_method: 'DELIVERY', delivery_time: { time: 'ASAP', day: 'TODAY' }, location: { lat: loc.lat, lon: loc.lon },
  branch_id: branchId, fulfillment_include_asap_days: true,
});
const ITEMS = 'meta { basket { items { legacy_id menu_item_drn_id name quantity unit_price_fractional } } }';

// Toutes les lignes "libellé … montant" d'un bloc UI Deliveroo (pied de page du panier).
function rows(node, out = []) {
  if (Array.isArray(node)) node.forEach(n => rows(n, out));
  else if (node && typeof node === 'object') {
    if (node.typeName === 'UIBasicRow') {
      const txt = parts => JSON.stringify(parts || []).match(/"text":"[^"]*"/g)?.map(t => t.slice(8, -1)).join(' ') || '';
      const label = txt(node.contentStart), amount = txt(node.contentEnd);
      if (label || amount) out.push({ label, amount });
    } else Object.values(node).forEach(n => rows(n, out));
  }
  return out;
}

async function basket(s, menuPath) {
  const st = await storeInfo(s.page, menuPath, s.loc);
  for (let i = 0; i < 20 && !s.basketQuery(); i++) await s.page.waitForTimeout(500);
  const d = (await s.gql('/consumer/basket/graphql', s.basketQuery(), {
    options: basketOptions(s.loc, st.drnId), include_token: true,
    capabilities: { ui_list_components: ['UI_BUTTON_GROUP'], ui_action_types: ['REFRESH_BASKET'], ui_icons: [] },
  })).get_basket_page;
  const items = d.meta.basket.items.map(i => ({ legacyId: i.legacyId, drnId: i.menuItemDrnId, title: i.name, qty: i.quantity, unitPrice: i.unitPriceFractional / 100 }));
  const lines = rows(d.footer);
  const eur = t => +(t || '').replace(/[^\d,]/g, '').replace(',', '.') || null;
  return {
    store: st.name, menuPath, branchId: st.drnId, items,
    subtotal: d.meta.basket.subtotalBeforeDiscounts.fractional / 100,
    total: eur(lines.find(l => /total/i.test(l.label))?.amount), lines,
  };
}

// Idempotent : un article déjà présent est mis à la quantité voulue (relancer une étape ne double rien).
async function fill(s, { menuPath, items }) {
  const st = await storeInfo(s.page, menuPath, s.loc);
  const o = basketOptions(s.loc, st.drnId);
  const { get_basket_page: cur } = await s.gql('/consumer/basket/graphql', 'query q($o: BasketOptionsInput!) { get_basket_page(options: $o) { ' + ITEMS + ' } }', { o });
  const have = new Map(cur.meta.basket.items.map(i => [i.menu_item_drn_id, i]));
  for (const it of items) {
    const h = have.get(it.drnId), qty = it.qty || 1;
    if (h && h.quantity === qty) continue;
    if (h) await s.gql('/consumer/basket/graphql', `mutation m($o: BasketOptionsInput!, $i: EditBasketItemInput!) { edit_basket_item(options: $o, item: $i) { __typename } }`,
      { o, i: { legacy_id: h.legacy_id, quantity: qty } });
    else await s.gql('/consumer/basket/graphql', `mutation m($o: BasketOptionsInput!, $i: AddBasketItemInput!) { add_basket_item(options: $o, item: $i) { ${ITEMS} } }`,
      { o: { ...o, force_new: false, confirm_user_age_over_18: false }, i: { menu_item_drn_id: it.drnId, quantity: qty, modifier_groups: [] } });
  }
  return basket(s, menuPath);
}

async function setQty(s, menuPath, legacyId, qty) {
  const st = await storeInfo(s.page, menuPath, s.loc);
  await s.gql('/consumer/basket/graphql', `mutation m($o: BasketOptionsInput!, $i: EditBasketItemInput!) { edit_basket_item(options: $o, item: $i) { ${ITEMS} } }`,
    { o: basketOptions(s.loc, st.drnId), i: { legacy_id: legacyId, quantity: +qty } });
  return basket(s, menuPath);
}

// Vide le panier en cours tant qu'il y en a un (Deliveroo n'expose que le panier "courant" : pas de liste).
async function clearAll(s) {
  const done = [];
  for (let i = 0; i < 20; i++) {
    const { summary } = await s.gql('/consumer/basket/graphql', 'query { summary: get_basket_page_summary { url: target_url } }', {});
    const url = summary?.url;
    if (!url) break;
    const menuPath = new URL(url).pathname.replace(/^\/fr/, '');
    if (done.includes(menuPath)) throw new Error('Panier non vidé : ' + menuPath);
    await clear(s, menuPath);
    done.push(menuPath);
  }
  return { cleared: done };
}

// clear_basket ne vide pas réellement le panier : on met chaque article à 0 (méthode vérifiée).
async function clear(s, menuPath) {
  const st = await storeInfo(s.page, menuPath, s.loc);
  const { get_basket_page: d } = await s.gql('/consumer/basket/graphql',
    'query q($o: BasketOptionsInput!) { get_basket_page(options: $o) { ' + ITEMS + ' } }', { o: basketOptions(s.loc, st.drnId) });
  for (const it of d.meta.basket.items)
    await s.gql('/consumer/basket/graphql', `mutation m($o: BasketOptionsInput!, $i: EditBasketItemInput!) { edit_basket_item(options: $o, item: $i) { __typename } }`,
      { o: basketOptions(s.loc, st.drnId), i: { legacy_id: it.legacy_id, quantity: 0 } });
  return basket(s, menuPath);
}

// Le panier Deliveroo n'indique pas les ruptures : on recherche chaque article dans le catalogue du commerce.
// Article non retrouvé par la recherche = "unverified" (statut inconnu, pas une rupture). Par défaut Deliveroo
// remplace lui-même un article manquant (backup ALLOW_PARTNER_SUBSTITUTIONS).
async function verify(s, menuPath) {
  const b = await basket(s, menuPath);
  // Panier vide = disparu (vidé, expiré ou déjà commandé).
  if (!b.items.length) return { platform: 'deliveroo', cartRef: menuPath, store: b.store, missing: true, checkedAt: new Date().toISOString(), items: [], unavailable: [] };
  const queries = b.items.map(i => i.title.split(/ - | {2}/)[0].slice(0, 60));
  const found = (await search(s, menuPath, [...new Set(queries)], { all: true })).results;
  const items = b.items.map((i, k) => {
    const hit = (found[queries[k]] || []).find(x => x.drnId === i.drnId);
    return { legacyId: i.legacyId, title: i.title, qty: i.qty, cost: +(i.unitPrice * i.qty).toFixed(2), unavailable: hit ? !hit.available : false, unverified: !hit };
  });
  return {
    platform: 'deliveroo', cartRef: menuPath, store: b.store, checkedAt: new Date().toISOString(),
    items, unavailable: items.filter(i => i.unavailable), subtotal: b.subtotal, total: b.total, lines: b.lines,
  };
}

// Deliveroo ne relie pas une commande à son panier : on prend la commande de ce commerce passée depuis <since>
// (historique de la page /fr/orders). ponytail: pas le détail des articles facturés (page de chaque commande).
async function order(s, menuPath, since) {
  const st = await storeInfo(s.page, menuPath, s.loc);
  await s.page.goto(BASE + '/fr/orders', { waitUntil: 'domcontentloaded' });
  const orders = nextData(await s.page.content())?.props.initialState.order?.history?.orders || [];
  const o = orders.find(x => String(x.restaurantId) === String(st.restaurantId) && new Date(x.legacySubmittedDate) >= new Date(since || 0));
  const base = { platform: 'deliveroo', cartRef: menuPath, checkedAt: new Date().toISOString() };
  if (!o) return { ...base, status: (await basket(s, menuPath)).items.length ? 'cart' : 'missing' };
  return {
    ...base, orderId: o.id, status: o.status === 'DELIVERED' ? 'delivered' : /CANCEL|FAIL|REJECT/.test(o.status) ? 'cancelled' : 'delivering',
    paidAt: o.legacySubmittedDate, deliveredAt: o.status === 'DELIVERED' ? o.statusTimestamp : null, total: +o.balance,
  };
}

module.exports = { order, session, stores, search, storeInfo, basket, fill, setQty, clear, clearAll, verify };

if (require.main === module) {
  (async () => {
    const [cmd, ...args] = process.argv.slice(2);
    const s = await session();
    try {
      const out = {
        stores: () => stores(s),
        search: () => search(s, args[0], args.slice(1)),
        basket: () => basket(s, args[0]),
        fill: async () => { const b = JSON.parse(fs.readFileSync(args[0], 'utf8')); await fill(s, b); return verify(s, b.menuPath); },
        verify: () => verify(s, args[0]),
        order: () => order(s, args[0], args[1]),
        qty: () => setQty(s, args[0], args[1], args[2]),
        clear: () => args[0] === 'all' ? clearAll(s) : clear(s, args[0]),
      }[cmd];
      if (!out) throw new Error('Commande inconnue : ' + cmd);
      console.log(JSON.stringify(await out(), null, 1));
    } catch (e) { console.error(e.message); process.exitCode = 1; }
    finally { await s.ctx.close(); }
  })();
}
