# Notice d'utilisation — DeliveryFresh

L'agent prépare tes repas de la semaine : il te propose des menus, écrit les recettes (PDF façon HelloFresh),
compare plusieurs paniers réels sur **Uber Eats** et **Deliveroo** (frais inclus) et remplit le meilleur.
**Il ne paie jamais à ta place** : tu valides la commande toi-même dans l'app.

---

## 1. Installation (une seule fois)

Prérequis : [Node.js 22+](https://nodejs.org), [Claude Code](https://claude.com/claude-code), Google Chrome (recommandé).

```bash
git clone https://github.com/vassilidev/DeliveryFresh.git
cd DeliveryFresh
npm install
cp profile.example.json profile.json
```

Sans Chrome : `npx playwright install chromium`.

## 2. Ton profil (`profile.json`)

| Champ | Exemple | À quoi ça sert |
|---|---|---|
| `address` | `"10 Rue Exemple, 69002 Lyon"` | magasins et frais de livraison |
| `people` | `1` | portions des recettes et quantités |
| `equipment` / `noEquipment` | `["plaques", "micro-ondes"]` / `["four"]` | recettes faisables chez toi |
| `allergies`, `diet` | `[]` | exclusions |
| `pantry` | `["huile", "sel", "poivre"]` | ce que tu as déjà, jamais acheté |
| `preferences` | `"rassasiant, simple"` | style de cuisine, budget |

Tu peux aussi laisser l'agent le remplir : il te posera les questions au premier lancement.
Ce fichier reste sur ta machine (ignoré par git).

## 3. Connexion aux plateformes (une fois, puis quand la session expire)

```bash
npm run login:ubereats
npm run login:deliveroo
```

Une fenêtre Chrome s'ouvre : connecte-toi normalement, puis **ferme la fenêtre**. La session est enregistrée
dans `.session/` et réutilisée ensuite. La connexion est nécessaire pour voir tes vrais frais (Uber One, Deliveroo Plus).

## 4. Lancer une commande

Dans le dossier du projet :

```bash
claude
```

Puis demande simplement, par exemple :

> Fais-moi les courses et les recettes pour ce soir, demain midi et demain soir.

> Courses pour la semaine, du lundi midi au vendredi midi, on sera 2 mardi soir.

### Ce qui se passe ensuite

1. **Questions de départ** : exceptions pour cette fois (invité, régime…), courses perso à ajouter
   (café, petit-déj…), créneaux de repas. Ton profil n'est pas modifié, sauf si tu dis que c'est définitif.
2. **Choix du menu sur une page web** : l'agent te propose 2 à 3 menus. Pour chacun :
   - ✅ **Je prends** : un seul menu possible ;
   - 👎 **Pas pour moi** : ajoute une remarque pour qu'il comprenne pourquoi ;
   - ⏰ **Plus tard** : le menu est gardé et reproposé une prochaine fois ;
   - **✕ sur un plat** : « je prends ce menu mais pas ce plat », il sera remplacé.

   Clique sur **Valider** puis ferme la page. Tes refus et tes remarques sont mémorisés pour la suite.
3. **Comparaison** : l'agent cherche les produits dans 4 à 6 magasins sur les deux plateformes. Il choisit
   les bons formats et les bonnes quantités, remplit chaque panier et lit le **total réel au paiement**.
4. **Résultat** : un tableau comparatif avec sa recommandation. Tu choisis, il vide les autres paniers.
5. **Tu paies** dans l'app Uber Eats ou Deliveroo : le panier est déjà prêt.
6. **PDF des recettes** dans `orders/<date>/` : la liste de courses, puis une fiche par repas.

## 5. Après les repas : noter

Dis-le simplement à l'agent (« le chili était top, un peu fade ») ou en ligne de commande :

```bash
node tools/recipes.js rate chili-con-carne 4 "un peu fade, plus d'épices"
node tools/recipes.js made poulet-curry-coco
node tools/recipes.js list
```

L'agent repropose ce que tu as aimé, évite ce que tu n'as pas aimé et tient compte de tes remarques.

## 6. Commandes utiles

| Commande | Effet |
|---|---|
| `node tools/menus.js later` | menus mis de côté (« plus tard ») |
| `node tools/menus.js history` | toutes tes décisions de menus |
| `node tools/recipes.js list` | recettes connues, notes, remarques |
| `node tools/ubereats.js carts` | tes paniers Uber Eats |
| `node tools/ubereats.js clear all` | vide **tous** tes paniers Uber Eats |
| `node tools/deliveroo.js clear all` | vide tes paniers Deliveroo en cours |
| `npm run check` | auto-tests (aucune connexion nécessaire) |

## 7. Tes données

Restent uniquement sur ta machine (jamais publiées sur GitHub) :
- `profile.json` : ton profil ;
- `.session/` : tes cookies de connexion ;
- `memory/` : tes notes, remarques et choix de menus ;
- `orders/` : tes listes, tes paniers et tes PDF.

Ce qui est partagé, et s'améliore avec l'usage :
- `recipes/` : la bibliothèque de recettes ;
- `knowledge/` : ce que l'agent a appris sur les plateformes et les quantités.

## 8. Dépannage

| Problème | Solution |
|---|---|
| « Just a moment… » / Cloudflare | ne pas forcer le mode headless ; relancer, la fenêtre Chrome passe le contrôle |
| Erreur de profil Chrome déjà utilisé | une fenêtre de login est encore ouverte : ferme-la |
| Frais bizarres, produits non trouvés | session expirée : relance `npm run login:…` |
| Changement d'adresse | modifie `address` dans `profile.json`, la localisation est recalculée automatiquement |
| Un outil casse du jour au lendemain | les sites ont changé leur API interne : demande à l'agent de réparer l'outil et de noter la cause dans `knowledge/` |
