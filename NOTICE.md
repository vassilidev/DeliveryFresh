# Notice d'utilisation — DeliveryFresh

DeliveryFresh prépare tes repas : il te propose des menus, écrit les recettes (PDF façon HelloFresh),
compare plusieurs paniers réels sur **Uber Eats** et **Deliveroo** (frais inclus) et remplit le meilleur.
Tout se fait depuis une **page web sur ton Mac**. **L'app ne paie jamais à ta place** : tu valides la commande
toi-même dans l'app Uber Eats ou Deliveroo.

---

## 1. Installation (une seule fois)

Il te faut :
- [Node.js 22+](https://nodejs.org) ;
- Google Chrome ;
- [Claude Code](https://claude.com/claude-code), installé **et connecté à ton compte Claude** (lance `claude` une fois et connecte-toi).

```bash
git clone https://github.com/vassilidev/DeliveryFresh.git
cd DeliveryFresh
npm install
```

## 2. Lancer l'app

```bash
npm start
```

Ouvre ensuite **http://localhost:3000**. C'est la seule commande à taper : tout le reste se fait dans la page.
Pour arrêter l'app : `Ctrl + C` dans le terminal.

## 3. Premier lancement

1. **Profil** : adresse, nombre de personnes, équipements (plaques, four, micro-ondes…), allergies, régime,
   ce que tu as toujours au placard, préférences, abonnements. Clique sur **Enregistrer**.
2. **Comptes** : clique sur **Se connecter** pour Uber Eats, puis pour Deliveroo. Une fenêtre Chrome s'ouvre :
   connecte-toi normalement, puis **ferme la fenêtre**. La session est gardée.
   C'est nécessaire pour voir tes vrais frais (Uber One, Deliveroo Plus).

## 4. Passer une commande

1. **Nouvelle commande** :
   - coche les repas à couvrir (midi / soir sur 7 jours) ;
   - ajuste le nombre de personnes si tu as un invité ;
   - ajoute tes courses perso (café, petit-déj…), tes exceptions et tes envies ;
   - clique sur **Me proposer des menus**.
2. **Attends 1 à 3 min** : la page montre ce que fait l'IA. Tu peux la fermer, ça continue en arrière-plan.
3. **Choisis ton menu** parmi 2 ou 3 propositions :
   - ✅ **Je prends** : un seul menu possible ;
   - 👎 **Pas pour moi** : ajoute une remarque pour qu'elle comprenne pourquoi ;
   - ⏰ **Plus tard** : le menu est gardé et reproposé une prochaine fois ;
   - **✕ sur un plat** : « ce menu mais pas ce plat », il sera remplacé.

   Si tu ne prends aucun menu, l'IA en propose de nouveaux en tenant compte de tes refus.
4. **Attends 5 à 15 min** : l'IA cherche les produits dans 4 à 6 magasins, choisit les bons formats
   et les bonnes quantités, remplit chaque panier et lit le **total réel au paiement**.
5. **Choisis ton panier** dans le tableau comparatif (le recommandé est surligné). Clique sur **Je prends** :
   l'app garde ce panier, vide les autres et génère le **PDF des recettes** (liste de courses + une fiche par repas).
6. **Paie dans l'app** Uber Eats ou Deliveroo : ton panier y est déjà prêt.

## 5. Après les repas : « Mes plats »

Pour chaque recette : donne des **étoiles**, écris une remarque (« un peu fade », « à refaire ») et clique sur
**Faite aujourd'hui**. L'IA s'en sert ensuite : elle repropose ce que tu as aimé et évite le reste.
Les menus mis de côté (« Plus tard ») sont listés en haut de la page.

## 6. Comment l'IA est utilisée

L'app lance **Claude Code en arrière-plan** (`claude -p`), avec **ton compte Claude** : il n'y a pas de clé API
à configurer, et la consommation est décomptée sur ton abonnement. L'IA n'intervient qu'à **deux moments** :
proposer les menus, puis composer et comparer les paniers. Le profil, les connexions, le choix du panier,
le PDF et les notes n'en consomment pas.

## 7. Tes données

Restent uniquement sur ton Mac (jamais publiées sur GitHub) :
- `profile.json` : ton profil ;
- `.session/` : tes connexions ;
- `memory/` : tes notes, remarques et choix de menus ;
- `orders/` : tes commandes, paniers et PDF.

Ce qui est partagé, et s'améliore avec l'usage :
- `recipes/` : la bibliothèque de recettes ;
- `knowledge/` : ce que l'IA a appris sur les plateformes et les quantités.

L'app n'est accessible que depuis ton Mac. Le lancer avec `HOST=0.0.0.0 npm start` l'ouvre au Wi-Fi
(téléphone), **sans mot de passe** : à éviter sur un réseau partagé.

## 8. Dépannage

| Problème | Solution |
|---|---|
| « Claude n'a pas terminé » | vérifie que `claude` est installé et connecté (lance-le une fois dans un terminal), puis **Relancer** |
| Une étape a échoué | bouton **Relancer** sur la commande ; le détail de l'erreur est affiché |
| Frais bizarres, produits non trouvés | session expirée : **Comptes → Se connecter** |
| Une tâche reste « en attente » | une seule tâche tourne à la fois (une fenêtre de connexion encore ouverte bloque la file : ferme-la) |
| Changement d'adresse | modifie-la dans **Profil**, elle est prise en compte automatiquement |
| Un outil casse du jour au lendemain | les sites ont changé leur fonctionnement interne : ouvre `claude` dans le dossier et demande de réparer l'outil |

## 9. Mode avancé (terminal)

Tout reste faisable sans l'interface : lance `claude` dans le dossier et parle-lui (il suit `CLAUDE.md`).
Commandes directes :
- `node tools/recipes.js list` : recettes, notes et remarques ;
- `node tools/menus.js later` : menus mis de côté ;
- `node tools/ubereats.js clear all` : vide tous tes paniers Uber Eats ;
- `npm run check` : auto-tests (aucune connexion nécessaire).
