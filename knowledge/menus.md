# Composer un menu (2026-10-07)

## Diversité DANS chaque menu (pas un thème par menu)
L'utilisateur ne veut pas « 5 repas italiens » ni « 5 repas de pâtes ». Un menu = une semaine variée qui partage ses **ingrédients**,
pas sa cuisine. Sur un même menu :
- **Cuisines** : au moins 3 différentes sur 5 repas (française, italienne, mexicaine, asiatique, libanaise, indienne, grecque…).
- **Féculent** : jamais 2 fois de suite le même, et au plus 2 fois sur le menu (pâtes, riz, pommes de terre, wraps/pain,
  semoule/boulgour, nouilles, gnocchis, lentilles…).
- **Protéine** : au moins 3 différentes (poulet, bœuf, porc, poisson, œufs, légumineuses…).
- Pas de « reste de… » (cf. `quantites.md`).

## Recouper les ingrédients ENTRE cuisines
Choisir 4-6 **ingrédients pivots** (achetés une fois, utilisés 2-3 fois) qui voyagent d'une cuisine à l'autre :
- Poulet : curry-coco (indien) → tacos (mexicain) → salade César (américain).
- Riz cuit en double : chili (mexicain) → riz sauté (asiatique).
- Citron, coriandre/persil : taboulé, tacos, curry. Feta : salade grecque, wraps, pâtes.
- Poivrons, oignons rouges : fajitas, wok, shakshuka. Crème/yaourt : tzatziki, curry, sauce wraps.
- Pois chiches / haricots : houmous, chili, curry.

## Ce qui distingue les 2-3 propositions
Pas la cuisine (chaque menu est déjà varié) mais le **panier** : jeu d'ingrédients pivots, protéine dominante
(viande / poisson / végé), budget, temps en cuisine (express vs batch). Indiquer les pivots dans `pitch`.

## Longue période, une seule livraison (2026-10-07)
- 13 créneaux / 6 jours : la règle « féculent au plus 2 fois » devient « au plus 3 fois », toujours jamais 2 fois de suite.
- Ordonner par fraîcheur : poisson frais / burrata le 1er jour, viande hachée et volaille crues dans les 3 premiers jours,
  fin de semaine sur œufs, charcuterie sous vide (lardons, chorizo, jambon), gnocchis/tortellini frais (longue DLC), conserves.
- 2026-10-07 — Recettes communes à tous les paniers : quand un magasin n'a pas un ingrédient, choisir une substitution valable partout
  (courgette au lieu d'épinards frais, curry tomate au lieu de coco) et écrire l'ingrédient « X (ou Y) » (pita ou tortilla, cheddar ou
  emmental, soja sucrée ou salée + miel) plutôt que des recettes par panier. Épinards frais et lait de coco : souvent en rupture, éviter
  d'en faire un pivot sur 6 jours (les pousses ne tiennent pas jusqu'au dernier jour de toute façon).

## Variété entre commandes (2026-10-07)
L'utilisateur se plaint de revoir toujours les mêmes plats (tex-mex, wraps, poke bowl, salade grecque…). Donc :
- **Tirage** (`node tools/menus.js draw`, injecté automatiquement en mode web) : 4 cuisines à explorer et 4 produits de saison.
  Au moins 2 de ces cuisines et 2 de ces produits apparaissent dans chaque proposition. Le tirage change à chaque commande : le suivre,
  ne pas retomber sur ses habitudes. Les **envies / exceptions de l'utilisateur passent avant** le tirage (s'il demande du mexicain, on en fait).
- **Saison** : légumes et fruits de saison en France (liste `allSeasonal` du tirage) en priorité ; pas de tomates/courgettes/avocat en hiver
  comme ingrédient vedette (OK en appoint).
- **Plats récents** (`avoid`) : ne pas les reproposer, même renommés (« Pita poulet kebab » = « Wrap poulet kebab »).
- **Recettes existantes** (`recipes/`) : n'en reprendre qu'une par menu au maximum, et seulement si elle est notée ≥ 4.
- **Tex-mex / wraps / bowls** : au plus 1 repas de ce genre par menu, et pas dans 2 commandes de suite.
- Chercher des plats précis et dépaysants plutôt que des génériques : « kimchi jjigae au porc », « caldo verde », « dal makhani »,
  « pad krapow », « shepherd's pie », « soupe pho » plutôt que « bowl asiatique » ou « salade composée ».
