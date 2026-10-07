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
const P_MENUS = (id, again) => `Mode web, commande ${id}. Lis CLAUDE.md (section « Mode web ») et knowledge/.
Demande : orders/${id}/request.json. Étape MENUS uniquement : écris orders/${id}/menus.json (2 à 3 propositions).
${again ? `Les propositions précédentes n'ont pas été retenues : tiens compte de orders/${id}/choice.json (refus, remarques).` : ''}
Ne touche à aucun panier, ne lance pas menus.js choose.`;

const P_BASKETS = id => `Mode web, commande ${id}. Lis CLAUDE.md (section « Mode web ») et knowledge/.
Demande : orders/${id}/request.json, menus : orders/${id}/menus.json, choix de l'utilisateur : orders/${id}/choice.json.
Fais toute la suite jusqu'aux totaux réels de 4 à 6 paniers remplis, puis écris orders/${id}/result.json.
Ne vide aucun panier, ne génère pas le PDF, ne passe jamais commande.`;

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
    const plan = readJson(path.join(dir, 'plan.json'));
    if (plan) {
      const basket = readJson(path.join(ROOT, chosen.basketFile)) || { items: [] };
      plan.shopping = basket.items.map(i => ({ name: i.title, qty: i.grams ? `${i.grams} g` : `× ${i.qty || 1}`, price: i.cost ?? i.price }));
      plan.shoppingNote = `${chosen.platform === 'ubereats' ? 'Uber Eats' : 'Deliveroo'} · ${chosen.store} — produits ${chosen.subtotal?.toFixed(2)} € · total ${chosen.total?.toFixed(2)} € (frais inclus).`;
      writeJson(path.join(dir, 'plan.json'), plan);
      say(job, '📄 Génération du PDF des recettes');
      await recipes.pdf(path.join(dir, 'plan.json'), path.join(dir, 'recettes.pdf'));
    }
    writeJson(path.join(dir, 'pick.json'), { basketId, at: new Date().toISOString() });
  });
}

function orderView(id) {
  const dir = orderDir(id);
  if (!fs.existsSync(dir)) throw Object.assign(new Error('Commande introuvable'), { status: 404 });
  const f = n => readJson(path.join(dir, n));
  const job = [...jobs].reverse().find(j => j.orderId === id);
  return {
    id, request: f('request.json'), menus: f('menus.json'), choice: f('choice.json'), result: f('result.json'),
    plan: f('plan.json'), pick: f('pick.json'), hasPdf: fs.existsSync(path.join(dir, 'recettes.pdf')),
    job: job && { label: job.label, status: job.status, log: job.log.slice(-60), queued: jobs.filter(j => j.status === 'queued').indexOf(job) },
  };
}

function listOrders() {
  if (!fs.existsSync(ORDERS)) return [];
  return fs.readdirSync(ORDERS).filter(d => fs.statSync(path.join(ORDERS, d)).isDirectory()).sort().reverse().map(id => {
    const v = orderView(id);
    const state = v.pick ? 'Terminée' : v.result ? 'Paniers à choisir' : v.choice?.chosen ? 'Paniers en préparation'
      : v.menus ? 'Menu à choisir' : 'Menus en préparation';
    return { id, title: v.request?.title || v.plan?.title || id, state, busy: ['queued', 'running'].includes(v.job?.status) };
  });
}

// ---- Validation des entrées ----
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

  ['GET', /^\/o\/([\w-]+)\/menus$/, (req, res, id) => {
    const m = readJson(path.join(orderDir(id), 'menus.json'));
    if (!m) return send(res, 404, 'Menus pas encore prêts', 'text/plain; charset=utf-8');
    send(res, 200, menus.html(m, { postUrl: `/api/orders/${id}/choice`, backUrl: `/#/o/${id}` }), 'text/html; charset=utf-8');
  }],

  ['GET', /^\/api\/profile$/, (req, res) => send(res, 200, { exists: fs.existsSync(PROFILE), profile: readJson(PROFILE) || readJson(path.join(ROOT, 'profile.example.json')) })],
  ['PUT', /^\/api\/profile$/, async (req, res) => { const p = cleanProfile(await readBody(req)); writeJson(PROFILE, p); send(res, 200, p); }],

  ['GET', /^\/api\/accounts$/, (req, res) => {
    const st = p => fs.existsSync(path.join(ROOT, '.session', p, 'Default', 'Cookies'));
    send(res, 200, { ubereats: st('ubereats'), deliveroo: st('deliveroo'), busy: running?.label || null });
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
  ['POST', /^\/api\/orders\/([\w-]+)\/choice$/, async (req, res, id) => {
    const dir = orderDir(id);
    const m = readJson(path.join(dir, 'menus.json'));
    if (!m) throw Object.assign(new Error('Pas de menus'), { status: 400 });
    const choice = menus.record(m, `orders/${id}/menus.json`, await readBody(req));
    writeJson(path.join(dir, 'choice.json'), choice);
    choice.chosen ? startBaskets(id) : startMenus(id, true);
    send(res, 200, choice);
  }],
  ['POST', /^\/api\/orders\/([\w-]+)\/retry$/, (req, res, id) => {
    const v = orderView(id);
    if (['queued', 'running'].includes(v.job?.status)) throw Object.assign(new Error('Déjà en cours'), { status: 409 });
    v.choice?.chosen && !v.result ? startBaskets(id) : startMenus(id, !!v.choice);
    send(res, 202, {});
  }],
  ['POST', /^\/api\/orders\/([\w-]+)\/pick$/, async (req, res, id) => { startPick(id, (await readBody(req)).basketId); send(res, 202, {}); }],
  ['GET', /^\/api\/orders\/([\w-]+)\/pdf$/, (req, res, id) => {
    const f = path.join(orderDir(id), 'recettes.pdf');
    if (!fs.existsSync(f)) return send(res, 404, { error: 'PDF absent' });
    res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="recettes-${id}.pdf"` });
    fs.createReadStream(f).pipe(res);
  }],

  ['GET', /^\/api\/recipes$/, (req, res) => send(res, 200, { recipes: recipes.list(), later: menus.later() })],
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

module.exports = { cleanProfile, cleanRequest };
