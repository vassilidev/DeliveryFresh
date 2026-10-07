# Pièges et savoir-faire des plateformes

## Commun
- Les frais (livraison, service, petite commande, remises d'abonnement) n'apparaissent qu'au récapitulatif de paiement :
  comparer sur le **total final**, jamais sur le sous-total. (2026-10-07)
- Navigateur : Chrome visible + profil persistant (`.session/<plateforme>`). En headless, Cloudflare bloque Uber Eats. (2026-10-07)
- Un profil Chrome ne peut être ouvert que par un process à la fois : fermer la fenêtre de login avant de lancer un outil. (2026-10-07)
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
