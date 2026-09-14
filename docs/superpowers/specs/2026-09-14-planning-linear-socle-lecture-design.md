# Planning IoT connecté à Linear — sous-projet 1 : socle et lecture

Date : 2026-09-14
Statut : validé, prêt pour le plan d'implémentation

## 1. Objectif

Remplacer `planning-iot.html`, fichier autonome dont les données sont figées dans le
code, par une application qui lit le workspace Linear réel et en présente le planning :
frise de Gantt, dépendances, jalons, capacités et charge prévisionnelle, en vue globale
et par team.

Ce sous-projet est **en lecture seule du côté de Linear**. Il ne peut donc rien modifier
ni casser dans le workspace. L'écriture vers Linear fait l'objet du sous-projet 2, décrit
en section 14.

## 2. Périmètre

Dans le périmètre :

- Backend unique servant le front compilé et une API, avec PostgreSQL.
- Lecture du workspace Linear : teams, projets, jalons, issues, relations de blocage,
  membres, commentaires.
- Couche de planification en base pour ce que Linear ne représente pas : capacités
  hebdomadaires, parts de contribution, réglages globaux, jours chômés.
- Vue globale de toutes les teams, vue par team, zone des tâches non planifiées.
- Frise portée depuis la version actuelle, avec zoom sur période et ligne du jour.
- Édition des données de planification stockées en base.
- Conteneurisation et déploiement.

Hors périmètre : toute écriture vers Linear, la création d'issues, de projets ou de
teams, le décalage en cascade, l'annulation d'une écriture.

## 3. Décisions de cadrage

Ces décisions ont été arrêtées avec le commanditaire et ne sont pas à rediscuter pendant
l'implémentation.

| Sujet | Décision |
|---|---|
| Clé API Linear | Une seule clé pour tout le monde. Jamais stockée côté serveur. Saisie par chaque personne, conservée en `localStorage`, modifiable à tout moment. |
| Contrôle d'accès | Une clé Linear valide vaut autorisation d'accès à l'API de l'application. |
| Périmètre du workspace | Découverte automatique complète : toutes les teams accessibles avec la clé, tous leurs projets. |
| Date de fin d'une tâche | Champ natif `dueDate` de l'issue. |
| Date de début d'une tâche | Ligne `Starting date: DD/MM/YYYY` dans la description de l'issue. |
| Date de début absente | La tâche va dans les non planifiées. Aucune date n'est déduite. |
| Contributeurs | Ligne de convention `Contributors: @a @b` dans un commentaire, seule source prise en compte. |
| Répartition des parts | Égale par défaut entre les contributeurs, modifiable à la main, dérogation stockée en base. |
| Identité des personnes | Indexée sur l'identifiant utilisateur Linear. |
| Actualisation | Rafraîchissement périodique, sans webhook ni abonnement. |
| Charge sur une page de team | Seules les heures de cette team, rapportées à la capacité totale de la personne. |
| Front | Portage du moteur de rendu existant en modules ES, sans framework. |

## 4. Architecture

Un service Node unique sert le front compilé et l'API sous `/api`, avec PostgreSQL à
côté. Deux conteneurs, plus un volume pour la base.

```
navigateur ──X-Linear-Key──> service Node ──> PostgreSQL (couche de planification)
                                  │
                                  └────────> api.linear.app/graphql (lecture)
```

Choix techniques : Node 22, Fastify, `pg`, Vite pour le bundling du front, Vitest pour
les tests. L'accès à Linear se fait par requêtes GraphQL écrites à la main plutôt que par
`@linear/sdk`, afin de maîtriser précisément les champs demandés — la complexité d'une
requête est plafonnée à 10 000 points par Linear, et le SDK ne donne pas ce contrôle fin.

Le backend est le seul appelant de Linear. C'est une contrainte, pas une préférence :
le quota Linear est attaché à l'utilisateur authentifié et non à la clé, or tout le monde
partage la même clé. Si chaque navigateur interrogeait Linear directement, dix onglets
ouverts consommeraient dix fois le quota pour la même information. Avec un instantané
partagé côté serveur, dix onglets coûtent autant qu'un seul.

Découpage en modules, chacun testable isolément :

| Module | Responsabilité |
|---|---|
| `linear/queries` | requêtes GraphQL et pagination |
| `linear/mapper` | réponse Linear → modèle du domaine |
| `linear/parsing` | lecture des lignes `Starting date` et `Contributors` |
| `sync/snapshot` | instantané en mémoire, versions, rafraîchissement, fusion incrémentale |
| `planning/calendar` | arithmétique en jours ouvrés, week-ends, jours chômés |
| `planning/load` | heures par tâche, parts, taux d'affectation, charge hebdomadaire |
| `db/*` | migrations et accès aux tables de planification |
| `api/*` | routes Fastify, validation de la clé |
| `ui/*` | rendu de la frise, pages, zoom, panneaux d'édition |

## 5. Circulation de la clé et contrôle d'accès

Au premier chargement, le front réclame la clé sur un écran dédié, la valide par un appel
`viewer { id name }` relayé par le backend, puis la conserve en `localStorage`. Un réglage
permet de la remplacer, ce qui vide le stockage local et renvoie à l'écran de saisie.

Chaque appel à `/api` porte l'en-tête `X-Linear-Key`. Le backend construit un client
Linear éphémère pour la durée de la requête. La clé n'est jamais écrite en base, ni dans
un fichier, ni dans les journaux — les journaux doivent la masquer explicitement.

Le backend valide la clé avant de servir toute route `/api`, avec un cache mémoire du
résultat de validation d'une durée de cinq minutes, indexé sur une empreinte de la clé et
non sur la clé elle-même, afin de ne pas appeler Linear à chaque requête.

Le rafraîchissement de l'instantané réutilise la clé de la requête qui l'a déclenché, en
mémoire vive et pour la seule durée du cycle.

## 6. Synchronisation

Un cycle unique, déclenché paresseusement. Quand une requête client arrive et que
l'instantané a plus de 45 secondes, le backend le rafraîchit. Les requêtes concurrentes
attendent le même rafraîchissement : une seule interrogation de Linear est en vol à un
instant donné.

Deux modes :

- **Incrémental**, à chaque cycle : les issues dont la date de modification est postérieure
  à la dernière synchronisation, triées par date de modification, fusionnées dans
  l'instantané.
- **Complet**, toutes les dix minutes et au démarrage : rechargement intégral, seul moyen
  de détecter les suppressions et les archivages, qu'un filtre incrémental ne révèle pas.

L'instantané porte un numéro de version, incrémenté uniquement lorsque les données ont
réellement changé. Le navigateur appelle `GET /api/snapshot?since=<version>` toutes les
trente secondes et ne reçoit un corps de réponse que si la version a bougé. Un bouton
d'actualisation force un cycle immédiat.

Si Linear est injoignable, le dernier instantané continue d'être servi, accompagné de son
âge, plutôt que de vider la page.

## 7. Modèle de données

La base ne stocke que ce qui n'existe pas dans Linear. Tout le reste est lu à la volée et
jamais dupliqué, ce qui supprime toute réconciliation entre deux sources.

```sql
settings                -- ligne unique
  singleton             boolean primary key default true
  hours_per_point       numeric not null default 5
  load_ceiling_pct      integer not null default 80
  default_weekly_hours  numeric not null default 28
  updated_at            timestamptz not null default now()

holiday
  day                   date primary key
  label                 text not null

person                  -- extension d'un membre Linear
  linear_user_id        text primary key
  role                  text
  default_weekly_hours  numeric        -- null : valeur de settings
  active                boolean not null default true

weekly_capacity         -- capacité exceptionnelle d'une semaine
  linear_user_id        text not null references person on delete cascade
  week_start            date not null  -- lundi
  hours                 numeric not null check (hours >= 0)
  primary key (linear_user_id, week_start)

contribution            -- dérogation à la répartition égale
  issue_id              text not null
  linear_user_id        text not null
  share                 numeric not null check (share >= 0)
  primary key (issue_id, linear_user_id)
```

Le nom et l'avatar d'une personne viennent de Linear ; seul l'identifiant sert de clé. Une
ligne `person` est créée à la volée lors de la première synchronisation pour chaque membre
rencontré.

`contribution` ne contient **que les dérogations**. En l'absence de ligne pour une issue,
la répartition est égale entre les contributeurs lus dans le commentaire de convention.
Une ligne visant une personne qui ne figure plus dans ce commentaire est ignorée au calcul
et purgée lors de la resynchronisation complète.

Les migrations sont des fichiers SQL numérotés appliqués au démarrage, avec une table de
suivi des migrations déjà passées.

Les préférences d'affichage — niveau de zoom, projets repliés, dernière page consultée —
vivent en `localStorage` et non en base : elles sont propres à chaque personne et sans
valeur partagée.

## 8. Correspondance avec Linear

| Linear | Application |
|---|---|
| `Team` | page de team, et regroupement de premier niveau en vue globale |
| `Project` (`startDate`, `targetDate`, `color`) | bandeau coloré de projet |
| `ProjectMilestone` | jalons, tous affichés, plusieurs par projet possibles |
| `Issue.title` | nom de la tâche |
| `Issue.estimate` | points |
| `Issue.dueDate` | date de fin |
| ligne `Starting date` de `Issue.description` | date de début |
| commentaire `Contributors: @a @b` | contributeurs |
| `Issue.assignee` | responsable |
| `Issue.state.type` | `backlog`, `unstarted` → à faire ; `started` → en cours ; `completed` → terminé ; `canceled` → annulée |
| `IssueRelation` de type `blocks` | dépendances et flèches |
| `User` | personne, étendue par la table `person` |

Cas particuliers :

- Le statut « bloqué » n'existe pas dans Linear. Il est **dérivé** : une tâche est signalée
  bloquée lorsqu'un de ses bloqueurs se termine après le début de la tâche. C'est le
  conflit déjà repéré en rouge par la version actuelle.
- Une issue sans ligne `Contributors` retombe sur son assigné seul, à 100 %. Sans assigné
  ni contributeur, elle est affichée mais ne pèse sur personne, et signalée comme telle.
- Les issues rattachées à une team mais à aucun projet sont regroupées dans un bloc
  « sans projet » de cette team.
- Les issues annulées sont masquées par défaut, avec une préférence d'affichage permettant
  de les montrer barrées. Comme les autres préférences d'affichage, elle vit en
  `localStorage` et reste propre à chaque personne.
- L'échelle d'estimation de Linear est configurable par team et n'est pas nécessairement
  celle de Fibonacci. L'application affiche la valeur telle quelle sans la contraindre.

### Lecture de la ligne `Starting date`

Première ligne de la description correspondant à
`^\s*Starting date\s*:\s*(\d{1,2})/(\d{1,2})/(\d{4})\s*$`, insensible à la casse. La date
doit exister réellement au calendrier — le 31/02 est un échec, pas un glissement au 3 mars.

### Lecture de la ligne `Contributors`

Parmi les commentaires de l'issue, le plus récent contenant une ligne correspondant à
`^\s*Contributors\s*:\s*(.+)$`, insensible à la casse. Les jetons précédés de `@` sont
extraits et résolus contre les membres Linear, par `displayName`, puis `name`, puis la
partie locale de l'adresse électronique, sans tenir compte de la casse. Un jeton non résolu
est ignoré et signalé sur la tâche.

Le format exact des mentions dans les commentaires Linear doit être confirmé sur des
données réelles avant de figer ce parseur : c'est l'objet de la commande de diagnostic
décrite en section 12.

## 9. Règles de calcul

Reprises de la version actuelle, désormais paramétrées en base plutôt que codées en dur.

- Heures d'une tâche = points × `hours_per_point`.
- Capacité hebdomadaire d'une personne = la ligne `weekly_capacity` de la semaine si elle
  existe, sinon `person.default_weekly_hours`, sinon `settings.default_weekly_hours`.
- Capacité journalière = capacité hebdomadaire ÷ 5. La capacité effective d'une semaine est
  la somme sur ses jours ouvrés, de sorte qu'une semaine contenant un jour chômé vaut
  mécaniquement moins : avec 28 heures par défaut, une semaine à quatre jours ouvrés vaut
  22,4 heures.
- Jours non ouvrés : samedis, dimanches, et les dates de la table `holiday`.
- Répartition : les parts des contributeurs sont ramenées à 100 %, et les heures obtenues
  sont étalées uniformément sur les jours ouvrés de la tâche.
- Taux d'affectation d'une personne sur une tâche = heures quotidiennes consacrées ÷
  capacité journalière. Au-delà de 100 %, signalé.
- Charge hebdomadaire = heures affectées dans la semaine ÷ capacité de la semaine. Une
  capacité nulle avec du travail affecté donne « indisponible » et un pic infini.
- Plafond de charge par défaut : `load_ceiling_pct`, 80 %.
- Une tâche non planifiée ne contribue à aucun calcul de charge.

Sur une page de team, seules les heures issues des issues de cette team entrent au
numérateur ; le dénominateur reste la capacité totale de la personne.

## 10. Interface

### Pages

- **Vue globale** — toutes les teams, chacune formant une bande, ses projets en dessous.
  Les lignes de charge additionnent les heures de toutes les teams pour chaque personne.
- **Vue d'une team** — projets et issues de cette team seulement, charge restreinte à cette
  team.
- **Tâches non planifiées** — bloc sous la frise, présent sur les deux vues, listant les
  issues sans date de début exploitable avec le motif de l'échec. En vue globale il couvre
  toutes les teams ; sur une page de team il se limite à celle-ci. Donner une date à une
  tâche suppose d'écrire dans Linear : c'est donc hors périmètre ici, et le bloc se contente
  de rendre le manque visible, en indiquant que la saisie arrivera au sous-projet 2.

### Frise

Le moteur existant est porté en modules ES : découpe des barres aux jours ouvrés, trait de
liaison au-dessus des interruptions, flèches de dépendances avec signalement rouge des
conflits, teintes de charge par palier, bandeaux de projet, jalons en losange.

**Ligne du jour.** Un repère vertical calculé sur la date réelle, traversant toute la
hauteur du plateau, frise et lignes de charge comprises, afin que l'écart entre une barre
et la ligne se lise immédiatement. La version actuelle fige cette date au 9 septembre 2026
dans `grid()` ; c'est un reste de mise au point, corrigé ici.

**Zoom.** La largeur du jour devient réglable et le panneau de droite défile, au lieu de
comprimer toute la période dans une largeur fixe. Trois préréglages — tout, trimestre,
mois — et un ajustement continu. Lors d'un changement d'échelle, le défilement se recale
sur la ligne du jour. L'impression force le mode « tout », une feuille ne défilant pas.

### Édition disponible dans ce sous-projet

Toute édition porte sur la base, jamais sur Linear :

- réglages globaux : heures par point, plafond de charge, capacité par défaut ;
- jours chômés : ajout et retrait ;
- par personne : rôle, capacité par défaut, capacités exceptionnelles semaine par semaine ;
- par tâche : parts des contributeurs, avec retour à la répartition égale.

Tout ce qui provient de Linear — titre, statut, estimation, dates, assigné, dépendances —
est affiché en lecture seule, avec une indication claire que la modification arrivera au
sous-projet 2. Aucun champ ne doit donner l'illusion d'être modifiable.

## 11. API

| Route | Rôle |
|---|---|
| `GET /api/health` | état du service et de la base, sans authentification |
| `POST /api/key/validate` | valide une clé, renvoie l'utilisateur Linear associé |
| `GET /api/snapshot?since=<version>` | instantané complet, ou rien si la version n'a pas changé |
| `POST /api/refresh` | force un cycle de rafraîchissement |
| `GET /api/planning` | contenu de la couche de planification |
| `PUT /api/settings` | réglages globaux |
| `PUT /api/people/:linearUserId` | rôle et capacité par défaut |
| `PUT /api/people/:linearUserId/capacity/:weekStart` | capacité exceptionnelle |
| `DELETE /api/people/:linearUserId/capacity/:weekStart` | retour à la capacité par défaut |
| `PUT /api/issues/:issueId/contributions` | parts d'une tâche |
| `DELETE /api/issues/:issueId/contributions` | retour à la répartition égale |
| `GET /api/diagnostic` | lecture détaillée d'un échantillon d'issues, voir section 12 |

Toutes les routes sauf `/api/health` exigent l'en-tête `X-Linear-Key`.

## 12. Gestion des erreurs

Principe directeur : ne jamais deviner une donnée de planification manquante, toujours la
rendre visible.

| Situation | Comportement |
|---|---|
| Clé invalide ou révoquée | 401, le front rouvre l'écran de saisie avec le motif, sans effacer la vue |
| Linear injoignable ou en erreur serveur | le dernier instantané est servi, avec son âge affiché en bandeau |
| Quota dépassé | espacement des cycles et signalement, plutôt que de marteler l'API |
| `Starting date` illisible ou date impossible | tâche en non planifiée, motif affiché, aucune date inventée |
| Fin antérieure au début | tâche en non planifiée, motif affiché |
| Issue sans estimation | zéro heure, signalée « sans estimation » pour que son absence de poids se voie |
| Mention non résolue dans `Contributors` | ignorée, signalée sur la tâche |
| Base inaccessible | échec franc et explicite. Servir des capacités par défaut produirait des taux faux, ce qui est pire que pas de page |
| Dépendances circulaires | détectées et signalées ; la détection est écrite dès maintenant car la cascade du sous-projet 2 en dépendra |

**Commande de diagnostic.** `GET /api/diagnostic` renvoie, pour un échantillon d'issues,
ce que l'application a compris de chacune : description brute, ligne `Starting date`
trouvée ou motif d'échec, commentaire `Contributors` retenu, mentions résolues et non
résolues, estimation, échéance, relations. C'est le moyen le plus rapide de confronter les
conventions de parsing aux données réelles, puisque l'implémentation se fait sans accès au
workspace.

## 13. Stratégie de test

Le cœur du système est un ensemble de fonctions pures, et c'est là que porte l'essentiel de
l'effort. Développement piloté par les tests.

- **Unitaires, sans réseau ni base** : arithmétique en jours ouvrés avec week-ends et jours
  chômés, lecture de `Starting date`, lecture de `Contributors` et résolution des mentions,
  normalisation des parts, heures par tâche, taux d'affectation, charge hebdomadaire,
  capacité d'une semaine amputée d'un jour chômé, détection des conflits de dépendances et
  des cycles.
- **Traduction Linear → domaine** : sur des réponses enregistrées, couvrant les cas tordus —
  issue sans projet, sans estimation, sans assigné, relations dans les deux sens, projet
  sans jalon, team vide.
- **Cache et synchronisation** : contre un faux client Linear — fusion incrémentale,
  incrément de version seulement en cas de changement réel, requêtes concurrentes ne
  déclenchant qu'un seul rafraîchissement, resynchronisation complète détectant une
  suppression.
- **Base** : migrations et accès, sur une base PostgreSQL jetable.
- **Front** : un test de rendu sur un jeu de données figé — nombre de barres, positions,
  découpe aux week-ends, position de la ligne du jour. Pas de test DOM exhaustif.

La conformité du parsing aux vraies issues ne peut pas être vérifiée pendant
l'implémentation, faute d'accès au workspace. Elle se fait par une exécution du
commanditaire contre `GET /api/diagnostic`, et les conventions sont ajustées ensuite si
nécessaire.

## 14. Déploiement

Deux conteneurs, orchestrés par un fichier de composition pour le développement local et
déployés sur un hébergement de conteneurs en production.

- **Application** : image Node, build du front à la construction de l'image, port unique.
- **PostgreSQL** : image officielle, volume persistant.

Configuration par variables d'environnement uniquement : `DATABASE_URL`, `PORT`,
`LOG_LEVEL`. **Aucune variable ne contient de clé Linear** — l'application n'en détient
jamais au repos.

L'application n'écrit rien sur le disque en dehors de PostgreSQL, ce qui la rend
redémarrable et remplaçable à volonté. Au redémarrage, l'instantané est vide et se
reconstruit à la première requête portant une clé valide. `GET /api/health` sert aux
sondes de vivacité de l'hébergeur.

## 15. Sous-projet 2, hors périmètre ici

Pour mémoire, et pour que les décisions déjà prises ne se reperdent pas :

- Écriture de tous les champs vers Linear, avec envoi immédiat et possibilité d'annuler.
- Réécriture de la ligne `Starting date` dans la description sans abîmer le reste du texte.
- Création d'issues, de projets, et de teams — le bouton « ajouter » crée réellement la team
  dans Linear.
- Décalage en cascade : rigide, en jours ouvrés, transitif, dans les deux sens, conservant
  les écarts relatifs.

Ces fonctionnalités supposent du sous-projet 1 : la détection des cycles de dépendances,
l'arithmétique en jours ouvrés, et un modèle du domaine stable.

## 16. Risques et points à surveiller

- **Format des mentions dans les commentaires Linear.** Le parseur repose sur une hypothèse
  à confirmer sur données réelles. C'est le risque le plus concret, et la commande de
  diagnostic existe pour le lever tôt.
- **Volume du workspace.** La complexité d'une requête est plafonnée à 10 000 points. Si le
  workspace est vaste, la synchronisation complète devra être découpée par team et paginée
  plus finement que prévu.
- **Coût de la lecture des commentaires.** Charger les commentaires de chaque issue pour y
  chercher la ligne `Contributors` alourdit la synchronisation. Le mode incrémental limite
  la dépense, mais la resynchronisation complète est à surveiller.
- **Qualité des descriptions.** Le planning ne vaudra que ce que valent les lignes
  `Starting date` et `Contributors` saisies dans Linear. Le commanditaire en est conscient
  et assume cette discipline ; la zone des tâches non planifiées est le garde-fou qui rend
  les manques visibles au lieu de les masquer.
