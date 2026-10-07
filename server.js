// Interface web locale : npm start  ->  http://localhost:3000
// L'IA (Claude Code en mode -p) n'intervient que pour proposer les menus et composer les paniers ;
// le reste (profil, connexion, choix, PDF, notes) passe par les outils de tools/ sans IA.
// HOST=0.0.0.0 pour l'ouvrir au réseau local : ATTENTION, aucune authentification (tes sessions Uber/Deliveroo).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const menus = require('./tools/menus');
const recipes = require('./tools/recipes');
const { sessionExpiry } = require('./tools/browser');

const ROOT = __dirname;
const ORDERS = path.join(ROOT, 'orders');
const PROFILE = path.join(ROOT, 'profile.json');
const PORT = +process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';

const readJson = (f, dflt = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return dflt; } };
const writeJson = (f, d) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(d, null, 1)); };
const orderDir = id => {
  if (!/^[\w-]{1,40}$/.test(id)) throw Object.assign(new Error('Commande invalide'), { status: 400 });
  return path.join(ORDERS, id);
};

// ---- Tâches : une seule à la fois (un profil Chrome ne s'ouvre qu'une fois). ----
// ponytail: file en mémoire, perdue au redémarrage (les fichiers de la commande, eux, restent).
const jobs = [];
let running = null;

function enqueue(orderId, label, run) {
  const job = { id: jobs.length + 1, orderId, label, status: 'queued', log: [], at: Date.now() };
  job.run = run;
  jobs.push(job);
  pump();
  return job;
}

async function pump() {
  if (running) return;
  const job = jobs.find(j => j.status === 'queued');
  if (!job) return;
  running = job;
  job.status = 'running';
  job.startedAt = Date.now();
  try { await job.run(job); job.status = 'done'; }
  catch (e) { job.status = 'error'; job.log.push('❌ ' + e.message); }
  running = null;
  pump();
}

const say = (job, line) => { job.log.push(line); if (job.log.length > 300) job.log.shift(); };

function spawnLogged(job, cmd, args, onLine) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: ROOT, env: process.env });
    let buf = '', err = '';
    p.stdout.on('data', d => {
      buf += d;
      const lines = buf.split('\n'); buf = lines.pop();
      lines.forEach(l => l.trim() && onLine(l));
    });
    p.stderr.on('data', d => { err += d; String(d).split('\n').filter(Boolean).forEach(l => say(job, l.slice(0, 300))); });
    p.on('error', reject);
    p.on('close', code => { if (buf.trim()) onLine(buf); code === 0 ? resolve() : reject(new Error(`${cmd} a échoué (code ${code}) ${err.slice(-300)}`)); });
  });
}

const node = (job, ...args) => spawnLogged(job, process.execPath, args, l => say(job, l.slice(0, 300)));

// Lance un outil et renvoie sa sortie JSON (les lignes ne vont pas dans le journal).
async function nodeJson(job, ...args) {
  let out = '';
  await spawnLogged(job, process.execPath, args, l => { out += l + '\n'; });
  return JSON.parse(out);
}

// Claude Code en arrière-plan, avec suivi des étapes (outils lancés, messages).
function claude(job, prompt) {
  let result = null;
  return spawnLogged(job, 'claude', [
    '-p', prompt, '--output-format', 'stream-json', '--verbose',
    '--allowedTools', 'Bash(node tools/*)', 'Bash(npm run check)', 'Read', 'Write', 'Edit', 'Glob', 'Grep',
  ], line => {
    let e; try { e = JSON.parse(line); } catch { return; }
    if (e.type === 'assistant') for (const c of e.message.content) {
      if (c.type === 'tool_use') say(job, '▶ ' + (c.input.description || c.input.command || c.input.file_path || c.name));
      if (c.type === 'text' && c.text.trim()) say(job, '💬 ' + c.text.trim().slice(0, 400));
    }
    if (e.type === 'result') result = e;
  }).then(() => {
    if (!result || result.is_error) throw new Error('Claude n\'a pas terminé : ' + (result?.result || 'pas de résultat'));
  });
}

// ---- Étapes d'une commande ----
const P_MENUS = (id, again, d = menus.draw(), g = readJson(path.join(orderDir(id), 'request.json'))?.guide || {}) => `Mode web, commande ${id}. Lis CLAUDE.md (section « Mode web ») et knowledge/.
Demande : orders/${id}/request.json. Étape MENUS uniquement : écris orders/${id}/menus.json (2 à 3 propositions).
${g.cuisines?.length || g.styles?.length || g.proteins?.length ? `Envies cochées par l'utilisateur (prioritaires) :${g.cuisines?.length ? ` cuisines ${g.cuisines.join(', ')} ;` : ''}${g.styles?.length ? ` style ${g.styles.join(', ')} ;` : ''}${g.proteins?.length ? ` plutôt ${g.proteins.join(', ')} ;` : ''}
varie les plats à l'intérieur de ces envies (régions, techniques) et complète avec la saison.
` : ''}Tirage de variété pour cette commande (cf. knowledge/menus.md « Variété entre commandes ») — les envies et exceptions de request.json passent avant :
- ${g.cuisines?.length ? `cuisines : celles cochées ci-dessus (pas le tirage)` : `cuisines à explorer (au moins 2 dans les menus) : ${d.cuisines.join(', ')}`} ;
- produits de saison en ${d.month} à mettre en vedette : ${d.seasonal.join(', ')} (saison complète : ${d.allSeasonal}) ;
- plats récents à ne pas reproposer : ${d.avoid.join(' ; ') || 'aucun'}.
${again ? `Les propositions précédentes n'ont pas été retenues : tiens compte de orders/${id}/choice.json (refus, remarques).` : ''}
Ne touche à aucun panier, ne lance pas menus.js choose.`;

const P_BASKETS = id => `Mode web, commande ${id}. Lis CLAUDE.md (section « Mode web ») et knowledge/.
Demande : orders/${id}/request.json, menus : orders/${id}/menus.json, choix de l'utilisateur : orders/${id}/choice.json.
Fais toute la suite (sondage des articles les plus chers puis comparaison complète sur les meilleurs magasins, pour
économiser les requêtes) jusqu'aux totaux réels de 2 à 3 paniers remplis, puis écris orders/${id}/result.json.
Si une tentative précédente a laissé des paniers (orders/${id}/baskets/*.fill.json : cartRef), réutilise ceux des magasins
retenus (fill est idempotent) et vide les autres (clear <cartRef>). Ne vide aucun autre panier, ne génère pas le PDF,
ne passe jamais commande.`;

const P_REPAIR = (id, b, cart) => `Mode web, commande ${id}. Lis CLAUDE.md (section « Mode web », réparation) et knowledge/.
Le panier choisi « ${b.id} » (${b.platform}, cartRef ${b.cartRef}) contient des articles devenus indisponibles, refusés au paiement :
${cart.unavailable.map(i => `- ${i.title} (${i.cartItemUuid || i.legacyId})`).join('\n')}
Remplace-les par des équivalents vérifiés, adapte recettes/plan si besoin, mets à jour le panier « ${b.id} » de result.json
(perMeal, subtotal, total) et écris orders/${id}/repair.json. Ne passe jamais commande, ne touche à aucun autre panier.`;

const P_REBUILD = (id, b, store) => `Mode web, commande ${id}. Lis CLAUDE.md (section « Mode web », réparation) et knowledge/.
Le panier choisi « ${b.id} » (${b.platform}, magasin ${store}, ancien cartRef ${b.cartRef}) n'existe plus : l'utilisateur demande de le RECRÉER.
Contenu à reproduire : orders/${id}/cart.json (dernier contenu vérifié) ou, à défaut, ${b.basketFile}.
Retrouve chaque produit dans ce magasin (search), remplis le panier (fill), remplace ce qui est indisponible, puis mets à jour
le panier « ${b.id} » de result.json (cartRef = nouveau draftUuid pour Uber Eats, subtotal, total, perMeal) et écris orders/${id}/repair.json.
Ne passe jamais commande, ne touche à aucun autre panier.`;

function chosenBasket(dir) {
  const result = readJson(path.join(dir, 'result.json')), pick = readJson(path.join(dir, 'pick.json'));
  const b = result?.baskets?.find(x => x.id === pick?.basketId);
  if (!b) throw new Error('Aucun panier choisi');
  if (!b.cartRef) throw new Error('Panier sans référence (cartRef) : impossible de le vérifier');
  return b;
}

const verifyCart = async (job, b) => nodeJson(job, `tools/${b.platform === 'ubereats' ? 'ubereats' : 'deliveroo'}.js`, 'verify', b.cartRef);

// Écarts entre le dernier panier vérifié et ce que le magasin a réellement facturé (remplacements, manques, quantités).
function orderChanges(before = [], after = []) {
  const key = i => i.cartItemUuid || i.title, now = new Map(after.map(i => [key(i), i])), out = [];
  for (const i of before) {
    const j = now.get(key(i));
    now.delete(key(i));
    if (!j) out.push({ type: 'removed', from: i.title, cost: [i.cost, 0] });
    else if (j.title !== i.title) out.push({ type: 'replaced', from: i.title, to: j.title, cost: [i.cost, j.cost] });
    else if (j.qty !== i.qty || j.grams !== i.grams || j.cost !== i.cost) out.push({ type: 'changed', from: i.title, cost: [i.cost, j.cost], ...(i.grams && { grams: [i.grams, j.grams] }) });
  }
  for (const j of now.values()) out.push({ type: 'added', to: j.title, cost: [0, j.cost] });
  return out;
}

const STATUS = { delivering: 'payée, en livraison', delivered: 'livrée', cancelled: 'annulée' };

// Actualise la commande : payée ? livrée ? total et articles réellement facturés -> order.json.
// Pas encore payée (panier toujours là, ou disparu sans commande) : vérification du stock comme avant.
async function refresh(job, id) {
  const dir = orderDir(id), b = chosenBasket(dir), pick = readJson(path.join(dir, 'pick.json'));
  say(job, `🔎 Recherche de la commande ${b.store}`);
  const o = await nodeJson(job, `tools/${b.platform === 'ubereats' ? 'ubereats' : 'deliveroo'}.js`, 'order', b.cartRef, pick.at);
  if (['cart', 'missing'].includes(o.status)) { say(job, 'Pas encore payée : vérification du panier'); return checkAndRepair(job, id); }
  const cart = readJson(path.join(dir, 'cart.json'));
  o.expected = cart?.total ?? b.total;
  if (o.items) o.changes = orderChanges(cart?.items, o.items);
  writeJson(path.join(dir, 'order.json'), o);
  say(job, `✅ Commande ${STATUS[o.status]} — ${o.total?.toFixed(2)} € payés (prévu ${o.expected?.toFixed(2)} €)${o.changes?.length ? `, ${o.changes.length} changement(s)` : ''}`);
  await buildPdf(job, id);
}

// PDF : liste de courses = contenu RÉEL du panier (cart.json), prix par repas = perMeal du panier choisi.
async function buildPdf(job, id) {
  const dir = orderDir(id);
  const plan = readJson(path.join(dir, 'plan.json'));
  if (!plan) return;
  const b = chosenBasket(dir), cart = readJson(path.join(dir, 'cart.json')), paid = readJson(path.join(dir, 'order.json'));
  const items = paid?.items || cart?.items || readJson(path.join(ROOT, b.basketFile))?.items || [];
  plan.shopping = items.filter(i => !i.unavailable).map(i => ({ name: i.title, qty: i.grams ? `${Math.round(i.grams)} g` : `× ${i.qty || 1}`, price: i.cost ?? i.price }));
  const total = paid?.total ?? cart?.total ?? b.total, subtotal = paid?.subtotal ?? cart?.subtotal ?? b.subtotal;
  plan.shoppingNote = `${b.platform === 'ubereats' ? 'Uber Eats' : 'Deliveroo'} · ${b.store} — produits ${subtotal?.toFixed(2)} € · total ${total?.toFixed(2)} € (frais inclus)${paid ? ` · payé le ${new Date(paid.paidAt).toLocaleString('fr-FR')}` : cart ? ` · panier vérifié le ${new Date(cart.checkedAt).toLocaleString('fr-FR')}` : ''}.`;
  for (const m of plan.meals) { const pm = (b.perMeal || []).find(x => x.when === m.when); if (pm) m.cost = pm.cost; }
  plan.people = readJson(path.join(dir, 'request.json'))?.people;
  plan.paid = total;
  writeJson(path.join(dir, 'plan.json'), plan);
  say(job, '📄 Génération du PDF des recettes');
  await recipes.pdf(path.join(dir, 'plan.json'), path.join(dir, 'recettes.pdf'));
}

// Vérifie le panier choisi ; si des articles sont en rupture, l'IA les remplace, puis on revérifie. PDF mis à jour.
async function checkAndRepair(job, id, { rebuild = false } = {}) {
  const dir = orderDir(id);
  let b = chosenBasket(dir);
  say(job, `🔎 Vérification du panier ${b.store}`);
  let cart = await verifyCart(job, b);
  if (cart.missing) {
    const prev = readJson(path.join(dir, 'cart.json'));
    if (!rebuild) {
      // On garde le dernier contenu connu (sert à recréer le panier) et on signale la disparition.
      writeJson(path.join(dir, 'cart.json'), { ...prev, missing: true, checkedAt: cart.checkedAt });
      say(job, '⚠️ Ce panier n\'existe plus (déjà commandé, vidé ou expiré) : bouton « Recréer le panier » si besoin.');
      return;
    }
    say(job, '♻️ Recréation du panier');
    const store = readJson(path.join(ROOT, b.basketFile))?.storeUuid || b.cartRef;
    fs.rmSync(path.join(dir, 'repair.json'), { force: true });
    await claude(job, P_REBUILD(id, b, store));
    b = chosenBasket(dir);
    cart = await verifyCart(job, b);
    if (cart.missing) throw new Error('Le panier n\'a pas pu être recréé');
  }
  writeJson(path.join(dir, 'cart.json'), cart);
  if (cart.unavailable.length) {
    say(job, `⚠️ ${cart.unavailable.length} article(s) indisponible(s) : ${cart.unavailable.map(i => i.title).join(', ')}`);
    fs.rmSync(path.join(dir, 'repair.json'), { force: true });
    await claude(job, P_REPAIR(id, b, cart));
    b = chosenBasket(dir);
    say(job, '🔎 Nouvelle vérification');
    cart = await verifyCart(job, b);
    writeJson(path.join(dir, 'cart.json'), cart);
    if (cart.unavailable.length) say(job, `⚠️ Toujours indisponible : ${cart.unavailable.map(i => i.title).join(', ')}`);
  } else say(job, `✅ Tout est disponible — total ${cart.total?.toFixed(2)} €`);
  await buildPdf(job, id);
}

function startVerify(id, rebuild = false) {
  orderDir(id);
  return enqueue(id, rebuild ? 'Recréation du panier' : 'Actualisation', job => rebuild ? checkAndRepair(job, id, { rebuild }) : refresh(job, id));
}

function startMenus(id, again = false) {
  const dir = orderDir(id);
  return enqueue(id, again ? 'Nouvelles propositions de menus' : 'Propositions de menus', async job => {
    fs.rmSync(path.join(dir, 'menus.json'), { force: true });
    await claude(job, P_MENUS(id, again));
    if (!readJson(path.join(dir, 'menus.json'))?.options?.length) throw new Error('menus.json absent ou vide');
  });
}

function startBaskets(id) {
  const dir = orderDir(id);
  return enqueue(id, 'Comparaison des paniers', async job => {
    fs.rmSync(path.join(dir, 'result.json'), { force: true });
    await claude(job, P_BASKETS(id));
    if (!readJson(path.join(dir, 'result.json'))?.baskets?.length) throw new Error('result.json absent ou vide');
  });
}

// Choix du panier : vide les autres (créés par l'agent), puis PDF avec la liste de courses. Sans IA.
function startPick(id, basketId) {
  const dir = orderDir(id);
  const result = readJson(path.join(dir, 'result.json'));
  const chosen = result?.baskets?.find(b => b.id === basketId);
  if (!chosen) throw Object.assign(new Error('Panier inconnu'), { status: 400 });
  return enqueue(id, 'Finalisation', async job => {
    for (const b of result.baskets.filter(b => b.id !== basketId && b.cartRef)) {
      say(job, `🧹 Vidage du panier ${b.platform} · ${b.store}`);
      await node(job, `tools/${b.platform === 'ubereats' ? 'ubereats' : 'deliveroo'}.js`, 'clear', b.cartRef);
    }
    writeJson(path.join(dir, 'pick.json'), { basketId, at: new Date().toISOString() });
    await checkAndRepair(job, id);
  });
}

// Supprime une commande. Tant qu'aucun panier n'est choisi, vide aussi les paniers que l'IA a remplis
// (baskets/*.fill.json) ; une fois choisi, on n'y touche plus (il est peut-être en train d'être payé).
// Plats au plan de chaque commande : { id: [slug] }.
const plans = () => Object.fromEntries(!fs.existsSync(ORDERS) ? [] : fs.readdirSync(ORDERS)
  .map(d => [d, (readJson(path.join(ORDERS, d, 'plan.json'))?.meals || []).map(m => m.recipe)]));

// Plats de cette commande qu'aucune autre commande ne prévoit (proposés à la suppression avec elle).
const ownRecipes = id => { const p = plans(); return [...new Set(p[id] || [])].filter(r => !Object.entries(p).some(([o, rs]) => o !== id && rs.includes(r))); };

// « Mes plats » : plats d'une commande payée (pas seulement choisie), ou déjà notés / cuisinés.
function myRecipes() {
  const paid = new Set(Object.entries(plans()).filter(([o]) => ['delivering', 'delivered'].includes(readJson(path.join(ORDERS, o, 'order.json'))?.status)).flatMap(([, rs]) => rs));
  return recipes.list().filter(r => paid.has(r.slug) || r.timesMade || r.rating || r.notes.length);
}

function deleteOrder(id, withRecipes = false) {
  const v = orderView(id), dir = orderDir(id), own = withRecipes ? ownRecipes(id) : [];
  if (['queued', 'running'].includes(v.job?.status)) throw Object.assign(new Error('Une étape est en cours : attends qu\'elle finisse'), { status: 409 });
  const bdir = path.join(dir, 'baskets');
  const carts = v.pick || !fs.existsSync(bdir) ? [] : [...new Map(fs.readdirSync(bdir).filter(f => f.endsWith('.fill.json'))
    .map(f => readJson(path.join(bdir, f))).filter(c => c?.cartRef && !c.missing).map(c => [c.cartRef, c])).values()];
  fs.rmSync(dir, { recursive: true, force: true });
  for (const r of own) recipes.remove(r);
  if (carts.length) enqueue(null, 'Vidage des paniers d\'une commande supprimée', async job => {
    for (const c of carts) {
      say(job, `🧹 Vidage du panier ${c.platform} · ${c.store || c.cartRef}`);
      try { await node(job, `tools/${c.platform === 'ubereats' ? 'ubereats' : 'deliveroo'}.js`, 'clear', c.cartRef); }
      catch (e) { say(job, '⚠️ ' + e.message); } // déjà vidé ou expiré : on continue avec les autres
    }
  });
  return carts.length;
}

function orderView(id) {
  const dir = orderDir(id);
  if (!fs.existsSync(dir)) throw Object.assign(new Error('Commande introuvable'), { status: 404 });
  const f = n => readJson(path.join(dir, n));
  const job = [...jobs].reverse().find(j => j.orderId === id);
  const plan = f('plan.json');
  // Titres des recettes pour l'affichage du plan (une recette manquante ne doit pas casser la page).
  for (const m of plan?.meals || []) { try { m.title = recipes.recipe(m.recipe).title; } catch { m.title = m.recipe; } }
  return {
    id, request: f('request.json'), menus: f('menus.json'), choice: f('choice.json'), result: f('result.json'),
    plan, ownRecipes: ownRecipes(id).map(slug => plan.meals.find(m => m.recipe === slug).title), pick: f('pick.json'), cart: f('cart.json'), order: f('order.json'), repair: f('repair.json'), hasPdf: fs.existsSync(path.join(dir, 'recettes.pdf')),
    job: job && { label: job.label, status: job.status, log: job.log.slice(-60), queued: jobs.filter(j => j.status === 'queued').indexOf(job), startedAt: job.startedAt },
  };
}

function listOrders() {
  if (!fs.existsSync(ORDERS)) return [];
  return fs.readdirSync(ORDERS).filter(d => fs.statSync(path.join(ORDERS, d)).isDirectory()).sort().reverse().map(id => {
    const v = orderView(id);
    const state = v.order ? cap(STATUS[v.order.status]) : v.pick ? 'À payer' : v.result ? 'Paniers à choisir' : v.choice?.chosen ? 'Paniers en préparation'
      : v.menus ? 'Menu à choisir' : 'Menus en préparation';
    // step : 0 menus en préparation, 1 menu à choisir, 2 paniers (préparation ou choix), 3 terminée
    const step = v.pick ? 3 : v.result || v.choice?.chosen ? 2 : v.menus ? 1 : 0;
    const b = v.pick && v.result?.baskets?.find(x => x.id === v.pick.basketId);
    return {
      id, title: v.request?.title || v.plan?.title || id, state, step, busy: ['queued', 'running'].includes(v.job?.status),
      error: v.job?.status === 'error', stalled: !v.job && !v.pick && !(v.menus && !v.choice?.chosen) && !v.result, meals: v.request?.slots?.length || v.plan?.meals?.length || 0, people: v.request?.people,
      createdAt: v.request?.createdAt, menu: v.choice?.chosen?.name, store: b?.store, platform: b?.platform, total: v.order?.total ?? v.cart?.total ?? b?.total,
      status: v.order?.status,
    };
  });
}

// ---- Validation des entrées ----
const cap = s => s && s[0].toUpperCase() + s.slice(1);
const strList = v => (Array.isArray(v) ? v : String(v || '').split(',')).map(s => String(s).trim()).filter(Boolean).slice(0, 50);

function cleanProfile(p) {
  if (!p || typeof p.address !== 'string' || !p.address.trim()) throw Object.assign(new Error('Adresse obligatoire'), { status: 400 });
  const people = Number(p.people);
  if (!(Number.isInteger(people) && people >= 1 && people <= 20)) throw Object.assign(new Error('Nombre de personnes : 1 à 20'), { status: 400 });
  return {
    address: p.address.trim().slice(0, 200), people,
    equipment: strList(p.equipment), noEquipment: strList(p.noEquipment), allergies: strList(p.allergies),
    diet: strList(p.diet), pantry: strList(p.pantry), preferences: String(p.preferences || '').slice(0, 1000),
    subscriptions: { uberOne: !!p.subscriptions?.uberOne, deliverooPlus: !!p.subscriptions?.deliverooPlus },
  };
}

function cleanRequest(r, profile) {
  const slots = strList(r.slots);
  if (!slots.length) throw Object.assign(new Error('Choisis au moins un repas'), { status: 400 });
  const people = Number(r.people) || profile.people;
  return {
    title: String(r.title || `Repas : ${slots[0]} → ${slots.at(-1)}`).slice(0, 120), slots, people,
    guide: Object.fromEntries(['cuisines', 'styles', 'proteins'].map(k => [k, strList(r.guide?.[k]).map(s => s.slice(0, 40)).slice(0, 15)])),
    exceptions: String(r.exceptions || '').slice(0, 1000), extras: String(r.extras || '').slice(0, 1000),
    wishes: String(r.wishes || '').slice(0, 1000), budget: String(r.budget || 'équilibré').slice(0, 50),
    platforms: strList(r.platforms).filter(p => ['ubereats', 'deliveroo'].includes(p)),
    createdAt: new Date().toISOString(),
  };
}

// ---- HTTP ----
const send = (res, status, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
};

const readBody = req => new Promise((resolve, reject) => {
  let b = '';
  req.on('data', d => { b += d; if (b.length > 200e3) { reject(Object.assign(new Error('Requête trop grosse'), { status: 413 })); req.destroy(); } });
  req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { reject(Object.assign(new Error('JSON invalide'), { status: 400 })); } });
});

const routes = [
  ['GET', /^\/$/, (req, res) => send(res, 200, fs.readFileSync(path.join(ROOT, 'web', 'index.html')), 'text/html; charset=utf-8')],
  ['GET', /^\/style\.css$/, (req, res) => send(res, 200, fs.readFileSync(path.join(ROOT, 'web', 'style.css')), 'text/css; charset=utf-8')],

  ['GET', /^\/o\/([\w-]+)\/menus$/, (req, res, id) => {
    const m = readJson(path.join(orderDir(id), 'menus.json'));
    if (!m) return send(res, 404, 'Menus pas encore prêts', 'text/plain; charset=utf-8');
    send(res, 200, menus.html(m, { postUrl: `/api/orders/${id}/choice`, backUrl: `/#/o/${id}` }), 'text/html; charset=utf-8');
  }],

  ['GET', /^\/api\/profile$/, (req, res) => send(res, 200, { exists: fs.existsSync(PROFILE), profile: readJson(PROFILE) || readJson(path.join(ROOT, 'profile.example.json')) })],
  ['PUT', /^\/api\/profile$/, async (req, res) => { const p = cleanProfile(await readBody(req)); writeJson(PROFILE, p); send(res, 200, p); }],

  ['GET', /^\/api\/accounts$/, (req, res) => {
    const exp = { ubereats: sessionExpiry('ubereats'), deliveroo: sessionExpiry('deliveroo') };
    send(res, 200, { ubereats: exp.ubereats > 0, deliveroo: exp.deliveroo > 0, expires: exp, busy: running?.label || null });
  }],
  ['POST', /^\/api\/accounts\/(ubereats|deliveroo)\/(login|clear)$/, (req, res, p, action) => {
    const job = action === 'login'
      ? enqueue(null, `Connexion ${p}`, j => node(j, 'tools/login.js', p))
      : enqueue(null, `Vidage des paniers ${p}`, j => node(j, `tools/${p}.js`, 'clear', 'all'));
    send(res, 202, { job: job.id });
  }],
  ['GET', /^\/api\/jobs$/, (req, res) => send(res, 200, jobs.slice(-20).map(({ run, ...j }) => ({ ...j, log: j.log.slice(-20) })))],

  ['GET', /^\/api\/orders$/, (req, res) => send(res, 200, listOrders())],
  ['POST', /^\/api\/orders$/, async (req, res) => {
    const profile = readJson(PROFILE);
    if (!profile) throw Object.assign(new Error('Remplis d\'abord ton profil'), { status: 400 });
    const r = cleanRequest(await readBody(req), profile);
    const id = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
    if (fs.existsSync(orderDir(id))) throw Object.assign(new Error('Commande déjà créée à cette minute'), { status: 409 });
    writeJson(path.join(orderDir(id), 'request.json'), r);
    startMenus(id);
    send(res, 201, { id });
  }],
  ['GET', /^\/api\/orders\/([\w-]+)$/, (req, res, id) => send(res, 200, orderView(id))],
  ['DELETE', /^\/api\/orders\/([\w-]+)$/, async (req, res, id) => send(res, 200, { clearing: deleteOrder(id, !!(await readBody(req)).recipes) })],
  ['POST', /^\/api\/orders\/([\w-]+)\/choice$/, async (req, res, id) => {
    const dir = orderDir(id);
    const m = readJson(path.join(dir, 'menus.json'));
    if (!m) throw Object.assign(new Error('Pas de menus'), { status: 400 });
    const choice = menus.record(m, `orders/${id}/menus.json`, await readBody(req));
    writeJson(path.join(dir, 'choice.json'), choice);
    choice.chosen ? startBaskets(id) : startMenus(id, true);
    send(res, 200, choice);
  }],
  ['POST', /^\/api\/orders\/([\w-]+)\/verify$/, async (req, res, id) => {
    const v = orderView(id);
    if (['queued', 'running'].includes(v.job?.status)) throw Object.assign(new Error('Déjà en cours'), { status: 409 });
    if (!v.pick) throw Object.assign(new Error('Aucun panier choisi'), { status: 400 });
    startVerify(id, !!(await readBody(req)).rebuild);
    send(res, 202, {});
  }],
  ['POST', /^\/api\/orders\/([\w-]+)\/retry$/, (req, res, id) => {
    const v = orderView(id);
    if (['queued', 'running'].includes(v.job?.status)) throw Object.assign(new Error('Déjà en cours'), { status: 409 });
    if (v.pick) startVerify(id);
    else v.choice?.chosen && !v.result ? startBaskets(id) : startMenus(id, !!v.choice);
    send(res, 202, {});
  }],
  ['POST', /^\/api\/orders\/([\w-]+)\/pick$/, async (req, res, id) => { startPick(id, (await readBody(req)).basketId); send(res, 202, {}); }],
  ['GET', /^\/api\/orders\/([\w-]+)\/pdf$/, (req, res, id) => {
    const f = path.join(orderDir(id), 'recettes.pdf');
    if (!fs.existsSync(f)) return send(res, 404, { error: 'PDF absent' });
    res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="recettes-${id}.pdf"` });
    fs.createReadStream(f).pipe(res);
  }],

  ['GET', /^\/api\/recipes$/, (req, res) => send(res, 200, { recipes: myRecipes(), later: menus.later() })],
  ['GET', /^\/api\/recipes\/([a-z0-9-]+)$/, (req, res, slug) => {
    try { send(res, 200, recipes.recipe(slug)); } catch { send(res, 404, { error: 'Recette introuvable' }); }
  }],
  ['DELETE', /^\/api\/later$/, async (req, res) => { menus.forget(String((await readBody(req)).name || '')); send(res, 200, { ok: true }); }],
  ['DELETE', /^\/api\/recipes\/([a-z0-9-]+)$/, (req, res, slug) => {
    // Une recette encore au plan d'une commande servirait au PDF : supprimer la commande d'abord.
    const used = listOrders().filter(o => readJson(path.join(ORDERS, o.id, 'plan.json'))?.meals?.some(m => m.recipe === slug));
    if (used.length) throw Object.assign(new Error(`Plat prévu dans « ${used[0].title} » : supprime d'abord cette commande`), { status: 409 });
    recipes.remove(slug);
    send(res, 200, { ok: true });
  }],
  ['POST', /^\/api\/recipes\/([a-z0-9-]+)$/, async (req, res, slug) => {
    const b = await readBody(req);
    if (b.action === 'rate') recipes.rate(slug, b.score, String(b.note || '').slice(0, 1000));
    else if (b.action === 'made') recipes.made(slug);
    else if (b.action === 'note' && b.note) recipes.note(slug, String(b.note).slice(0, 1000));
    else throw Object.assign(new Error('Action inconnue'), { status: 400 });
    send(res, 200, { ok: true });
  }],
];

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  // Anti-CSRF basique : refuse les écritures venant d'une autre origine.
  if (req.method !== 'GET' && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return send(res, 403, { error: 'Origine refusée' });
  for (const [method, re, handler] of routes) {
    const m = req.method === method && url.pathname.match(re);
    if (!m) continue;
    try { return await handler(req, res, ...m.slice(1)); }
    catch (e) { return send(res, e.status || 500, { error: e.message }); }
  }
  send(res, 404, { error: 'Introuvable' });
});

if (require.main === module) server.listen(PORT, HOST, () => console.log(`DeliveryFresh : http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`));

module.exports = { cleanProfile, cleanRequest, buildPdf, orderChanges };
