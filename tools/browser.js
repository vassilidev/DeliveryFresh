// Chrome partagé par plateforme : lancé une fois, INVISIBLE (headless, sans fenêtre), puis réutilisé par tous les outils
// (connexion CDP). SHOW_BROWSER=1 : fenêtre visible (débogage). Il garde la session (profil .session/<platform>) et se ferme seul après IDLE_MIN minutes sans usage.
// La connexion (login.js) utilise une fenêtre visible : open(platform, { visible: true }) ferme d'abord le Chrome caché.
//   node tools/browser.js stop [platform]   ferme le(s) Chrome caché(s)
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SESSION_DIR = path.join(__dirname, '..', '.session');
const PORTS = { ubereats: 9333, deliveroo: 9334 };
const IDLE_MIN = 10;
// --use-mock-keychain / --password-store=basic : mêmes clés de chiffrement des cookies que Playwright (sinon session illisible).
const ARGS = ['--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check', '--lang=fr-FR', '--use-mock-keychain', '--password-store=basic'];

// Cookie posé seulement une fois connecté (login.js attend son arrivée pour fermer la fenêtre).
const AUTH = { ubereats: { url: 'https://www.ubereats.com', name: 'sid' }, deliveroo: { url: 'https://deliveroo.fr', name: 'consumer_auth_token' } };

// SESSION=<nom> : profil alternatif (tests).
const profileDir = platform => path.join(SESSION_DIR, platform + (process.env.SESSION ? '-' + process.env.SESSION : ''));
const port = platform => PORTS[platform] + (process.env.SESSION ? 100 : 0);
const stamp = platform => path.join(SESSION_DIR, `${platform}${process.env.SESSION ? '-' + process.env.SESSION : ''}.lastuse`);

function chromePath() {
  const candidates = {
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
    linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'],
    win32: [`${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`],
  }[process.platform] || [];
  // Sinon : Chromium de Playwright (`npx playwright install chromium`), plus souvent bloqué par Cloudflare.
  return candidates.find(p => fs.existsSync(p)) || chromium.executablePath();
}

const connect = platform => chromium.connectOverCDP(`http://127.0.0.1:${port(platform)}`, { timeout: 3000 });

// Headless : on retire "HeadlessChrome" de l'identité du navigateur, sinon Cloudflare (Uber Eats) bloque.
function userAgent(exe) {
  let major = '0';
  try { major = execFileSync(exe, ['--version'], { encoding: 'utf8' }).match(/(\d+)\./)[1]; } catch {}
  const os = { darwin: 'Macintosh; Intel Mac OS X 10_15_7', win32: 'Windows NT 10.0; Win64; x64' }[process.platform] || 'X11; Linux x86_64';
  return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

// Expiration (ms) du cookie de connexion, lue dans le profil sans lancer Chrome ; 0 = pas connecté.
// ponytail: ne voit pas une session révoquée côté serveur (les outils le signalent alors : « Session expirée »).
function sessionExpiry(platform) {
  const { DatabaseSync } = require('node:sqlite');
  const os = require('os');
  const src = path.join(profileDir(platform), 'Default', 'Cookies');
  if (!fs.existsSync(src)) return 0;
  // Copie : Chrome peut verrouiller la base pendant qu'il tourne.
  const tmp = path.join(os.tmpdir(), `cookies-${platform}-${process.pid}`);
  fs.copyFileSync(src, tmp);
  try {
    const db = new DatabaseSync(tmp, { readOnly: true });
    const host = new URL(AUTH[platform].url).hostname.replace(/^www\./, '');
    // expires_utc : microsecondes depuis 1601.
    const row = db.prepare('SELECT max(expires_utc / 1000 - 11644473600000) AS exp FROM cookies WHERE name = ? AND host_key LIKE ?').get(AUTH[platform].name, '%' + host);
    db.close();
    return row.exp > Date.now() ? row.exp : 0;
  } catch { return 0; } finally { fs.rmSync(tmp, { force: true }); }
}

async function startHidden(platform) {
  fs.mkdirSync(profileDir(platform), { recursive: true });
  const exe = chromePath();
  const args = [...ARGS, `--remote-debugging-port=${port(platform)}`, `--user-data-dir=${profileDir(platform)}`, '--window-size=1400,950',
    ...(process.env.SHOW_BROWSER ? [] : ['--headless=new', `--user-agent=${userAgent(exe)}`]), 'about:blank'];
  const child = spawn(exe, args, { detached: true, stdio: 'ignore' });
  child.unref();
  // Surveillant détaché : ferme ce Chrome après IDLE_MIN minutes sans usage.
  spawn(process.execPath, [__filename, 'reap', platform], { detached: true, stdio: 'ignore', env: process.env }).unref();
  for (let i = 0; i < 40; i++) {
    try { return await connect(platform); } catch { await new Promise(r => setTimeout(r, 500)); }
  }
  throw new Error(`Chrome (${platform}) n'a pas démarré`);
}

async function stop(platform) {
  try {
    const b = await connect(platform);
    await (await b.newBrowserCDPSession()).send('Browser.close');
  } catch { /* pas lancé */ }
}

async function open(platform, { visible = false } = {}) {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
  if (visible) {
    // Fenêtre normale (login) : le profil ne peut être ouvert que par un seul Chrome.
    await stop(platform);
    await new Promise(r => setTimeout(r, 1000));
    const opts = { headless: false, locale: 'fr-FR', viewport: null, args: ARGS };
    let ctx;
    try { ctx = await chromium.launchPersistentContext(profileDir(platform), { ...opts, channel: 'chrome' }); }
    catch { ctx = await chromium.launchPersistentContext(profileDir(platform), opts); }
    return { ctx, page: ctx.pages()[0] || await ctx.newPage() };
  }
  let browser;
  try { browser = await connect(platform); } catch { browser = await startHidden(platform); }
  fs.writeFileSync(stamp(platform), String(Date.now()));
  const context = browser.contexts()[0];
  const page = await context.newPage();
  await page.setViewportSize({ width: 1400, height: 900 });
  // ctx.close() ferme seulement notre onglet et se déconnecte : le Chrome caché reste disponible pour la suite.
  const ctx = {
    addCookies: c => context.addCookies(c),
    cookies: u => context.cookies(u),
    close: async () => { await page.close().catch(() => {}); fs.writeFileSync(stamp(platform), String(Date.now())); await browser.close().catch(() => {}); },
  };
  return { ctx, page };
}

// Attend la fin d'un challenge Cloudflare ("Just a moment...").
async function waitCloudflare(page, timeoutMs = 30000) {
  for (let t = 0; t < timeoutMs && /moment|instant/i.test(await page.title()); t += 1000) await page.waitForTimeout(1000);
}

module.exports = { open, stop, waitCloudflare, sessionExpiry, AUTH, SESSION_DIR };

if (require.main === module) {
  const [cmd, platform] = process.argv.slice(2);
  (async () => {
    if (cmd === 'stop') for (const p of platform ? [platform] : Object.keys(PORTS)) await stop(p);
    if (cmd === 'reap') {
      for (;;) {
        await new Promise(r => setTimeout(r, 30000));
        let last = 0; try { last = +fs.readFileSync(stamp(platform), 'utf8'); } catch {}
        let alive = true; try { (await connect(platform)).close?.(); } catch { alive = false; }
        if (!alive) break;
        if (Date.now() - last > IDLE_MIN * 60000) { await stop(platform); break; }
      }
    }
  })().then(() => process.exit(0));
}
