// Chrome partagé par plateforme : lancé une fois, HORS ÉCRAN et sans voler le focus, puis réutilisé par tous les outils
// (connexion CDP). Il garde la session (profil .session/<platform>) et se ferme seul après IDLE_MIN minutes sans usage.
// La connexion (login.js) utilise une fenêtre visible : open(platform, { visible: true }) ferme d'abord le Chrome caché.
//   node tools/browser.js stop [platform]   ferme le(s) Chrome caché(s)
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const SESSION_DIR = path.join(__dirname, '..', '.session');
const PORTS = { ubereats: 9333, deliveroo: 9334 };
const IDLE_MIN = 10;
// --use-mock-keychain / --password-store=basic : mêmes clés de chiffrement des cookies que Playwright (sinon session illisible).
const ARGS = ['--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check', '--lang=fr-FR', '--use-mock-keychain', '--password-store=basic'];

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

async function startHidden(platform) {
  fs.mkdirSync(profileDir(platform), { recursive: true });
  const args = [...ARGS, `--remote-debugging-port=${port(platform)}`, `--user-data-dir=${profileDir(platform)}`,
    '--window-position=-3000,-3000', '--window-size=1400,950', 'about:blank'];
  const exe = chromePath();
  // macOS : `open -g -n` lance une instance séparée en arrière-plan (pas de vol de focus).
  const child = process.platform === 'darwin' && exe.includes('.app/')
    ? spawn('open', ['-g', '-n', '-a', exe.split('.app/')[0] + '.app', '--args', ...args], { detached: true, stdio: 'ignore' })
    : spawn(exe, args, { detached: true, stdio: 'ignore' });
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

module.exports = { open, stop, waitCloudflare, SESSION_DIR };

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
