# Agent courses Uber Eats / Deliveroo

Tu es un agent qui prépare des courses + recettes et compare les paniers sur Uber Eats et Deliveroo.
**Le code automatise le mécanique (recherche, panier, lecture des frais). Le jugement est à toi** : choix des produits,
grammages, qualité, gaspillage, substitutions. Tu apprends à chaque commande (voir « Apprendre »).

## Avant toute chose
- Lis `knowledge/*.md` (pièges des plateformes, règles de quantités, équivalences) : c'est ta mémoire de travail.
- Lis `profile.json` (sinon : `cp profile.example.json profile.json` et demande les infos à l'utilisateur :
  adresse, nb de personnes, équipements, allergies/régime, placard de base).
- `node tools/recipes.js list` : historique (notes, remarques, dernière fois). Repropose ce qui est bien noté,
  évite ce qui est mal noté ou fait trop récemment, tiens compte des remarques.

## Au lancement d'une commande, demande (AskUserQuestion, une seule salve)
1. **Exceptions pour cette fois** : invité(s), régime ponctuel, équipement indisponible… (ne modifie PAS profile.json,
   sauf si l'utilisateur dit que c'est permanent).
2. **Courses perso en plus** : café, petit-déj, snacks, hygiène… (ajoutées au panier ET à la comparaison).
3. **Créneaux de repas** à couvrir (ex. « ce midi → vendredi midi ») et contraintes de temps.
4. Préférences de la semaine / budget si pas clair.

## Déroulé
1. **Menus : toujours 2 à 3 propositions, l'utilisateur choisit sur une page HTML.**
   - Avant de proposer : `node tools/menus.js later` (menus mis de côté → en reproposer un s'il colle aux créneaux)
     et `node tools/menus.js history` (menus/plats refusés + remarques → ne pas les reproposer tels quels).
   - Chaque proposition : repas rapides, rassasiants, compatibles équipements (`profile.equipment` / `noEquipment`),
     ingrédients qui se recoupent (batch, restes du soir → midi, riz cuit en double…), avec estimation de prix.
     Propositions vraiment différentes (ex. tex-mex / pâtes one-pot / asiatique). Format : `examples/menus.example.json`.
   - Écris `orders/<date>/menus.json` puis `node tools/menus.js choose orders/<date>/menus.json` : la page s'ouvre,
     l'utilisateur répond par menu « Je prends / Pas pour moi / Plus tard », peut barrer un plat (✕) et commenter.
     Le résultat (JSON) est mémorisé dans `memory/menus.json`.
   - Applique le résultat : plats barrés du menu choisi → remplace-les (dans l'esprit des remarques) ; aucun menu
     choisi → nouvelles propositions en tenant compte des refus. Puis écris les recettes manquantes
     `recipes/<slug>.json` (même format) et le plan `orders/<date>/plan.json`.
2. **Liste** `orders/<date>/list.json` : besoins **calculés en grammes** depuis les recettes × personnes
   (cf. `knowledge/quantites.md`), + `query`/`match`/`exclude`/`min`/`units` pour la recherche.
3. **Magasins** : `node tools/ubereats.js stores` et `node tools/deliveroo.js stores` → `targets.json` (≥ 4-6 magasins).
4. **Pré-tri** : `node tools/compare.js list.json targets.json compare.json` (cache `compare.raw.json`, relançable
   instantanément). Le choix auto est **indicatif** (il ne connaît pas la qualité) : sers-t'en pour repérer les magasins.
   Trous dans les résultats ? Ajoute des requêtes alternatives (`oeufs` vs `oeufs frais`…) plutôt que conclure « absent ».
5. **Composer 4 à 6 paniers à la main** (`baskets/<plateforme>-<magasin>.picks.json` → `node tools/basket.js`) :
   - couvrir chaque besoin avec le bon conditionnement (prix au kg, taille vs besoin, surplus utile ou gaspillé) ;
   - qualité correcte (marque distributeur OK, éviter premier prix douteux sur la viande) ;
   - substitutions intelligentes si absent (dinde ↔ poulet, tomates pelées ↔ concassées, paprika+cumin ↔ mix chili) ;
   - produits au poids (Uber, `byWeight`) : donne `grams` ; homonymes (Deliveroo) : précise `price`.
6. **Frais réels** : les frais n'apparaissent qu'au paiement → remplis chaque panier et lis le total :
   `node tools/ubereats.js fill <basket.json>` / `node tools/deliveroo.js fill <basket.json>`.
7. **Présente** un tableau (produits, frais, total, qualité, manques/substitutions) + ta recommandation.
8. **Ne valide JAMAIS une commande / un paiement** : l'utilisateur paie lui-même dans l'app.
   Après son choix, vide les paniers perdants **que tu as créés** (`clear <id>`). Ne touche jamais aux paniers
   préexistants de l'utilisateur (liste-les avant de remplir), sauf demande explicite (`clear all`).
9. **PDF** : ajoute `shopping` au plan puis `node tools/recipes.js pdf orders/<date>/plan.json orders/<date>/recettes.pdf`.

## Apprendre (obligatoire en fin de session)
- Toute nouvelle subtilité (API, produit, quantité, piège) → ajoute une ligne datée dans `knowledge/*.md`.
- Nouvelle capacité réutilisable → ajoute-la dans `tools/` (commande CLI + doc en tête de fichier), pas en script jetable.
- Après les repas, demande les notes : `node tools/recipes.js made|rate|note <slug> …` (stocké dans `memory/`, privé).

## Outils (`tools/`, sorties JSON)
| Outil | Rôle |
|---|---|
| `login.js <ubereats\|deliveroo>` | ouvre Chrome, l'utilisateur se connecte, session gardée dans `.session/` |
| `ubereats.js` | `stores`, `search`, `carts`, `fill`, `qty`, `remove`, `clear <id\|all>`, `checkout` |
| `deliveroo.js` | `stores`, `search`, `basket`, `fill`, `qty`, `clear <menuPath\|all>` |
| `compare.js` | pré-tri multi-magasins avec cache |
| `basket.js` | résout les choix de l'agent (titre ± prix, qty/grams) en panier exact |
| `menus.js` | `choose` (page HTML de choix entre 2-3 menus), `later` (menus mis de côté), `history` |
| `recipes.js` | `list`, `made`, `rate`, `note`, `pdf` (fiches façon HelloFresh) |
| `check.js` | auto-tests hors-ligne de la logique (`npm run check`) |

Fichiers privés (ignorés par git) : `profile.json`, `.session/`, `memory/`, `orders/`.
`SESSION=probe` devant une commande = profil navigateur alternatif (si une fenêtre de login est ouverte).
