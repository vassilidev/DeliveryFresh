// Usage : node tools/login.js ubereats|deliveroo
// Ouvre Chrome sur la plateforme : connecte-toi à la main, la fenêtre se ferme toute seule une fois connecté
// (cookie de connexion présent). La session est gardée dans .session/<platform>. Code 1 si fermée sans connexion.
const { open, AUTH } = require('./browser');
const URLS = { ubereats: 'https://www.ubereats.com/fr', deliveroo: 'https://deliveroo.fr/fr/login' };
const TIMEOUT_MIN = 10;

(async () => {
  const platform = process.argv[2];
  if (!URLS[platform]) { console.error('Usage : node tools/login.js ubereats|deliveroo'); process.exit(1); }
  const { ctx, page } = await open(platform, { visible: true });
  // Reconnexion = repartir de zéro : sinon l'ancien cookie fermerait la fenêtre aussitôt.
  await ctx.clearCookies({ name: AUTH[platform].name });
  await page.goto(URLS[platform]);
  console.log(`Connecte-toi sur ${platform} dans la fenêtre Chrome : elle se fermera toute seule.`);
  let closed = false;
  ctx.on('close', () => { closed = true; });
  const end = Date.now() + TIMEOUT_MIN * 60000;
  while (!closed && Date.now() < end) {
    const ok = (await ctx.cookies(AUTH[platform].url).catch(() => [])).some(c => c.name === AUTH[platform].name);
    if (ok) {
      await new Promise(r => setTimeout(r, 3000)); // laisse le site finir ses redirections / derniers cookies
      await ctx.close().catch(() => {});
      console.log('Connecté, session enregistrée.');
      return;
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  await ctx.close().catch(() => {});
  console.error(closed ? 'Fenêtre fermée avant la connexion.' : `Pas de connexion après ${TIMEOUT_MIN} min.`);
  process.exit(1);
})();
