// Usage : node tools/login.js ubereats|deliveroo
// Ouvre Chrome sur la plateforme : connecte-toi à la main, puis ferme la fenêtre. La session est gardée dans .session/<platform>.
const { open } = require('./browser');
const URLS = { ubereats: 'https://www.ubereats.com/fr', deliveroo: 'https://deliveroo.fr/fr/login' };

(async () => {
  const platform = process.argv[2];
  if (!URLS[platform]) { console.error('Usage : node tools/login.js ubereats|deliveroo'); process.exit(1); }
  const { ctx, page } = await open(platform, { visible: true });
  await page.goto(URLS[platform]);
  console.log(`Connecte-toi sur ${platform} dans la fenêtre Chrome, puis ferme-la.`);
  await new Promise(r => ctx.on('close', r));
  console.log('Session enregistrée.');
})();
