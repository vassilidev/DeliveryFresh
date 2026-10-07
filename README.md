# Agent courses Uber Eats / Deliveroo

Un agent [Claude Code](https://claude.com/claude-code) qui planifie tes repas, écrit les recettes (PDF façon HelloFresh),
compare **4 à 6 paniers réels** sur Uber Eats et Deliveroo (frais inclus) et remplit le panier gagnant.
Tu valides et paies toi-même dans l'app : l'agent ne passe jamais commande.

📖 **Mode d'emploi complet : [NOTICE.md](NOTICE.md)**

## Démarrage rapide
```bash
npm install
npm start          # puis http://localhost:3000
```
Prérequis : Node.js 22+, Google Chrome, [Claude Code](https://claude.com/claude-code) connecté à ton compte
(l'IA tourne via `claude -p`, sans clé API). Dans la page : **Profil** → **Comptes** (connexion Uber Eats / Deliveroo)
→ **Nouvelle commande**. Les menus, la comparaison, le PDF et les notes se font tous dans l'interface.

## Structure
- `server.js` + `web/` : l'interface web locale (Node pur, sans dépendance).
- `tools/` : outils CLI réutilisables (sortie JSON), documentés en tête de fichier.
- `recipes/` : bibliothèque de recettes (JSON).
- `knowledge/` : ce que l'agent a appris (pièges des plateformes, quantités) ; enrichi à chaque commande.
- Privé, ignoré par git : `profile.json`, `.session/` (cookies), `memory/` (notes et historique), `orders/`.

> Outil personnel s'appuyant sur les API internes des sites ; elles peuvent changer sans préavis.
