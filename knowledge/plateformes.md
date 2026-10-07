# Pièges et savoir-faire des plateformes

## Commun
- Les frais (livraison, service, petite commande, remises d'abonnement) n'apparaissent qu'au récapitulatif de paiement :
  comparer sur le **total final**, jamais sur le sous-total. (2026-10-07)
- Navigateur : Chrome visible + profil persistant (`.session/<plateforme>`). En headless, Cloudflare bloque Uber Eats. (2026-10-07)
- Un profil Chrome ne peut être ouvert que par un process à la fois → un Chrome partagé par plateforme, lancé hors écran
  (`open -g -n` sur macOS = pas de vol de focus), auquel les outils se connectent en CDP : ~0,7 s au lieu de ~5 s par appel. (2026-10-07)
- Trop d'appels en peu de temps → Uber répond `bd.error.too_many_requests` (vécu : comparaison 10 magasins × 19 articles
  + 6 remplissages + remplacements). Parade : sondage des 3-5 articles chers, comparaison complète sur 2-3 magasins,
  2-3 paniers remplis ; rythme 300 ms + pauses 15/30/60 s dans les outils. (2026-10-07)
- macOS ramène à l'écran les fenêtres placées hors écran : pour un Chrome invisible, utiliser `--headless=new` avec un
  user-agent sans « HeadlessChrome » (sinon Cloudflare bloque) ; Uber et Deliveroo passent ainsi. (2026-10-07)
- Un Chrome lancé hors Playwright doit avoir `--use-mock-keychain --password-store=basic` (comme Playwright), sinon il ne
  peut pas déchiffrer les cookies et **efface la session** (vécu : reconnexion Uber Eats nécessaire). (2026-10-07)
- Cookie de connexion : Uber Eats `sid` (.ubereats.com, ~6 mois), Deliveroo `consumer_auth_token` (deliveroo.fr, ~3 mois).
  Son expiration se lit dans `.session/<p>/Default/Cookies` (SQLite, noms/dates en clair) sans lancer Chrome :
  `browser.sessionExpiry()`. `login.js` ferme la fenêtre dès qu'il apparaît. (2026-10-07)
- Le match par mot-clé ramène n'importe quoi (pâtée pour chat « filets de poulet », shampooing « aux œufs », chips « poivron ») :
  toujours relire les choix. (2026-10-07)
- Une requête vide ne veut pas dire « absent » : « oeufs frais » ne trouvait rien chez Auchan/Deliveroo, « oeufs » si. (2026-10-07)

## Uber Eats
- API interne `POST /_p/api/<Endpoint>?localeCode=fr` + en-tête `x-csrf-token: x`, appelée depuis la page (cookies). (2026-10-07)
- Adresse = cookie `uev2.loc` (JSON url-encodé) ; lui mettre une expiration sinon il disparaît à la fermeture. (2026-10-07)
- Recherche en magasin : `getInStoreSearchV1` avec `storeUUIDs`, `userQuery` et `targetLocation` = `location` du magasin (getStoreV1). (2026-10-07)
- Paniers = draft orders, **un par magasin** ; l'utilisateur peut en avoir d'anciens (restos…) : ne jamais y toucher. (2026-10-07)
- Ajouter le même article fusionne les quantités ; supprimer le dernier article supprime le panier. (2026-10-07)
- Produits au poids (`MEASUREMENT_TYPE_WEIGHT`) : prix en centimes/gramme, quantité en grammes par paliers
  (oignon 150 g, poivron 200 g, tomate 120 g, ail 100 g chez Intermarché). Facturé au poids réel. (2026-10-07)
- Frais observés avec Uber One : service 3,99 € moins « avantage abonnement », livraison offerte ; < 18 € : +3 € petite commande. (2026-10-07)
- Erreurs réseau passagères (« upstream connect error ») : réessayer. (2026-10-07)
- **La recherche ne garantit pas le stock** : un article « disponible » en recherche peut être refusé au panier
  (ruptures fréquentes chez Carrefour République : pâtes fraîches, conserves de tomates). Dans le panier, un article
  indisponible apparaît avec `price: 0` (et « Cet article est indisponible » au checkout) : après remplissage, relire
  le panier et remplacer tout article à 0 € par un équivalent vérifié. (2026-10-07)
- `discardDraftOrdersV1` refuse nos payloads : pour vider, retirer tous les articles (`removeItemsFromDraftOrderV2`). (2026-10-07)

## Deliveroo
- API GraphQL `api.fr.deliveroo.com/consumer/...` : nécessite les en-têtes `x-roo-*` du site (capturés sur sa 1re requête) ;
  ne pas envoyer `credentials: include` (CORS). Le schéma accepte des requêtes minimales écrites à la main. (2026-10-07)
- Adresse → geohash via le formulaire du site (mis en cache dans `.session/deliveroo-location.json`). (2026-10-07)
- Recherche : `get_search_results` (menus/graphql) avec `branch_drn_id`, `restaurant_id`, `menu_id` (dans `__NEXT_DATA__` du menu). (2026-10-07)
- Panier = un par commerce (`branch_id` = drnId du commerce). `add_basket_item` (menu_item **drn_id**),
  `edit_basket_item` (legacy_id, quantity ; 0 = supprimer). (2026-10-07)
- `clear_basket` répond OK mais **ne vide pas** le panier : mettre chaque article à 0. Pas d'API « liste des paniers » :
  `get_basket_page_summary` donne seulement le panier en cours (URL du commerce). (2026-10-07)
- Plusieurs produits avec le même titre et des formats différents (taille absente du titre) : départager par le prix
  ou le prix/kg de la description. (2026-10-07)
- Prix souvent un peu plus élevés que sur Uber pour le même magasin ; frais ≈ +2,49 € sur un panier ~50 €. (2026-10-07)
- La collection « courses » n'inclut pas tous les commerces (Carrefour City absent mais livrable). (2026-10-07)
- Deliveroo : le prix de `search` est le prix **promo** ; dans le panier `unit_price` (et `subtotalBeforeDiscounts`) est le prix
  avant promo. Seul « Total de la commande » fait foi (promos + frais inclus) ; frais = total − Σ prix de recherche ≈ 2,49 €. (2026-10-07)
- Deliveroo : le pied de panier ne détaille plus les frais (une seule ligne « Total de la commande »). (2026-10-07)
- Deliveroo : « crème liquide » ramène du savon (crème lavante) chez Auchan / rien chez Carrefour City → chercher « crème fraîche ». (2026-10-07)
- « saucisse » ramène surtout des plats cuisinés (lentilles, haricots) → chercher « saucisse de toulouse ». (2026-10-07)
- basket.js compare les titres à l'identique : copier le titre du cache, coquilles comprises (« Parmarreggio » chez Intermarché). (2026-10-07)

## Magasins (Lyon 2e)
- Intermarché Express Tronchet (Uber) : ni tomates cerises (→ tomate grappe au poids), ni basilic frais, ni vraie burrata
  (→ stracciatella Casa Azzurra 150 g). Bœuf haché seulement en 350-400 g. (2026-10-07)
- Carrefour République (Uber) : steaks hachés 15 % « (2) » = 250 g, saucisses de Toulouse Filière Qualité 250 g, burrata 290 g,
  basilic frais : bon magasin pour cuisiner pour 1. (2026-10-07)
- Carrefour City République (Deliveroo) : pas de tortellini ricotta-épinards (seulement Rana speck). Monoprix (Uber/Deliveroo) :
  pas de viande hachée en barquette correcte → steaks façon bouchère 2×125 g. U Express Ainay (Uber) : pas de burrata. (2026-10-07)
