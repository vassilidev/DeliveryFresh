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
   connecte-toi normalement : **la fenêtre se ferme toute seule** une fois connecté. La session est gardée,
   et la page Comptes indique jusqu'à quand.
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
4. **Attends 5 à 15 min** : l'IA sonde 6 à 8 magasins sur les articles les plus chers, compare en détail les 2-3 meilleurs,
   choisit les bons formats et les bonnes quantités, remplit ces paniers et lit le **total réel au paiement**.
5. **Choisis ton panier** dans le tableau comparatif : total payé, **prix par repas**, remarques ; le recommandé est
   surligné. Clique sur **Je prends** : l'app garde ce panier, vide les autres, **vérifie le stock réel**, fait
   remplacer par l'IA les articles devenus indisponibles et génère le **PDF des recettes** (liste de courses + une fiche
   par repas avec son coût).
6. **Juste avant de payer**, clique sur **🔄 Revérifier le panier** : un article peut passer en rupture entre-temps
   (c'est fréquent dans les petits magasins). L'app relit le panier, remplace ce qui manque, adapte les recettes si besoin
   et met le PDF à jour. Les remplacements sont listés sur la page.
7. **Paie dans l'app** Uber Eats ou Deliveroo : ton panier y est déjà prêt.

> **Prix par repas** : « payé » = total ÷ nombre de repas (pour comparer les paniers) ; « consommé » = ce que chaque
> repas utilise vraiment (le reste — fond de pesto, œufs… — va au placard pour la suite).

## 5. Après les repas : « Mes plats »

Pour chaque recette : donne des **étoiles**, écris une remarque (« un peu fade », « à refaire ») et clique sur
**Faite aujourd'hui**. L'IA s'en sert ensuite : elle repropose ce que tu as aimé et évite le reste.
Les menus mis de côté (« Plus tard ») sont listés en haut de la page.

## 6. Chrome en arrière-plan

Pendant les recherches, l'app utilise un Chrome **invisible** (sans fenêtre) : tu peux continuer à utiliser ton
ordinateur normalement. Il reste ouvert entre deux étapes (c'est ce qui rend tout plus rapide) et se ferme seul après
10 minutes sans usage. Seule la **connexion** ouvre une fenêtre visible. Pour voir ce qu'il fait (débogage) :
`SHOW_BROWSER=1 npm start`.

## 7. Comment l'IA est utilisée

L'app lance **Claude Code en arrière-plan** (`claude -p`), avec **ton compte Claude** : il n'y a pas de clé API
à configurer, et la consommation est décomptée sur ton abonnement. L'IA n'intervient qu'à **deux moments** :
proposer les menus, puis composer et comparer les paniers — et, si besoin, remplacer des articles en rupture. Le profil, les connexions, le choix du panier,
le PDF et les notes n'en consomment pas.

## 8. Tes données

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

## 9. Dépannage

| Problème | Solution |
|---|---|
| « Claude n'a pas terminé » | vérifie que `claude` est installé et connecté (lance-le une fois dans un terminal), puis **Relancer** |
| Une étape a échoué | bouton **Relancer** sur la commande ; le détail de l'erreur est affiché |
| Frais bizarres, produits non trouvés | session expirée : **Comptes → Se connecter** |
| Une tâche reste « en attente » | une seule tâche tourne à la fois (une fenêtre de connexion encore ouverte bloque la file : connecte-toi ou ferme-la ; elle abandonne seule après 10 min) |
| « Article indisponible » au paiement | **🔄 Revérifier le panier** sur la page de la commande |
| « Ce panier n'existe plus » | déjà commandé, vidé ou expiré. Si tu n'as **pas** commandé : **♻️ Recréer le panier** |
| « Session expirée » | **Comptes → Se connecter**, puis relance l'étape |
| « Introuvable » sur un bouton | le serveur tourne avec une ancienne version : `Ctrl + C` puis `npm start` |
| Un Chrome caché semble bloqué | `node tools/browser.js stop`, puis relance l'étape |
| « limite les requêtes » / `too_many_requests` | Uber ou Deliveroo freine après beaucoup d'appels : attends 10-15 min puis **Relancer** (rien n'est doublé) |
| Changement d'adresse | modifie-la dans **Profil**, elle est prise en compte automatiquement |
| Un outil casse du jour au lendemain | les sites ont changé leur fonctionnement interne : ouvre `claude` dans le dossier et demande de réparer l'outil |

## 10. Mode avancé (terminal)

Tout reste faisable sans l'interface : lance `claude` dans le dossier et parle-lui (il suit `CLAUDE.md`).
Commandes directes :
- `node tools/recipes.js list` : recettes, notes et remarques ;
- `node tools/menus.js later` : menus mis de côté ;
- `node tools/ubereats.js clear all` : vide tous tes paniers Uber Eats ;
- `npm run check` : auto-tests (aucune connexion nécessaire).
