// Lance un Chrome persistant (un profil par plateforme) pour garder la session de connexion.
const { chromium } = require('playwright');
const path = require('path');

const SESSION_DIR = path.join(__dirname, '..', '.session');

async function open(platform, { headless = false } = {}) {
  const opts = {
    headless, locale: 'fr-FR', viewport: { width: 1500, height: 950 },
    args: ['--disable-blink-features=AutomationControlled'],
  };
  // SESSION=<nom> : profil alternatif (ex. recherche pendant qu'une fenêtre de login est ouverte).
  const dir = path.join(SESSION_DIR, platform + (process.env.SESSION ? '-' + process.env.SESSION : ''));
  let ctx;
  // Chrome installé = moins de blocages Cloudflare ; sinon Chromium de Playwright (`npx playwright install chromium`).
  try { ctx = await chromium.launchPersistentContext(dir, { ...opts, channel: 'chrome' }); }
  catch { ctx = await chromium.launchPersistentContext(dir, opts); }
  const page = ctx.pages()[0] || await ctx.newPage();
  return { ctx, page };
}

// Attend la fin d'un challenge Cloudflare ("Just a moment...").
async function waitCloudflare(page, timeoutMs = 30000) {
  for (let t = 0; t < timeoutMs && /moment|instant/i.test(await page.title()); t += 1000) await page.waitForTimeout(1000);
}

module.exports = { open, waitCloudflare, SESSION_DIR };
