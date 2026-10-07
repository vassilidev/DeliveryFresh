# Agent courses Uber Eats / Deliveroo

Un agent [Claude Code](https://claude.com/claude-code) qui planifie tes repas, écrit les recettes (PDF façon HelloFresh),
compare **4 à 6 paniers réels** sur Uber Eats et Deliveroo (frais inclus) et remplit le panier gagnant.
Tu valides et paies toi-même dans l'app : l'agent ne passe jamais commande.

📖 **Mode d'emploi complet : [NOTICE.md](NOTICE.md)**

## Installation
```bash
npm install
cp profile.example.json profile.json   # adresse, personnes, équipements, allergies, placard
node tools/login.js ubereats           # connecte-toi dans la fenêtre, puis ferme-la
node tools/login.js deliveroo
```
Google Chrome recommandé (sinon : `npx playwright install chromium`).

## Utilisation
Lance `claude` dans ce dossier et demande par exemple :
> Fais-moi les courses et les recettes pour ce soir, demain midi et demain soir.

L'agent suit `CLAUDE.md` : il te demande les exceptions de la semaine (invité, courses perso comme du café),
propose un menu, compare les magasins, compose les paniers produit par produit, lit les totaux réels et génère le PDF.

Noter une recette après l'avoir faite :
```bash
node tools/recipes.js rate chili-con-carne 5 "parfait, un peu plus d'épices la prochaine fois"
```

## Structure
- `tools/` : outils CLI réutilisables (sortie JSON), documentés en tête de fichier.
- `recipes/` : bibliothèque de recettes (JSON).
- `knowledge/` : ce que l'agent a appris (pièges des plateformes, quantités) ; enrichi à chaque commande.
- Privé, ignoré par git : `profile.json`, `.session/` (cookies), `memory/` (notes et historique), `orders/`.

> Outil personnel s'appuyant sur les API internes des sites ; elles peuvent changer sans préavis.
