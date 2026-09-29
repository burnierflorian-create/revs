# REVS MASTER TUTORIAL

<!-- meta
version: 1.1
referenceCommit: 0ba9337
referenceDate: 29 septembre 2026
lastVerified: 29 septembre 2026
-->

## 0. INTRODUCTION

> Pourquoi ce document existe, comment le lire, et la règle qui prime sur toutes les autres.

**REVS MASTER TUTORIAL — Version 1.0**

| | |
|---|---|
| Commit de référence | `0ba9337` |
| Date de référence | 29 septembre 2026 |
| Dernière vérification | 29 septembre 2026 |
| État du dépôt à la vérification | `b500675` (4 commits après la référence) |

### Pourquoi ce tutoriel existe

REVS a dépassé la taille qu'une tête retient. 37 873 lignes de TypeScript côté application, 6 249 côté serveur, 42 tables, 66 fonctions SQL, 75 migrations. La conséquence n'est pas théorique : elle s'est déjà matérialisée plusieurs fois, sous la forme d'un système reconstruit alors qu'il existait déjà ailleurs, ou d'une correction appliquée à un endroit pendant que la vraie cause vivait à un autre.

Ce document sert trois lecteurs :

1. **Florian** — comprendre rapidement comment REVS est construit, sans relire le code.
2. **Claude Code** — disposer d'une référence de départ à chaque mission, pour chercher l'existant avant de créer du nouveau.
3. **La V2 de ce document** — servir de base à enrichir chapitre par chapitre, sans tout réécrire.

### Comment l'utiliser

Ce tutoriel est une **carte**, pas un territoire. Il dit où regarder et ce qui devrait s'y trouver. Il ne remplace ni le code, ni la base de données, ni les migrations.

Concrètement :

- Il est juste au moment de sa dernière vérification. Le code, lui, bouge.
- Les chiffres (tables, endpoints, quotas) ont été relevés dans la base et dans le dépôt réels, pas recopiés d'un document antérieur.
- Quand un point diffère entre le commit de référence et l'état actuel, les deux sont affichés côte à côte. Rien d'ancien n'est présenté comme actuel.

### Ce qu'il ne remplace pas

- **Le code.** Une constante citée ici peut avoir changé depuis. Vérifier.
- **Les migrations.** `supabase/*.sql` est l'histoire complète du schéma ; ce document n'en donne que la forme.
- **Un audit.** Ce tutoriel décrit ce qui existe, y compris les manques, mais il n'a pas vocation à les chercher.

### La règle fondamentale

> **Avant de modifier REVS, comprendre l'existant avant de créer du nouveau.**

Ce n'est pas une formule de politesse. Chaque système décrit ici a des effets de bord — un `INSERT` dans `spots` déclenche cinq déclencheurs, dont trois qui écrivent dans d'autres tables. Un système reconstruit à côté de l'existant ne remplace pas l'ancien : il le double, et les deux divergent.

---

## 1. REVS EN UNE VUE

> La boucle produit, les dix domaines, et comment ils s'emboîtent.

REVS est une **application automobile sociale** qui combine quatre choses que la plupart des apps traitent séparément : la collection, la gamification, l'identification par IA, et le social de proximité.

En une phrase : **tu photographies une voiture dans la rue, l'IA l'identifie, elle rejoint ta collection, tu progresses, tu partages, et les autres la découvrent sur la carte.**

### La boucle principale

```
SPOT  →  IDENTIFY  →  COLLECT  →  PROGRESS  →  SHARE  →  DISCOVER
 ▲                                                          │
 └──────────────────────────────────────────────────────────┘
```

| Étape | Ce que fait l'utilisateur | Ce que fait le système |
|---|---|---|
| **SPOT** | Photographie une voiture | Redimensionne, floute la plaque, capture le GPS |
| **IDENTIFY** | Confirme ou corrige | Claude identifie marque / modèle / année / couleur, estime la valeur, en déduit la rareté |
| **COLLECT** | Publie | Insertion en base → la carte de collection est créée ou monte de niveau |
| **PROGRESS** | — | XP, niveau, défis, badges, classement |
| **SHARE** | Partage la carte | Visuel canvas + lien `/s/:id` avec aperçu Open Graph |
| **DISCOVER** | Ouvre la carte, le fil, l'actu | Spots des autres (1 h), actualités, F1, événements |

### Les dix domaines

| Domaine | Cœur du sujet | Chapitre |
|---|---|---|
| **Spot** | La capture et sa publication | 3 |
| **IA** | Identification, plaques, prix, rareté | 4 |
| **Collection** | Cartes évolutives, garage, marques | 6 |
| **Gamification** | XP, niveaux, défis, badges, classements | 6 |
| **Social** | Fil, likes, commentaires, abonnements, profils | 7 |
| **Map** | Carte Mapbox, GPS, temps réel | 8 |
| **F1 / Events** | Calendrier, grille, circuits, rassemblements | 9 |
| **Premium** | Stripe, paliers, quotas | 10 |
| **Profil** | Identité, réglages, préférences, RGPD | 12 |
| **Notifications** | Push web, crons | 11 |

### Schéma d'architecture

```
┌──────────────────────── NAVIGATEUR (PWA) ────────────────────────┐
│  React 19 + Vite 8                                               │
│                                                                  │
│   5 onglets toujours montés     ·     routes « pile » par-dessus │
│   Carte  Fil  Accueil  Découvrir  Profil                         │
│                                                                  │
│   src/lib/  — 48 modules : logique métier partagée               │
│   Service Worker (src/sw.ts) — push uniquement, aucun cache      │
└────────────┬─────────────────────────────────┬───────────────────┘
             │                                 │
      PostgREST / Realtime              fetch /api/*
             │                                 │
┌────────────▼──────────────┐   ┌──────────────▼────────────────────┐
│  SUPABASE  (eu-west-3)    │   │  VERCEL — 14 fonctions            │
│                           │   │                                   │
│  Auth · PostgreSQL 17     │◄──┤  12 Node + 2 edge                 │
│  Storage · Realtime       │   │  IA · Stripe · push · crons · OG  │
│  42 tables · 70 RLS       │   │  server/ — modules partagés       │
│  66 fonctions · 11 trig.  │   └──────────────┬────────────────────┘
└───────────────────────────┘                  │
                                  ┌────────────▼───────────────┐
                                  │  Anthropic · Stripe        │
                                  │  Mapbox · Jolpica · RSS    │
                                  └────────────────────────────┘
```

---

## 2. ARCHITECTURE DU CODE

> Les sept couches, ce qu'on met dans chacune, et ce qu'on n'y met surtout pas.

### Les couches

#### `src/pages/` — 36 écrans

Un fichier = un écran adressable. Une page lit la base, orchestre des composants, gère son propre état de chargement.

- **Exemples** : `Map.tsx` (2 573 lignes, le plus gros fichier du projet), `NewSpot.tsx`, `Settings.tsx`, `SpotDetail.tsx`.
- **Quand l'utiliser** : il y a une URL, ou l'écran est un onglet.
- **À éviter** : y mettre de la logique métier réutilisable. Si deux pages en ont besoin, c'est un module `lib/`.

#### `src/components/` — 43 composants

Morceaux d'interface réutilisables ou overlays globaux montés une fois dans `MainLayout`.

- **Exemples** : `CollectorCardV2.tsx`, `ShareCardSheet.tsx`, `Onboarding.tsx`, `LevelUpOverlay.tsx`.
- **Quand l'utiliser** : le même bloc visuel apparaît à deux endroits, ou c'est un overlay déclenché depuis n'importe où.
- **À éviter** : les appels réseau directs — passer par `lib/`.

#### `src/lib/` — 48 modules

**C'est ici que vit la vérité métier.** Barèmes XP, catalogues de raretés, calculs de distance, accès Supabase, i18n, thème.

- **Exemples** : `xp.ts` (l'échelle de niveaux), `spots.ts` (types + redimensionnement + floutage), `geo.ts` (GPS durci + arrondi), `plans.ts` (paliers d'abonnement), `supabase.ts` (le client unique).
- **Quand l'utiliser** : dès qu'une règle est citée à deux endroits. Un barème dupliqué finit toujours par diverger.
- **À éviter** : importer React dedans, sauf pour les quelques modules qui exportent un hook (`theme.tsx`, `tier.ts`).

#### `api/` — 14 fonctions serverless

Tout ce qui ne peut pas tourner dans le navigateur : clés secrètes, appels IA, webhooks, crons.

- **Règle dure** : *tout fichier placé dans `api/` devient une fonction Vercel.* Le projet fonctionne sous une contrainte de **12 fonctions Node maximum** (plafond du plan Hobby), et il y est **exactement** ; `og.ts`, `s.ts` et `tutorial.ts` sont en **edge** précisément pour ne pas la franchir.
  > Le plan Vercel exact n'a pas été revérifié pour cette V1 — la contrainte est celle documentée dans le dépôt et appliquée par les endpoints existants. Avant de tenter une 13ᵉ fonction Node, confirmer le plan dans le tableau de bord Vercel.
- **À éviter** : y placer un module partagé. C'est la raison d'être de `server/`.

#### `server/` — modules partagés hors `api/`

Code serveur importé par les fonctions, délibérément à l'extérieur d'`api/` pour ne pas compter comme fonction.

- `ai-gate.js` — le portail d'accès aux endpoints IA
- `request-size.js` — le plafond de 10 Mo sur le corps des requêtes
- `f1-calendar.js` — le portail calendrier du cron F1
- `tutorial-access.js` / `tutorial-content.js` — ce tutoriel

Chaque `.js` a un `.d.ts` à côté pour que les fonctions TypeScript le consomment proprement.

#### `supabase/` — 75 migrations numérotées

`0001-…` à `0075-…`, plus `schema.sql`, `seed-phase1.sql`, `fix-spots-rls.sql`.

- **Règle** : on n'édite jamais une migration déjà appliquée. On en ajoute une.
- Application : `node scripts/apply-rls.mjs supabase/00XX-….sql` avec un jeton d'accès personnel Supabase. La clé `service_role` **ne peut pas** exécuter de DDL — c'est une limite de la plateforme, pas un oubli.

#### `public/` — actifs statiques

Icônes, manifeste PWA, images de marque générées par `scripts/build-brand.mjs`.

### Les chiffres du projet

| | Au commit `0ba9337` | Actuel | |
|---|---|---|---|
| Pages | 36 | **36** | — |
| Composants | 43 | **43** | — |
| Modules `lib/` | 48 | **48** | — |
| Endpoints `api/` | 14 | **14** | +1 (tutoriel), −0 : voir note |
| Tables | 41 | **42** | +`news_seen` (0075) |
| Fonctions SQL | 66 | **66** | — |
| Déclencheurs | 11 | **11** | — |
| Politiques RLS | 70 | **70** | — |
| Migrations numérotées | 72 | **75** | +0073, +0074, +0075 |
| Clés i18n | 1 013 × 2 | **1 013 × 2** | — |
| Tests automatisés | 0 | **0** | — |

> **Note sur le comptage des endpoints.** Les 14 recensés ci-dessus sont ceux du commit de référence. Ce tutoriel en ajoute un quinzième (`api/tutorial.ts`), en **edge**, donc sans impact sur le plafond de 12 fonctions Node.
>
> **Note sur les lignes de code.** La cartographie de référence annonce 42 674 lignes TS/TSX sans préciser son périmètre. Mesure actuelle, périmètre explicite : **37 873** lignes `.ts`/`.tsx` dans `src/`, **6 249** lignes dans `api/` + `server/`. Les deux chiffres ne sont pas directement comparables.

---

## 3. LE SYSTÈME SPOT

> Le parcours complet d'une photo, de l'appareil jusqu'à son expiration. Le chapitre le plus important du document.

Un « spot » est l'objet central de REVS. Tout le reste en dépend : XP, cartes, défis, carte, fil, classement. Comprendre ce parcours, c'est comprendre 70 % de l'application.

### Le parcours

```
       PHOTO                  src/pages/NewSpot.tsx
         ↓
      RESIZE ×2               src/lib/spots.ts → resizeImageToJpeg()
         ↓                    1280px q0.82 (stockage) · 768px q0.85 (IA)
   ┌─────┴─────┐
   ↓           ↓              Promise.all — les deux appels IA en parallèle
IDENTIFY   DETECT-PLATE       /api/identify-car   ·   /api/detect-plate
   ↓           ↓
   └─────┬─────┘
         ↓
       BLUR                   src/lib/spots.ts → blurRegions()
         ↓                    appliqué sur l'ORIGINALE, pas sur la copie IA
        GPS                   src/lib/geo.ts → getCurrentPositionSafe()
         ↓                    + roundCoord() : 3 décimales
      STORAGE                 bucket `spots`, chemin {user_id}/{timestamp}.jpg
         ↓
       INSERT                 table `spots`
         ↓
     5 TRIGGERS               quota · arrondi · compteur · XP · défis
         ↓
     DIFFUSION               Realtime `postgres_changes` + scrutin 60 s
         ↓
  CARTE / FIL                 Map.tsx · Feed.tsx
         ↓
    EXPIRATION                expires_at = created_at + 1 h
         ↓
    SUPPRESSION               manuelle : fichier PUIS ligne
```

### Étape par étape

#### 1 · Photo

- **Où** : `src/pages/NewSpot.tsx`
- **Quoi** : appareil natif (Capacitor Camera) ou import.
- **Contrôle anti-fraude** : `MAX_PHOTO_AGE_MS = 5 minutes`. Une photo dont l'EXIF indique plus de 5 minutes est refusée. `MAX_GPS_DRIFT_M = 300` : si l'EXIF porte des coordonnées éloignées de plus de 300 m de la position actuelle, refus également.
- **Risque** : l'EXIF est effacé par certaines galeries — le contrôle est alors inopérant, sans que ce soit détectable.

#### 2 · Redimensionnement

- **Où** : `src/lib/spots.ts` → `resizeImageToJpeg(file, maxDim, quality)`
- **Deux sorties distinctes**, et c'est volontaire :
  - **1280 px, qualité 0,82** → la version stockée et affichée.
  - **768 px, qualité 0,85** → la copie envoyée à l'IA.
- **Pourquoi deux** : l'IA n'a pas besoin de la pleine résolution, et chaque pixel envoyé est facturé. L'originale reste disponible pour le floutage et l'affichage.
- **Produit** : un `Blob` JPEG et son base64 brut (sans préfixe `data:`).

#### 3 · Appels IA — en parallèle

- **Où** : `NewSpot.tsx`, un `Promise.all` sur `/api/identify-car` et `/api/detect-plate`.
- **Durée bornée** : 25 s.
- **Asymétrie assumée** : l'échec de `detect-plate` est **non fatal** — on saute le floutage. L'échec d'`identify-car` bloque, lui, la publication.
- **Depuis `0ba9337`** : quand la détection de plaque échoue, `plates` vaut `null` (distinct d'un tableau vide, qui signifie « analysé, aucune plaque »). L'interface affiche alors une case à cocher obligatoire avant de pouvoir continuer — on ne publie plus en silence une photo dont la plaque n'a pas pu être analysée.

#### 4 · Floutage de plaque

- **Où** : `src/lib/spots.ts` → `blurRegions(blob, boxes)`
- **Quoi** : les boîtes renvoyées par `detect-plate` sont appliquées **sur l'image d'origine**, pas sur la copie IA — sinon on stockerait une image de 768 px.
- **Résultat** : l'image stockée est déjà floutée. La photo sauvegardée dans la galerie du téléphone l'est aussi.
- **Limite connue** : le modèle peut **manquer** une plaque. Voir chapitre 12.

#### 5 · GPS

- **Où** : `src/lib/geo.ts`
- **`getCurrentPositionSafe()`** : enveloppe durcie de `navigator.geolocation` — handlers nommés, `try/catch` autour du dispatch, garde `typeof window`. Ce durcissement vient d'un vrai plantage en production (`b is not a function` après minification).
- **`roundCoord()`** : arrondi à **3 décimales** (`COORD_DECIMALS = 3`), soit ≈ 110 m. Sans cet arrondi, plusieurs spots au même endroit trahiraient un domicile au mètre près — et `spots` est en **lecture publique**.
- **Défense en profondeur** : le déclencheur `round_spot_coords` (migration 0069) réapplique le même arrondi côté base. Le client peut être contourné ; le déclencheur, non.

#### 6 · Stockage

- **Bucket** : `spots`, chemin `{user_id}/{timestamp}.jpg`.
- **Pourquoi ce préfixe** : les politiques RLS de `storage.objects` s'appuient dessus (`storage.foldername(name)[1] = auth.uid()`). C'est ce qui permet à un utilisateur d'effacer ses propres fichiers et à lui seul.
- **Ordre** : téléversement **puis** insertion.
- **Risque associé** : si l'insertion échoue après un téléversement réussi, le fichier est orphelin. **Corrigé** — voir « État actuel » plus bas.

#### 7 · Insertion en base

- **Table** : `spots`, 23 colonnes.
- **Colonnes clés** : `photo_url`, `lat`, `lng`, `brand`, `model`, `year`, `color`, `category`, `rarity`, `estimated_price`, `car_info` (jsonb), `expires_at`.
- **`expires_at`** : valeur par défaut `now() + 1 heure`.

#### 8 · Les cinq déclencheurs

C'est le point le plus souvent sous-estimé. **Un seul `INSERT` dans `spots` déclenche cinq fonctions.**

| Ordre | Déclencheur | Fonction | Ce qu'il fait |
|---|---|---|---|
| BEFORE | `trg_enforce_spot_daily_quota` | `enforce_spot_daily_quota` | Refuse au-delà du quota du jour |
| BEFORE | `trg_round_spot_coords` | `round_spot_coords` | Réapplique l'arrondi GPS à 3 décimales |
| AFTER | `trg_bump_spot_count` | `bump_spot_count` | Incrémente `spot_count_daily` |
| AFTER | `trg_xp_spot` | `award_xp_spot` | XP + progression de carte |
| AFTER | `trg_auto_claim_weekly_challenges` | `auto_claim_weekly_challenges_on_spot` | Valide les défis remplis |

**Conséquence pratique** : créer un spot « pour tester » n'est jamais neutre. Cela consomme un quota, écrit de l'XP, fait progresser une carte et peut valider un défi. C'est la raison pour laquelle les vérifications de temps réel se font par un `UPDATE` neutre — aucun déclencheur ne réagit aux `UPDATE` sur `spots`.

#### 9 · Diffusion

Deux canaux, complémentaires :

1. **Realtime** — `Map.tsx` s'abonne à `postgres_changes` sur `spots`. C'est la voie instantanée.
2. **Scrutin** — `POLL_MS = 60 000`. Le filet de sécurité.

Il existe aussi un **pont applicatif** (`onNewSpot`) qui affiche immédiatement le spot à son auteur, dans **son seul onglet**. Ce pont a longtemps masqué une panne : l'auteur voyait son spot, les autres non.

#### 10 · Carte et fil

- **Carte** (`Map.tsx`) : source GeoJSON, filtres catégorie / marque / recherche, ne charge que les spots dont `expires_at > now()`.
- **Fil** (`Feed.tsx`) : liste sociale — likes, commentaires, partage.

#### 11 · Expiration

- `expires_at = created_at + 1 heure`.
- **Ce n'est pas une suppression.** La ligne reste en base, la photo aussi. Seul l'affichage sur la carte s'arrête. Le spot reste dans la collection, la galerie, le profil, et compte toujours pour l'XP et les cartes.

#### 12 · Suppression

- **Où** : `src/pages/SpotDetail.tsx`, bouton corbeille visible uniquement pour le propriétaire.
- **Ordre impératif** : **fichier puis ligne.** Dans l'autre sens, un échec laisserait une photo que plus rien ne référence — introuvable, donc inextinguible.
- **Le quota n'est pas rendu** : supprimer un spot ne libère pas de crédit de publication.

### ÉTAT AU COMMIT `0ba9337` → ÉTAT ACTUEL

| Sujet | Au commit `0ba9337` | Actuel |
|---|---|---|
| **Diffusion temps réel** | `spots` **absente** de la publication `supabase_realtime` → le canal ne se déclenchait jamais. Les autres utilisateurs voyaient le spot jusqu'à **60 s** plus tard (scrutin). | Publiée (migration **0073**). Diffusion vérifiée en **< 3 s**, y compris pour un client anonyme. |
| **Fichiers orphelins** | Un échec d'insertion après téléversement laissait le fichier. 33 fichiers pour 30 lignes. | Rollback du fichier ajouté dans `NewSpot.tsx` ; les 3 orphelins supprimés. **30 fichiers / 30 lignes.** |
| **Quota rendu à la suppression** | `enforce_spot_daily_quota` comptait les lignes vivantes → supprimer un spot rendait le crédit. | Migration **0074** : le plafond lit le compteur cumulatif `spot_count_daily`. Supprimer ne rend plus rien. |
| **Bascule du jour de quota** | `bump_spot_count` écrivait `current_date` (UTC) alors que le plafond bornait sur Paris → divergence d'une à deux heures chaque nuit. | Les deux lisent désormais `(now() at time zone 'Europe/Paris')::date`. |
| **Requête carte** | `select('*')` — 23 colonnes, dont `car_info` (jsonb). | 12 colonnes explicites. |

---

## 4. IA REVS

> Trois endpoints, un portail unique, et la règle qui doit précéder tout nouvel appel.

### Les endpoints

| Endpoint | Rôle | Modèles |
|---|---|---|
| `/api/identify-car` | Marque, modèle, année, couleur, valeur, rareté | Haiku 4.5 (vision) puis Sonnet 4.6 en escalade |
| `/api/detect-plate` | Boîtes englobantes des plaques | Haiku 4.5 puis Sonnet 4.6 en reprise |
| `/api/car-info` | Fiche détaillée d'un modèle (specs, photos presse) | Sonnet 4.6 + Haiku pour le prix |
| `/api/brand-description` | Texte de présentation d'une marque | Sonnet 4.6 |

### L'échelle d'escalade d'`identify-car`

C'est le mécanisme le plus subtil du pipeline. Quatre tentatives, par coût croissant :

| # | Modèle | Invite | Jetons max | Condition de sortie |
|---|---|---|---|---|
| 1 | **Haiku 4.5** | `SYSTEM_STRICT` | 600 | Confiance ≥ seuil |
| 2 | Sonnet 4.6 | `SYSTEM_STRICT` | 600 | Réponse exploitable |
| 3 | Sonnet 4.6 | `SYSTEM_SIMPLE` | 600 | Réponse exploitable |
| 4 | Sonnet 4.6 | `SYSTEM_MINIMAL` | 250 | Dernier recours |

Une réponse Haiku de confiance insuffisante est **conservée en repli** : si les trois tentatives Sonnet échouent aussi, c'est elle qui est renvoyée plutôt que rien.

**Conséquence sur les coûts** : une identification facile coûte un appel Haiku (~0,001 $). Une identification difficile peut en coûter quatre. Le coût moyen observé est d'environ **0,01 $ par capture**.

### Rareté — dérivée, jamais devinée

La rareté n'est **pas** demandée à l'IA. Elle est calculée à partir de la valeur de revente estimée :

| Rareté | Seuil |
|---|---|
| `standard` | 0 € |
| `premium` | 20 000 € |
| `performance` | 45 000 € |
| `exclusif` | 90 000 € |
| `supercar` | 130 000 € |
| `hypercar` | 400 000 € |

Le barème vit à deux endroits qui doivent rester alignés : `api/identify-car.js` (`RARITY_BANDS`) et `src/lib/rarity.ts`.

### Les caches — trois niveaux

1. **`car_catalog`** — gel modèle par modèle : un couple (marque, modèle) déjà évalué ne repasse jamais par l'IA pour son prix. Clé : `slug` normalisé (accents retirés, minuscules, espaces compactés).
2. **`car_info_cache`** (migration 0070) — cache de la fiche détaillée, au niveau du modèle et non du spot.
3. **`car_renders`** — bibliothèque partagée d'images, rangée par marque / modèle.

### Le portail IA (`server/ai-gate.js`)

Point de vérité unique pour `identify-car` et `detect-plate`. Créé après le diagnostic du 25/09/2026 : les deux endpoints acceptaient des appels Claude **sans aucun contrôle d'accès** — CORS `*`, aucun jeton exigé, quota contournable en omettant simplement l'en-tête `Authorization`.

**Règle : FAIL-CLOSED.** Au moindre doute — jeton absent, invalide, expiré, compteur illisible — on refuse. Il n'existe plus de mode invité, d'utilisateur assumé, ni de chemin qui atteint Claude sans `user_id` vérifié.

| Contrôle | Valeur |
|---|---|
| Authentification | **Obligatoire**, jeton Supabase vérifié |
| Cooldown | **3 000 ms** entre deux appels d'un même utilisateur sur un même endpoint |
| Consommation | **Atomique** — `ai_gate_consume()`, migration 0067 |
| Taille du corps | **10 Mo** maximum (`server/request-size.js`, HTTP 413) |
| Remise à zéro | Minuit, **heure de Paris** |
| Journal d'abus | Table `api_abuse_attempts`, IP salée (`ABUSE_IP_SALT`) |

### Quotas journaliers

| Palier | Appels IA / jour |
|---|---|
| **FREE** | 5 |
| **STARTER** | 5 |
| **PREMIUM** | 30 |
| **VIP** | 300 |

Le palier vient de `user_tier()`, dérivé de l'abonnement Stripe — **pas** de `profiles.tier`, qui n'est plus une source de vérité.

> **Alignement volontaire** : le gratuit est passé de 6 à 5 le 26/09/2026 pour coller à la limite de spots **publiables** par jour. Les deux plafonds étaient désalignés : l'utilisateur payait un 6ᵉ scan qui était ensuite refusé à la publication.

Ces valeurs sont répliquées à trois endroits qui doivent rester cohérents : `server/ai-gate.js` (référence), `src/lib/plans.ts`, et le déclencheur de la migration 0068.

### La règle avant tout nouvel appel IA

> **Avant d'ajouter un nouvel appel IA, vérifier si l'information peut être obtenue depuis le cache, la base ou une logique déterministe.**

Ce n'est pas de la frilosité. Le cron d'actualités a longtemps payé un appel Sonnet complet pour **trier** des articles jetés juste après — environ 100 appels par article publié. La rareté, elle, a été retirée de l'IA et dérivée du prix : plus juste, plus stable, gratuite.

### Limites actuelles — à énoncer sans les adoucir

- **Plaques** : système de détection et de floutage existant, mais **une plaque peut être manquée par le modèle**. Il n'y a pas de second filet.
- **Visages** : **aucune détection ni floutage systématique** actuellement.
- **Coûts** : variables selon le chemin emprunté dans l'escalade ; une identification difficile coûte jusqu'à quatre fois une identification facile.
- **Clé de production** : voir chapitre 15 — l'état de crédit de la clé Anthropic conditionne tout ce chapitre.

---

## 5. SUPABASE / BASE DE DONNÉES

> 42 tables, 70 politiques, 11 déclencheurs, et ce qui se passe réellement quand on insère un spot.

### Ce que Supabase fournit à REVS

| Brique | Usage dans REVS |
|---|---|
| **Auth** | Sessions, e-mail + mot de passe, Google OAuth, récupération de mot de passe |
| **PostgreSQL 17** | 42 tables, région **eu-west-3 (Paris)** |
| **Storage** | 3 buckets : `spots`, `avatars`, `car-renders` |
| **Realtime** | Publication `supabase_realtime` — **1 table : `spots`** |
| **RLS** | 70 politiques ; **RLS activée sur les 42 tables** |
| **Functions** | 66 fonctions, dont la plupart en `SECURITY DEFINER` |
| **Triggers** | 11 déclencheurs |
| **Migrations** | 74 fichiers numérotés dans `supabase/` |

### Schéma simplifié

```
auth.users
    │  1:1
    ▼
profiles ──────┬──── xp_transactions      (XP, une ligne par gain)
  user_id      ├──── card_progress        (collection : 1 carte = marque+modèle+couleur)
               ├──── spot_count_daily     (compteur cumulatif de publication)
               ├──── subscriptions        (Stripe → user_tier())
               ├──── push_subscriptions   (endpoints Web Push)
               ├──── notification_prefs
               ├──── radar_prefs
               ├──── followers            (abonnements entre comptes)
               ├──── brand_follows
               ├──── user_challenges / user_weekly_challenges / user_challenge_difficulty
               └──── referrals
                        │
spots ◄────────────────┘
  │  user_id
  ├──── spot_likes
  ├──── comments
  └──── events (event_id, facultatif)

Référentiels partagés, sans propriétaire :
  car_catalog · car_specs · car_renders · car_info_cache · brand_descriptions
  f1_grid · f1_teams · f1_drivers · f1_results · f1_race_results · f1_circuit_images
  races · race_rewards · challenges · daily_challenges · collection_progress
  news · news_meta · spotting_predictions · organizer_requests
  ai_usage · api_abuse_attempts
```

### Les politiques RLS qui comptent

| Table | Commande | Rôle | Condition |
|---|---|---|---|
| `spots` | SELECT | **public** | `true` — **lecture publique totale** |
| `spots` | INSERT | authenticated | `auth.uid() = user_id` |
| `spots` | UPDATE | authenticated | `auth.uid() = user_id` |
| `spots` | DELETE | authenticated | `auth.uid() = user_id` |
| `profiles` | SELECT | public | `is_public OR auth.uid() = user_id` |
| `profiles` | INSERT / UPDATE | authenticated | `auth.uid() = user_id` |
| `subscriptions` | SELECT | public | `auth.uid() = user_id` — **pas d'INSERT client** |
| `spot_count_daily` | SELECT | authenticated | `auth.uid() = user_id` — lecture seule |
| `storage.objects` | DELETE | authenticated | `bucket_id` + `foldername(name)[1] = auth.uid()` (migration 0071) |

**Deux tables sans aucune politique** : `ai_usage` et `api_abuse_attempts`. RLS activée, zéro politique → **aucun client ne peut les lire ni les écrire.** Seule la clé `service_role` y accède. C'est intentionnel : ce sont les compteurs qu'on cherche justement à rendre incontournables.

**Le point à retenir sur `spots`** : la lecture est publique, y compris pour un visiteur anonyme porteur de la clé publique. C'est ce qui justifie l'arrondi GPS et le floutage de plaque. Toute colonne ajoutée à `spots` est, par construction, publique.

### Les 11 déclencheurs

| Table | Déclencheur | Moment | Fonction |
|---|---|---|---|
| `spots` | `trg_enforce_spot_daily_quota` | BEFORE INSERT | `enforce_spot_daily_quota` |
| `spots` | `trg_round_spot_coords` | BEFORE INSERT | `round_spot_coords` |
| `spots` | `trg_bump_spot_count` | AFTER INSERT | `bump_spot_count` |
| `spots` | `trg_xp_spot` | AFTER INSERT | `award_xp_spot` |
| `spots` | `trg_auto_claim_weekly_challenges` | AFTER INSERT | `auto_claim_weekly_challenges_on_spot` |
| `spot_likes` | `trg_xp_like` | AFTER INSERT | `award_xp_like` |
| `spot_likes` | `trg_xp_unlike` | AFTER DELETE | `revoke_xp_like` |
| `events` | `trg_xp_event` | AFTER INSERT | `award_xp_event` |
| `profiles` | `profiles_set_invite_code` | BEFORE INSERT | `set_invite_code_if_missing` |
| `profiles` | `trg_require_age_confirmed` | BEFORE INSERT | `require_age_confirmed` |
| `news` | `trg_news_set_expiry` | BEFORE INSERT | `news_set_expiry` |

**Aucun déclencheur ne réagit aux `UPDATE` sur `spots`.** C'est la propriété qui permet de tester la diffusion temps réel sans polluer les données.

### Les effets de bord d'un INSERT dans `spots`

```
INSERT INTO spots (…)
  │
  ├─ BEFORE  enforce_spot_daily_quota  → lit  spot_count_daily ; lève si dépassement
  ├─ BEFORE  round_spot_coords         → réécrit NEW.lat / NEW.lng à 3 décimales
  │
  ├─ AFTER   bump_spot_count           → écrit spot_count_daily (jour Paris)
  ├─ AFTER   award_xp_spot             → écrit xp_transactions (1 à 3 lignes)
  │                                    → écrit card_progress (création ou montée)
  └─ AFTER   auto_claim_weekly_…       → écrit user_weekly_challenges
```

**Quatre tables écrites pour un seul insert.** Toute manipulation directe de `spots` en production doit en tenir compte.

### Migrations — comment les appliquer

```bash
node scripts/apply-rls.mjs supabase/00XX-nom.sql
```

- Nécessite un **jeton d'accès personnel** Supabase (`SUPABASE_ACCESS_TOKEN`, préfixe `sbp_`) dans `.env.local`.
- La clé `service_role` est **rejetée** par la Management API — le DDL ne passe pas par PostgREST. Ce n'est pas contournable.
- Le script lit `.env.local` par expression régulière : le fichier n'est jamais exécuté, les secrets jamais affichés.
- **Toujours** faire un essai `BEGIN … ROLLBACK` avant d'appliquer.

---

## 6. GAMIFICATION

> XP, niveaux, cartes évolutives, défis, badges, classements — et les garde-fous anti-triche.

### La chaîne

```
SPOT → XP → LEVEL → CARD → COLLECTION → CHALLENGE → BADGE → LEADERBOARD
```

### XP par spot

Base, selon la rareté (donc selon la valeur estimée) :

| Rareté | XP de base |
|---|---|
| `hypercar` | 250 |
| `supercar` | 150 |
| `exclusif` | 90 |
| `performance` | 50 |
| `premium` | 25 |
| `standard` | 10 |

**Facteur de répétition** — appliqué selon le rang de ce spot pour la même voiture (même marque + modèle + couleur normalisée) :

| Rang | Facteur |
|---|---|
| 1ᵉʳ | × 1,00 |
| 2ᵉ – 3ᵉ | × 0,50 |
| 4ᵉ – 10ᵉ | × 0,25 |
| au-delà | dégressif |

**Bonus fixes, jamais réduits** :
- **+10** — premier spot de la journée (`daily_first`)
- **+5** — série, si au moins un spot la veille (`streak`)

Chaque gain est une **ligne** dans `xp_transactions`. Le total est une somme, jamais un compteur mutable — un gain erroné se corrige en annulant sa ligne.

### Échelle de niveaux (`src/lib/xp.ts`)

| Niveau | XP min |
|---|---|
| Rookie | 0 |
| Chasseur | 200 |
| Expert | 500 |
| Élite | 1 000 |
| Maître Spotter | 2 000 |
| Légende | 4 000 |
| Icône REVS | 8 000 |
| Fantôme | 15 000 |
| Mythique | 25 000 |
| REVS OG | 50 000 (sans plafond) |

### Cartes évolutives (`card_progress`)

Une **carte** = une entrée de collection pour un triplet **(marque, modèle, couleur de base)**. Les clés sont normalisées (`card_norm`, `color_key`) pour qu'une variation d'orthographe ou de nuance ne crée pas deux cartes.

| Niveau | Spots valides requis |
|---|---|
| 1 | 1 |
| 2 | 3 |
| 3 | 5 |
| 4 | 10 |
| 5 | 20 |

Au niveau 5, la carte reçoit un titre automatique : « Maître de la *modèle* ».

### Anti-triche — la barrière du doublon valide

Re-photographier la même voiture au même endroit ne fait pas monter la carte. Un doublon ne compte comme **valide** que si au moins une condition est remplie :

- **plus de 12 heures** depuis le dernier spot valide de cette carte, **ou**
- **plus de 500 m** de distance, **ou**
- les coordonnées précédentes sont inconnues.

Un doublon non valide gagne quand même son (petit) XP, mais **ne fait pas progresser le niveau**. C'est délibéré : on ne punit pas l'utilisateur, on neutralise seulement le farming.

Autres garde-fous déjà décrits ailleurs :
- **Quota journalier** de publication (chapitre 3) — désormais non rendu à la suppression.
- **Âge de la photo** ≤ 5 min et **dérive GPS** ≤ 300 m (chapitre 3).
- **Arrondi GPS côté base** — impossible à contourner depuis le client.

### Défis

- Tables : `challenges`, `daily_challenges`, `user_challenges`, `user_weekly_challenges`, `user_challenge_difficulty`.
- **Adaptatifs par utilisateur** : la difficulté est stockée par compte, pas globale.
- **Validation automatique** : le déclencheur `trg_auto_claim_weekly_challenges` valide au moment du spot. Il n'y a **pas** d'action manuelle de réclamation.

### Badges

- Pages : `src/pages/Badges.tsx`, `src/pages/BadgeDetail.tsx` ; catalogue : `src/lib/badges.ts`.
- Overlay de déblocage : `src/components/BadgeUnlocked.tsx`, monté une fois dans `MainLayout`.

### Classements

- `src/pages/Leaderboard.tsx`, alimenté par une vue matérialisée rafraîchie par le cron `?action=stats` (03:30 UTC).

---

## 7. SOCIAL

> Fil, likes, commentaires, abonnements, profils publics, partage.

### Les briques

| Brique | Où | Table |
|---|---|---|
| **Fil** | `src/pages/Feed.tsx` | `spots` (lecture publique) |
| **Likes** | `src/components/LikeButton.tsx` | `spot_likes` (6 politiques) |
| **Commentaires** | `src/components/CommentsSheet.tsx` | `comments` (3 politiques) |
| **Abonnements** | `src/pages/PublicProfile.tsx` | `followers` (3 politiques) |
| **Marques suivies** | `src/pages/MyBrands.tsx` | `brand_follows` (3 politiques) |
| **Profils** | `src/pages/Profile.tsx`, `PublicProfile.tsx` | `profiles` |
| **Partage** | `src/components/ShareCardSheet.tsx`, `src/lib/shareCardImage.ts` | — |
| **Open Graph** | `api/s.ts` (edge), `api/og.ts` (edge) | `spots` |

### Comment elles s'articulent

```
profiles.is_public ──► gouverne la visibilité du profil (RLS)
      │
      ├── followers ────► « qui suit qui » ; alimente le fil et les notifications
      │
      └── spots (lecture PUBLIQUE, indépendante de is_public)
              │
              ├── spot_likes ──► trg_xp_like / trg_xp_unlike : l'XP est rendue au retrait
              │
              ├── comments
              │
              └── partage ──► image canvas JPEG + lien /s/:id?ref=…
                                      │
                                      └─► api/s.ts rend la page Open Graph
                                          (aperçu riche dans Messages, WhatsApp, Discord…)
```

**Un point important** : `profiles.is_public` masque le **profil**, pas les **spots**. La politique de lecture sur `spots` est `true`, sans condition. Un compte privé publie donc quand même des spots visibles de tous. C'est cohérent avec le produit (la carte est publique), mais ce n'est pas ce que l'expression « profil privé » laisse spontanément entendre.

### Partage — comment il fonctionne réellement

1. Un visuel est composé **sur canvas** et exporté en JPEG.
2. Le flux est **téléchargement d'abord** : sur Snapchat, un partage d'image en push produisait un écran noir.
3. Le lien `/s/:id?ref=…` accompagne le texte ; `api/s.ts` (edge) sert la page Open Graph.
4. `?ref=` transporte le code de parrainage.

**Pas encore fait** : Creative Kit / Instagram Stories.

---

## 8. MAP & GPS

> Mapbox, spots publics, arrondi, expiration, temps réel et scrutin.

### La carte

- **Fichier** : `src/pages/Map.tsx` — **2 573 lignes**, le plus gros du projet.
- **Bibliothèque** : Mapbox GL 3.23.1, jeton `VITE_MAPBOX_TOKEN`.
- **Chargement paresseux** : le module Map (≈ 469 Ko gzip) est préchargé après la première fenêtre d'inactivité, depuis `App.tsx`, pour que l'onglet s'ouvre instantanément.

### La requête des spots

```js
.select(
  'id, user_id, brand, model, year, category, photo_url, ' +
  'lat, lng, rarity, created_at, expires_at',
)
.gt('expires_at', new Date().toISOString())
```

12 colonnes explicites. Un relevé exhaustif des usages (GeoJSON, filtres catégorie / marque, recherche texte, test de vie) a précédé la coupe. Deux propriétés la rendent sûre : **`Map.tsx` ne transmet aucun objet Spot à un composant enfant**, et ouvrir un spot recharge sa fiche complète.

### GPS et vie privée

| Mesure | Valeur | Où |
|---|---|---|
| Arrondi des coordonnées | **3 décimales** (≈ 110 m) | `src/lib/geo.ts`, `roundCoord()` |
| Réapplication côté base | même arrondi | déclencheur `round_spot_coords` (0069) |
| Géocodage inverse | Mapbox `types=place` | `src/lib/country.ts` |
| Coordonnées envoyées à Mapbox | **arrondies** | idem |

**Le géocodage inverse** ne sert qu'à pré-remplir la ville à l'inscription. Il est appelé depuis un seul endroit (`Auth.tsx`). L'arrondi est appliqué **dans la fonction**, pas chez l'appelant — pour qu'aucun appelant futur ne puisse réintroduire la fuite. Sans effet sur le résultat : `types=place` renvoie une ville, 110 m ne changent pas laquelle.

### Expiration

- `expires_at = created_at + 1 heure`, valeur par défaut en base.
- La carte filtre sur `expires_at > now()`.
- **Ce n'est pas une suppression** : la ligne et la photo restent.

### Temps réel et scrutin

| Canal | Rôle |
|---|---|
| **Realtime** `postgres_changes` sur `spots` | Voie instantanée |
| **Scrutin** `POLL_MS = 60 000` | Filet de sécurité |
| **Pont applicatif** `onNewSpot` | Affichage immédiat, **onglet de l'auteur uniquement** |

### ÉTAT AU COMMIT `0ba9337` → ÉTAT ACTUEL

> **ÉTAT AU COMMIT `0ba9337`**
> La publication `supabase_realtime` ne contenait **aucune table**. Le canal `postgres_changes` de `Map.tsx` ne se déclenchait donc jamais. L'auteur d'un spot le voyait instantanément grâce au pont applicatif — dans son seul onglet — pendant que tous les autres attendaient le scrutin, jusqu'à 60 s. Le symptôme se lisait comme « les spots ne sont visibles que par leur créateur », ce qui pointait faussement vers la RLS : la RLS et la requête de carte étaient toutes deux correctes.

> **ÉTAT ACTUEL**
> Migration **0073** appliquée : la publication contient `spots`. Vérifié avec un client **anonyme** (le cas le plus strict) — abonnement `SUBSCRIBED`, événement reçu en **moins de 3 secondes**. Le scrutin à 60 s est **conservé** comme filet.

---

## 9. F1 / EVENTS

> Ce qui est alimenté, ce qui est figé, et l'état réel des routes.

### Données F1

| Table | Contenu |
|---|---|
| `f1_grid`, `f1_grid_teams` | Grille de la saison |
| `f1_teams`, `f1_drivers` | Écuries et pilotes |
| `f1_results`, `f1_race_results` | Résultats |
| `f1_circuit_images` | Visuels de circuits |
| `races`, `race_rewards` | Courses et récompenses |

Catalogue de circuits côté client : `src/lib/circuits.ts`, `src/lib/f1.ts`, `src/lib/f1grid.ts`, `src/lib/f1team.ts`.

### Pages

| Route | Page |
|---|---|
| `/f1/:round` | `GrandPrixDetail.tsx` (574 lignes) |
| `/f1-roster` | `F1Roster.tsx` |
| `/f1-team/:slug` | `F1TeamDetail.tsx` |
| `/f1-driver/:slug` | `F1DriverDetail.tsx` |
| `/race` | `Race.tsx` |
| `/event/:id/live` | `EventLive.tsx` |
| `/new-event` | `NewEvent.tsx` |

### Events (rassemblements)

- Table `events` — **7 politiques RLS**, le plus fourni du schéma.
- Déclencheur `trg_xp_event` : XP à la création.
- Table `organizer_requests` — demandes de statut organisateur, soumises depuis `Settings.tsx`.

### La route `/events` — correction d'une idée reçue

> **`/events` n'est PAS une route morte.**
>
> Elle est déclarée `element={null}` dans `App.tsx`, mais c'est **la convention de toutes les routes d'onglet** : les cinq onglets principaux (`/`, `/map`, `/feed`, `/discover`, `/profile`) le sont aussi. L'interface est rendue par `TabsContainer`, monté dans `MainLayout` ; les routes n'existent que pour que le routeur accepte les URL.
>
> `pathToTab('/events')` renvoie `{ tab: 'discover', discoverInitial: 'events' }` : **`/events` ouvre l'onglet Découvrir sur sa vue Événements.** Elle fonctionne.

La route réellement sans lien depuis l'interface est **`/radar`** — conservée délibérément, joignable en tapant l'URL. Ce n'est **pas** un contrôle d'accès : une URL devinée ou partagée ouvre la page.

Également conservée : **`/card-preview`**, aperçu temporaire du redesign de carte, et **publique** (hors du bloc authentifié).

### Alimentation automatique — l'état réel

| Source | Cadence | État réel |
|---|---|---|
| `/api/f1?refresh=1` (Vercel cron) | `0 6 * * *` | **ACTIVE** — rebranché le 29/09/2026 |
| `.github/workflows/f1-sync.yml` | 06:00 UTC | **NE S'EXÉCUTE PAS** — et ce n'est plus gênant |

> **Point vérifié le 29/09/2026.**
> `.gitignore` ligne 31 ignore **tout le répertoire `.github/workflows/`**. Le fichier `f1-sync.yml` existe en local mais n'est ni suivi ni poussé, et l'API GitHub confirme : le dépôt déclare **0 workflow**. La cause est connue — le jeton `gh` de la machine porte les portées `gist`, `read:org`, `repo` mais **pas `workflow`**, donc il ne peut pas pousser de fichier de workflow. Le répertoire a été ignoré pour contourner ce blocage.
>
> Depuis le rebranchement du cron Vercel, cette voie n'est plus nécessaire : la grille F1 est de nouveau alimentée. Pour rétablir les GitHub Actions un jour, il faudra une authentification `gh` avec la portée `workflow`.

Le cron dispose de trois garde-fous qui se composent (`server/f1-calendar.js`) : portail calendrier (30 h avant à 48 h après une session), fraîcheur 7 jours, plafond de 15 appels IA par exécution. **Vérifiés le 29/09** : hors week-end de GP, le handler renvoie `{skipped:true, reason:'no_f1_session'}` sans aucun appel IA. Coût attendu : ≈ 3,4 $/mois contre ≈ 27 $/mois sans garde-fou.

**`GP_2026_CAL` — corrigé.** Ce calendrier codé en dur, injecté dans les invites, était décalé au moment de la pause : les invites demandaient des informations sur le mauvais Grand Prix. Vérifié le 29/09 contre l'API Jolpica : **23 rounds, 23 dates, correspondance exacte**. C'était la condition bloquante du rebranchement.

**Imprécision restante**, sans effet sur le coût : le round 16 est le « Bahrain Grand Prix in Malaysia », disputé **en Malaisie**. `GP_2026_CAL` et `src/lib/f1.ts` le situent tous deux à Bahreïn — c'est ce que l'accueil affiche aujourd'hui.

---

## 10. PREMIUM / STRIPE

> Le flux complet, ce qui encaisse réellement, et ce qui n'est pas encore livré.

### Le flux

```
Premium.tsx  (catalogue, src/lib/plans.ts)
     ↓
PremiumCheckout.tsx
     ↓
POST /api/create-checkout-session          ← STRIPE_SECRET_KEY
     ↓
Stripe Checkout (hébergé par Stripe)
     ↓
POST /api/webhook                          ← STRIPE_WEBHOOK_SECRET
     ↓  signature vérifiée (constructEvent), bodyParser désactivé
table subscriptions  (upsert)
     ↓
user_tier(uuid)  — fonction SQL SECURITY DEFINER
     ↓
server/ai-gate.js → quota journalier
```

### Sécurité du webhook — les deux points à ne jamais toucher

1. **`export const config = { api: { bodyParser: false } }`** — Stripe signe le corps **brut**. Si Vercel le désérialise avant, la signature ne correspond plus et **tous** les paiements sont rejetés.
2. **`stripe.webhooks.constructEvent(raw, sig, whSecret)`** — c'est la vérification elle-même. Sans elle, n'importe qui peut s'offrir VIP en envoyant un faux événement.

Événements traités : `checkout.session.completed`, `customer.subscription.created` / `.updated` / `.deleted`.

### Paliers et tarifs

| Palier | Mensuel | Annuel | Quota IA / jour |
|---|---|---|---|
| Gratuit | — | — | 5 |
| Starter *(hérité)* | — | — | 5 |
| Premium | 7,99 € | 79,99 € | 30 |
| VIP | 24,99 € | 249,99 € | 300 |

`subscriptions.plan` accepte deux formes : l'identifiant actuel (`premium_monthly`, `vip_yearly`) et un identifiant hérité de l'ancienne tarification (`starter`, `premium`, `vip`). Les deux sont reconnues **en lecture** ; seule la forme actuelle est **écrite**.

`user_tier()` ne renvoie un palier que si `status ∈ {active, trialing}`.

### Ce qui existe, ce qui a été retiré, ce qui n'est pas construit

| | |
|---|---|
| **Existe** | Catalogue, Checkout, webhook signé, table `subscriptions`, `user_tier()`, quotas IA différenciés, badges de palier, thème teinté par palier (`data-tier` sur `<html>`) |
| **Retiré** | `profiles.tier` comme source de vérité — remplacé par `user_tier()` dérivé de Stripe. `Starter` reste affiché pour ceux qui l'ont acheté, mais n'est plus vendu |
| **Pas encore construit** | Portail client Stripe (résiliation dans l'app), essai gratuit, une partie des avantages annoncés — voir chapitre 15 |

> **Aucune clé, aucun secret, aucune valeur d'environnement n'apparaît dans ce document.** Seuls les **noms** de variables sont cités (annexe K).

---

## 11. NOTIFICATIONS / CRONS / INFRASTRUCTURE

> Qui tourne, quand, et surtout : qui ne tourne plus.

### Hébergement

| Brique | Détail |
|---|---|
| **Vercel** | Front + 14 fonctions (12 Node, 2 edge). Production : `revs-ten.vercel.app`. Déploiement : `npx vercel@latest --prod --yes` |
| **Supabase** | Région **eu-west-3 (Paris)**, PostgreSQL 17 |
| **GitHub** | `burnierflorian-create/revs` — **0 workflow Actions** |
| **Capacitor** | 8.5.2, identifiant `app.revs.carspotting`, 5 plugins, SPM (pas de CocoaPods) |

### Push web

- **Service Worker** : `src/sw.ts`, stratégie **`injectManifest`**, **sans aucun precache**.
- **Pourquoi sans precache** : un SW périmé servait un `index.html` ancien pointant vers des chunks supprimés → écran blanc après déploiement. Le SW ne gère plus que le push et les clics de notification.
- **Comment il se met à jour quand même** : `__WB_MANIFEST` est lu uniquement pour en dériver une chaîne de version, ce qui fait changer les octets du SW à chaque déploiement. Combiné à `registerType: 'autoUpdate'` + `skipWaiting` + `clients.claim`, tous les clients basculent automatiquement.
- **VAPID** : `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` côté serveur, `VITE_VAPID_PUBLIC_KEY` côté client.
- **Tables** : `push_subscriptions`, `notification_prefs`.
- **Endpoint** : `api/send-push.ts`.

### État réel des tâches planifiées

| Tâche | Cadence | État |
|---|---|---|
| `/api/cron-notify` | 17:00 UTC, quotidien | **ACTIVE** — push, aucune IA |
| `/api/cron-notify?action=stats` | 03:30 UTC, quotidien | **ACTIVE** — rafraîchit la vue matérialisée du classement |
| `/api/cron-notify?action=refresh-prices` | 04:00 UTC, le 1ᵉʳ du mois | **ACTIVE** — 1 appel Haiku par spot, ≈ 0,01 $/mois |
| `/api/fetch-news` | 05:00 UTC, quotidien | **ACTIVE** — rebranchée le 29/09/2026 après optimisation |
| `/api/f1?refresh=1` | 06:00 UTC, quotidien | **ACTIVE** — ne dépense que pendant les week-ends de GP |
| `.github/workflows/f1-sync.yml` | 06:00 UTC | **LEGACY / inopérant** — voir ci-dessous |

### Pourquoi ils avaient été mis en pause, et ce qui a changé

Au 25/09/2026 : 5 comptes en base (dont ~3 de test), 29 spots, dernier spot le 12/08, 3 identifications enregistrées en deux mois. Aucune activité réelle — mais deux crons dépensaient tous les jours.

| Cron | Coût estimé | Ce qu'il produisait |
|---|---|---|
| `/api/fetch-news` | ≈ 4,80 $/mois | ≈ 700 appels Sonnet pour **7 articles publiés** en 25 jours |
| `/api/f1?refresh=1` | ≈ 27 $/mois | 30 appels Sonnet par passage, **sans contrôle de fraîcheur** |

**Économie de la pause : ≈ 32 $/mois**, plus de 99 % de la dépense IA du projet.

**Rebranchés le 29/09/2026**, après correction des gaspillages qui les avaient condamnés :

| Correction | Mesure |
|---|---|
| `makeFallback()` n'est plus appelé sur le chemin de succès | **1,00 appel Claude par article** (contre 2 à 3) |
| Filtres gratuits remontés avant l'appel IA | **52 %** des candidats écartés sans payer |
| Table `news_seen` (migration 0075) — mémoire des articles déjà jugés | deux passages consécutifs analysent **14 articles différents**, zéro ré-analyse |
| Porte « une exécution par jour parisien » au lieu de « exactement 06:00 » | une seule entrée cron au lieu de deux |

Côté F1, les trois garde-fous existaient déjà ; ce qui manquait était leur vérification. Faite : portail calendrier fermé hors week-end de GP (**zéro appel**), fraîcheur 7 jours, plafond de 15 appels par exécution. Et le calendrier codé en dur `GP_2026_CAL`, qui était décalé, **correspond désormais exactement** aux 23 rounds de l'API Jolpica.

**Coût attendu : ~5 $/mois** contre ~32 $ avant la pause. Détail complet : `docs/CRONS_PAUSE.md`.

**Reste à faire** : séparer le tri de la rédaction côté actualités — un passage Haiku pour la pertinence, Sonnet uniquement sur les retenus. Encore −50 à −70 % sur ce poste.

> **Pourquoi les entrées ne sont pas simplement commentées dans `vercel.json`** : le fichier est validé contre un schéma JSON strict (`additionalProperties: false`). Un commentaire `//` casse le parsing, une clé maison est rejetée — **les deux cassent le déploiement**. Les entrées sont donc conservées dans `docs/CRONS_PAUSE.md`, prêtes à recoller.

### ÉTAT AU COMMIT `0ba9337` → ÉTAT ACTUEL : GitHub Actions

> **ÉTAT SUPPOSÉ** (cartographie de référence et notes de projet)
> Le fil d'actualités était alimenté par une GitHub Action horaire, et la grille F1 par `f1-sync.yml` à 06:00 UTC — le plan Vercel Hobby ne permettant pas cette cadence de crons.

> **ÉTAT ACTUEL, vérifié le 29/09/2026**
> `.gitignore` ligne 31 ignore **tout `.github/workflows/`**. Aucun fichier de workflow n'est suivi par git. L'API GitHub renvoie `{"total_count": 0, "workflows": []}` pour le dépôt.
>
> **Ni le fil d'actualités ni la grille F1 ne sont alimentés automatiquement.** Les deux affichent les données figées en base. À décider : recréer les workflows sur GitHub (interface web ou dé-ignorer le répertoire), ou rebrancher les crons Vercel après les optimisations décrites dans `docs/CRONS_PAUSE.md`.

---

## 12. SÉCURITÉ & RGPD

> Uniquement ce qui est réellement implémenté. Les manques sont nommés comme des manques.

### Ce qui existe

| Protection | État | Détail |
|---|---|---|
| **Supabase Auth** | ✅ | E-mail + mot de passe, Google OAuth, récupération, déconnexion de tous les appareils |
| **RLS** | ✅ | Activée sur **les 42 tables**, 70 politiques |
| **Portail IA** | ✅ | Fail-closed : auth obligatoire, cooldown 3 s, quota atomique, plafond 10 Mo |
| **Webhook Stripe** | ✅ | Signature vérifiée, corps brut préservé |
| **Storage — écriture** | ✅ | Chemin imposé `{user_id}/…` |
| **Storage — suppression** | ✅ | Migration 0071 : chacun ne peut effacer que son propre dossier |
| **Suppression de compte** | ✅ | `api/delete-account.ts` : photos **avant** le compte, fail-closed, pagination des dossiers > 100 fichiers, chemins jamais fournis par le client |
| **Suppression d'un spot** | ✅ | `SpotDetail.tsx`, propriétaire uniquement, fichier **puis** ligne |
| **GPS** | ✅ | Arrondi 3 décimales côté client **et** côté base |
| **Mapbox** | ✅ | Coordonnées arrondies avant l'appel, `types=place` |
| **Âge minimum** | ✅ | 15 ans, déclaration booléenne, imposée par déclencheur |
| **Journal d'abus** | ✅ | `api_abuse_attempts`, IP salée, inaccessible aux clients |
| **Région des données** | ✅ | eu-west-3 (Paris) — UE |

### Ce qui n'existe pas — dit sans le adoucir

| Sujet | État réel |
|---|---|
| **Plaques** | Système de détection et de floutage existant, **mais une plaque peut être manquée par le modèle**. Aucun second filet. |
| **Visages** | **Aucune détection ni floutage systématique actuellement.** |
| **Vérification d'âge** | Déclaration sur l'honneur. **Pas** une vérification d'identité, et ne prétend pas en être une. |
| **Tests automatisés** | **Aucun.** Zéro test dans le dépôt. |
| **Portail de résiliation** | Pas d'accès au portail client Stripe depuis l'application. |

### L'âge minimum — pourquoi un booléen

15 ans est le seuil au-delà duquel un mineur peut consentir seul au traitement de ses données en France (art. 45 de la loi Informatique et Libertés).

Une date de naissance permettrait de recalculer l'âge dans le temps, mais c'est une donnée personnelle supplémentaire collectée pour un usage unique : franchir un seuil. Le principe de **minimisation** commande de ne garder que le résultat. On stocke donc `age_confirmed boolean`, rien d'autre.

Le déclencheur `require_age_confirmed` est en **BEFORE INSERT uniquement** : les comptes existants ne sont pas touchés, et leur `age_confirmed` reste à `false`. C'est volontaire — les faire mentir rétroactivement n'aurait aucune valeur.

> **6 comptes sont à `age_confirmed = false`.** Tous ont été créés **avant** l'application de la migration 0072 (le plus récent le 29/09/2026 à 11h41 UTC). Il n'y a donc aucun contournement. Leur régularisation est une décision produit distincte — par exemple une relance à la prochaine connexion, via `profiles.force_relogin` qui existe déjà.

### Données personnelles traitées

| Donnée | Où | Visibilité |
|---|---|---|
| E-mail | `auth.users` | Privée |
| Pseudo, ville, pays, avatar | `profiles` | Publique si `is_public` |
| Photos de spots | bucket `spots` | **Publiques** |
| Coordonnées GPS | `spots.lat/lng` | **Publiques**, arrondies à ≈ 110 m |
| Déclaration d'âge | `profiles.age_confirmed` | Privée |
| Abonnement | `subscriptions` | Privée (lecture propre uniquement) |
| Usage IA | `ai_usage` | Inaccessible aux clients |
| Dernière connexion | `profiles.last_seen` | Alimente le compteur « en ligne » |

### Sous-traitants

Supabase (hébergement, UE) · Vercel (hébergement) · Anthropic (identification et floutage) · Stripe (paiement) · Mapbox (cartographie et géocodage) · Google (OAuth, polices) · Jolpica/Ergast (données F1) · flux RSS tiers (actualités).

---

## 13. WORKFLOW DE DÉVELOPPEMENT

> Les douze étapes, dans l'ordre, et les deux règles qui les encadrent.

### Le workflow de référence

| # | Étape | Ce que ça veut dire concrètement |
|---|---|---|
| 1 | **Comprendre la demande** | Reformuler. Si deux lectures mènent à deux travaux différents, demander. |
| 2 | **Rechercher l'existant** | `grep` avant d'écrire. La moitié des demandes touchent un système déjà là. |
| 3 | **Identifier les dépendances** | Qui importe ce module ? Qui lit cette colonne ? |
| 4 | **Identifier les effets de bord** | Déclencheurs, RLS, caches, quotas. Un `INSERT` dans `spots` en déclenche cinq. |
| 5 | **Définir le changement minimal** | Le plus petit diff qui résout vraiment le problème. |
| 6 | **Implémenter** | Dans le style du code environnant : mêmes idiomes, même densité de commentaires. |
| 7 | **Tester** | Il n'y a pas de suite de tests. Donc : vérification ciblée, manuelle, décrite dans le rapport. |
| 8 | **Build** | `npm run build`. Comparer le nombre de problèmes ESLint à la **baseline de 158**. |
| 9 | **Vérifier les migrations** | Essai `BEGIN … ROLLBACK`, puis application, puis re-jeu pour confirmer l'idempotence. |
| 10 | **Vérifier la sécurité** | Aucun secret dans le frontend, aucun chemin de fichier venant du client, RLS intacte. |
| 11 | **Commit** | Messages en français, un commit par intention. `git add -u` + chemins explicites. |
| 12 | **Rapport final** | Ce qui a changé, ce qui a été vérifié **et comment**, ce qui reste risqué. |

### Les deux règles

> **NE PAS RECONSTRUIRE CE QUI EXISTE DÉJÀ.**
> *(« NE PAS REBUILD WHAT ALREADY EXISTS. »)*

> **NE PAS faire de refactor massif sans nécessité produit ou technique.**

### Commandes utiles

```bash
npm run dev                                  # serveur de développement
npm run build                                # tsc -b && vite build
npm run lint                                 # baseline : 158 problèmes
npm run tutorial                             # régénère le tutoriel depuis le Markdown
node scripts/apply-rls.mjs supabase/00XX.sql # applique une migration
npx vercel@latest --prod --yes               # déploiement production
```

### Conventions du dépôt

- **`git add -A` est proscrit.** Utiliser `git add -u` plus des chemins explicites.
- **Ne jamais exécuter ni afficher `.env.local`.** Extraire la seule variable nécessaire, par expression régulière.
- **Une migration appliquée ne se modifie plus.** On en ajoute une.
- **Les 158 problèmes ESLint préexistants ne sont pas à corriger** au détour d'une autre mission. Ils servent de baseline : tout écart signale une régression introduite.

---

## 14. ZONES SENSIBLES

> Huit endroits où une modification apparemment anodine casse quelque chose d'important.

### 1 · Le portail IA — `server/ai-gate.js`

- **Pourquoi c'est sensible** : c'est le seul contrôle entre un appel HTTP et une facture Anthropic.
- **Risque** : un chemin fail-open rétabli, un `catch` qui laisse passer.
- **Conséquence** : retour exact à la faille du 25/09/2026 — quota contournable en omettant l'en-tête `Authorization`, coût non plafonné.

### 2 · Les politiques RLS

- **Pourquoi** : c'est la seule barrière entre les données d'un utilisateur et celles d'un autre.
- **Risque** : une politique ajoutée « pour débloquer » qui élargit au-delà du besoin.
- **Conséquence** : fuite de données silencieuse. Rien ne casse visiblement.

### 3 · La signature du webhook Stripe

- **Pourquoi** : `bodyParser: false` et `constructEvent()` forment une paire indissociable.
- **Risque** : réactiver `bodyParser` → **tous** les paiements rejetés. Retirer `constructEvent` → n'importe qui s'offre VIP.
- **Conséquence** : perte de revenus, ou abonnements frauduleux.

### 4 · L'arrondi GPS

- **Pourquoi** : `spots` est en lecture publique. L'arrondi est ce qui empêche de remonter à un domicile.
- **Risque** : un nouvel appelant qui contourne `roundCoord()`, ou l'arrondi retiré « pour améliorer la précision de la carte ».
- **Conséquence** : géolocalisation fine exposée publiquement, sans effet visible côté produit.
- **Garde-fou** : le déclencheur `round_spot_coords` réapplique l'arrondi en base.

### 5 · Les contrôles anti-fraude EXIF

- **Pourquoi** : `MAX_PHOTO_AGE_MS` (5 min) et `MAX_GPS_DRIFT_M` (300 m) empêchent de publier de vieilles photos ou des photos prises ailleurs.
- **Risque** : les assouplir pour corriger un faux positif.
- **Conséquence** : la notion même de « spot » perd son sens, et le classement avec.

### 6 · Le quota fondé sur le compteur cumulatif

- **Pourquoi** : `enforce_spot_daily_quota` **doit** lire `spot_count_daily` et non compter les lignes vivantes.
- **Risque** : revenir à un `count(*) from spots`.
- **Conséquence** : supprimer un spot rendrait de nouveau le crédit — quota illimité pour qui supprime au fur et à mesure.
- **Corollaire** : `bump_spot_count` et `enforce_spot_daily_quota` doivent lire **le même fuseau** (Europe/Paris). Une divergence crée un trou d'une à deux heures chaque nuit.

### 7 · L'ordre Storage → base dans les suppressions

- **Pourquoi** : en supprimant la ligne d'abord, un échec sur le fichier laisse une photo que **plus rien** ne référence.
- **Risque** : inverser l'ordre « parce que c'est plus logique ».
- **Conséquence** : fichiers orphelins introuvables, donc jamais nettoyés — et une photo censée être supprimée reste accessible à son URL publique.
- **S'applique à** : `api/delete-account.ts` et `SpotDetail.tsx`.

### 8 · Le service worker `injectManifest` sans precache

- **Pourquoi** : un SW qui met en cache le JS/CSS a déjà bloqué des clients après déploiement (écran blanc, exception côté client).
- **Risque** : repasser en `generateSW`, ou ajouter un precache « pour l'offline ».
- **Conséquence** : régression connue, invisible en développement, visible en production uniquement après le déploiement suivant.

### Et aussi

- **Le plafond de 12 fonctions Node Vercel.** Le projet y est exactement. Toute nouvelle fonction doit être **edge**, ou se greffer sur une fonction existante via `?action=…`, sinon le déploiement échoue. Le plan exact n'a pas été revérifié pour cette V1 — à confirmer dans le tableau de bord avant d'y toucher.
- **`vercel.json`** est validé contre un schéma strict : ni commentaire, ni clé maison.

---

## 15. ÉTAT ACTUEL DE REVS

> Où en est le produit au 29 septembre 2026, d'après le code du dépôt.

### DONE

- Boucle Spot complète : capture → IA → floutage → GPS → stockage → publication
- Portail IA fail-closed, quotas par palier, journal d'abus
- Diffusion temps réel des spots **(corrigée le 29/09/2026)**
- Cartes évolutives (5 niveaux) et barrière anti-farm 12 h / 500 m
- XP, 10 niveaux, défis adaptatifs, badges, classement
- Social : fil, likes, commentaires, abonnements, profils publics
- Carte Mapbox avec filtres, expiration 1 h, arrondi GPS double
- Stripe : Checkout, webhook signé, paliers, quotas différenciés
- Suppression de compte conforme (photos comprises) et suppression de spot
- Âge minimum 15 ans imposé par déclencheur
- i18n FR/EN — 1 013 clés × 2
- PWA + Capacitor 8.5.2 (iOS / Android)
- Identité de marque, animation d'intro, refonte de l'accueil
- Thème clair/sombre par triplets de canaux RVB

### IN PROGRESS

- **Ce tutoriel** — V1, à parcourir et affiner ensemble
- Visuels de cartes évolutives (phases 2 et 3 : le moteur est livré, pas les visuels)
- Showroom / garage immersif — images de voiture évolutives

### BEFORE BETA

| Sujet | Pourquoi c'est bloquant |
|---|---|
| ⚠️ **Crédits Anthropic** | La clé de production est à court de crédits. `identify-car` est hors service — le quota et le cooldown fonctionnent, mais l'appel échoue. **Sans cela, la boucle principale ne fonctionne pas.** |
| ⚠️ **Stripe est en LIVE** | La production encaisse pour de vrai, alors que payer ne débloque ni le quota IA annoncé ni une partie des avantages listés. |
| ~~Alimentation automatique~~ | **Réglé le 29/09/2026** — les deux crons IA sont rebranchés après optimisation (chapitre 11). |
| ~~`GP_2026_CAL` faux~~ | **Réglé** — vérifié contre Jolpica, 23 rounds exacts. |
| **Régularisation `age_confirmed`** | 6 comptes à `false`, décision produit à prendre. |
| **Politique de confidentialité** | À publier, désormais adossée à un état des lieux vérifié. |

### BEFORE PUBLIC LAUNCH

- Protection des visages (aucune aujourd'hui)
- Second filet sur les plaques manquées
- Quelques tests automatisés sur les chemins critiques (quota, RLS, webhook)
- Portail client Stripe (résiliation dans l'app)
- Tri Haiku avant Sonnet sur le collecteur d'actualités (−50 à −70 % de plus sur ce poste)
- Traitement des 158 problèmes ESLint

### BACKLOG

- **Spot Wars** — retiré de l'interface le 31/05/2026 ; composant et SQL toujours en place, prêts à remonter
- **Radar** — route vivante, aucun lien dans l'interface, en attente d'une densité d'utilisateurs suffisante
- Creative Kit / Instagram Stories pour le partage
- Vrai système de rôles, qui remplacerait le contrôle par e-mail unique de ce tutoriel

### Décisions produit déjà prises

| Décision | Date |
|---|---|
| Rareté dérivée du prix, jamais devinée par l'IA | — |
| Âge minimum 15 ans, sans date de naissance | 29/09/2026 |
| Expiration carte à 1 h (affichage seulement, pas de suppression) | — |
| GPS arrondi à 3 décimales, client **et** base | — |
| Quota gratuit aligné à 5 (IA et publication) | 26/09/2026 |
| Premium ramené de 100 à 30 appels IA | 26/09/2026 |
| Crons IA en pause jusqu'à optimisation | 25/09/2026 |
| Crons IA rebranchés après correction de trois gaspillages | 29/09/2026 |
| Service worker sans precache, définitivement | — |
| Supprimer un spot ne rend pas le crédit | 29/09/2026 |

---

## 16. AJOUTER UNE NOUVELLE FONCTIONNALITÉ

> Une méthode réutilisable, appliquée à cinq exemples. Aucun de ces exemples n'est implémenté.

### La méthode

Avant d'écrire la moindre ligne, répondre à ces questions **dans l'ordre** :

1. **Qu'est-ce qui existe déjà et ressemble à ça ?**
2. **Quel stockage est déjà en place ?**
3. **Quel affichage peut accueillir ça ?**
4. **Quelles interactions sociales existent déjà ?**
5. **Quel modèle de données s'en approche ?**
6. **Quelles protections s'appliquent automatiquement ?** (RLS, portail IA, quotas)
7. **Quels effets de bord vais-je déclencher ?**
8. **Qu'est-ce qui manque réellement ?**
9. **Quel est le plus petit ajout qui livre la valeur ?**
10. **Qu'est-ce que je ne construis pas maintenant ?**

Le livrable de cette réflexion est une **liste de ce qui existe** et une **liste de ce qui manque**. On ne code que la seconde.

### Exemple détaillé — « Je veux ajouter REVS Shorts »

| # | Question | Réponse pour REVS |
|---|---|---|
| 1 | Vidéos existantes ? | **Non.** Tout le pipeline média est image (`resizeImageToJpeg`, canvas, JPEG). |
| 2 | Stockage ? | **Oui** — Supabase Storage, 3 buckets, politiques par préfixe `{user_id}/`. Un bucket `shorts` reprend le même modèle. |
| 3 | Fil ? | **Oui** — `Feed.tsx`, déjà une liste sociale paginée. |
| 4 | Likes ? | **Oui** — `spot_likes` + `LikeButton` + déclencheurs XP. Mais la table est liée à `spot_id`. |
| 5 | Commentaires ? | **Oui** — `comments` + `CommentsSheet`. Même remarque. |
| 6 | Profils ? | **Oui** — `profiles`, `PublicProfile.tsx`, abonnements. Rien à créer. |
| 7 | Partage ? | **Oui** — `ShareCardSheet` + `api/s.ts` (Open Graph). À étendre, pas à refaire. |
| 8 | Notifications ? | **Oui** — Web Push, `notification_prefs`, `api/send-push.ts`. |
| 9 | **Ce qui existe déjà** | Stockage, fil, likes, commentaires, profils, partage, notifications, RLS par préfixe |
| 10 | **Ce qui manque vraiment** | Capture/compression vidéo, table `shorts`, généralisation de `spot_likes`/`comments` à un objet polymorphe, lecteur vidéo, plafond de taille et de durée |

**Verdict** : environ 30 % de travail neuf. Le piège serait de recréer un système de likes et de commentaires parce que les tables existantes portent `spot_id` — la bonne question est « polymorphiser ou dupliquer ? », pas « comment construire des likes ? ».

**Point de vigilance** : la vidéo échappe entièrement aux protections d'image existantes. Ni le floutage de plaque ni le contrôle EXIF ne s'y appliquent.

### Les quatre autres exemples

#### Radar

- **Existe déjà** : la page (`Radar.tsx`), la route `/radar`, la table `radar_prefs`, les réglages (rayon 5/10/20 km, position), le push, le GPS durci.
- **Manque** : uniquement la **densité d'utilisateurs**. C'est pour cela que la fonctionnalité a été retirée de l'interface, pas parce qu'elle était incomplète.
- **Verdict** : ~5 % de travail. La remonter = rétablir les liens d'interface.

#### Communities

- **Existe déjà** : `followers`, `brand_follows`, `events` (7 politiques), `organizer_requests`, les profils publics, le push.
- **Manque** : une table `communities` + appartenances, un fil filtré par communauté, la modération.
- **Piège** : `brand_follows` est déjà une communauté implicite « les gens qui suivent Porsche ». Vérifier si une communauté explicite est vraiment nécessaire, ou si un filtre sur l'existant suffit.

#### Creator profiles

- **Existe déjà** : `profiles` avec pseudo/avatar/ville/liens sociaux, `PublicProfile.tsx`, `followers`, paliers d'abonnement, badges, `TitleChip`.
- **Manque** : un statut « créateur » (une colonne, pas une table), des statistiques d'audience, peut-être un partage de revenus.
- **Piège** : `organizer_requests` est **déjà** un flux de demande de statut. Le réutiliser plutôt que d'en créer un second.

#### Mini-game

- **Existe déjà** : `Games.tsx`, `spotting_predictions`, `races` / `race_rewards`, le moteur XP (`xp_transactions`), les défis, le classement.
- **Manque** : les règles du jeu lui-même.
- **Piège** : ne **pas** créer un second compteur de points. L'XP passe par `xp_transactions` et par là uniquement — sinon deux totaux coexistent et divergent.

---

## 17. ANNEXES TECHNIQUES

> Inventaires détaillés. À déplier au besoin.

### A. Pages — 36

`Auth` · `BadgeDetail` · `Badges` · `BrandDetail` · `Brands` · `CardPreview` · `Challenges` · `Discover` · `EventLive` · `F1DriverDetail` · `F1Roster` · `F1TeamDetail` · `Feed` · `Games` · `GrandPrixDetail` · `Home` · `Leaderboard` · `LegalMentions` · `LegalPrivacy` · `LegalTerms` · `Map` · `MyBrands` · `MyGallery` · `NewEvent` · `News` · `NewSpot` · `Premium` · `PremiumCheckout` · `Profile` · `PublicProfile` · `Race` · `Radar` · `Referral` · `ResetPassword` · `Settings` · `SpotDetail` · `Tutorial`

Les cinq pages d'onglet (`Home`, `Map`, `Feed`, `Discover`, `Profile`) sont montées en permanence par `TabsContainer`. Toutes les autres sont des routes « pile » chargées paresseusement.

### B. Composants — 43

`AvatarCropModal` · `BadgeUnlocked` · `BrandLogo` · `CardSpotsSheet` · `CarSilhouettes` · `CollectionsSection` · `CollectorCard` · `CollectorCardV2` · `CommentsSheet` · `Confetti` · `EmptyState` · `ErrorBoundary` · `F1Calendar` · `F1Visual` · `FeedFiltersModal` · `FilterSections` · `GarageCard` · `GarageIllustration` · `GlobalStats` · `InstallBanner` · `LegalLayout` · `LevelUpOverlay` · `LikeButton` · `LiquidXpBar` · `Logo` · `MapFiltersModal` · `Meets` · `MyCollection` · `Onboarding` · `PullIndicator` · `RarityBadge` · `SearchOverlay` · `ShareCardSheet` · `Showroom` · `Skeleton` · `SplashScreen` · `SpotCelebration` · `SpotWars` · `StreakBreak` · `TitleChip` · `UpdateNotification` · `WelcomeCelebration` · `XpFloater`

Montés une seule fois dans `MainLayout` (overlays globaux) : `XpFloater`, `SpotCelebration`, `StreakBreak`, `LevelUpOverlay`, `BadgeUnlocked`, `ShareCardSheet`, `UpdateNotification`, `InstallBanner`.

### C. Modules `lib/` — 48

| Module | Rôle |
|---|---|
| `badges` | Catalogue des badges |
| `brand-paths`, `brands` | Logos et référentiel de marques |
| `car-body-type`, `cars` | Typologie de carrosserie |
| `cardLevels`, `cardSpecs` | Cartes évolutives, seuils, fiches |
| `categoryStyle`, `spotCategory` | Catégories de spots |
| `challenges` | Défis |
| `circuits`, `f1`, `f1grid`, `f1team`, `race` | F1 |
| `collections`, `colorKey` | Collections, normalisation de couleur |
| `constants` | `APP_VERSION`, `APP_STAGE` |
| `country` | Géocodage inverse Mapbox |
| `customIcons`, `rarityStyle`, `titles` | Habillage |
| `errors` | Messages d'erreur |
| `events`, `liveEvents` | Événements |
| `feedSync` | Synchronisation du fil |
| `filterCatalog`, `search` | Filtres et recherche |
| `founders`, `referrals` | Parrainage |
| `garage` | Garage / showroom |
| `geo` | GPS durci, `roundCoord`, distances |
| `haptic` | Retour haptique |
| `motion` | `prefers-reduced-motion` |
| `passions` | Centres d'intérêt (onboarding) |
| `pendingPhoto` | Photo en attente entre écrans |
| `plans`, `tier` | Paliers d'abonnement |
| `push` | Web Push côté client |
| `radar` | Radar de proximité |
| `rarity` | Barème de rareté |
| `shareCardImage` | Composition canvas du visuel de partage |
| `spotPredictions` | Prédictions |
| `spots` | Types, redimensionnement, floutage, XP, EXIF |
| `supabase` | Client Supabase unique |
| `theme` | Thème clair/sombre |
| `weather` | Météo |
| `xp` | Échelle de niveaux |
| `tutorial` | Accès et chargement de ce tutoriel |

### D. Endpoints `api/`

| Endpoint | Runtime | Rôle |
|---|---|---|
| `brand-description.ts` | Node | Texte de présentation d'une marque |
| `car-info.ts` | Node | Fiche détaillée d'un modèle |
| `create-checkout-session.ts` | Node | Ouverture d'un Checkout Stripe |
| `cron-notify.ts` | Node | Push quotidien, stats, rafraîchissement des prix |
| `delete-account.ts` | Node | Suppression de compte (photos comprises) |
| `detect-plate.ts` | Node | Détection des plaques |
| `f1.ts` | Node | Synchronisation F1 |
| `fetch-news.ts` | Node | Collecte RSS + résumé |
| `identify-car.js` | Node | Identification du véhicule |
| `image-proxy.ts` | Node | Relais d'images distantes |
| `send-push.ts` | Node | Envoi Web Push |
| `webhook.ts` | Node | Webhook Stripe |
| `og.ts` | **edge** | Image Open Graph |
| `s.ts` | **edge** | Page de partage `/s/:id` |
| `tutorial.ts` | **edge** | Ce tutoriel (accès restreint) |

**12 fonctions Node** — exactement la contrainte documentée dans le dépôt (plafond du plan Hobby). Toute nouvelle fonction doit être **edge**, ou se greffer sur une fonction existante via un paramètre `?action=…`, comme le fait déjà `cron-notify.ts`.

### E. Tables — 42

Toutes avec RLS **activée**. Le nombre entre parenthèses est le nombre de politiques.

**Utilisateur** — `profiles` (3) · `xp_transactions` (1) · `card_progress` (1) · `collection_progress` (1) · `spot_count_daily` (1) · `subscriptions` (1) · `referrals` (1) · `notification_prefs` (3) · `push_subscriptions` (3) · `radar_prefs` (3) · `followers` (3) · `brand_follows` (3)

**Contenu** — `spots` (4) · `spot_likes` (6) · `comments` (3) · `events` (7) · `organizer_requests` (2) · `news` (2) · `news_meta` (1)

**Gamification** — `challenges` (1) · `daily_challenges` (1) · `user_challenges` (1) · `user_weekly_challenges` (1) · `user_challenge_difficulty` (1) · `spotting_predictions` (2) · `races` (1) · `race_rewards` (1)

**Référentiel automobile** — `car_catalog` (1) · `car_specs` (1) · `car_renders` (1) · `car_info_cache` (1) · `brand_descriptions` (1)

**F1** — `f1_grid` (1) · `f1_grid_teams` (1) · `f1_teams` (1) · `f1_drivers` (1) · `f1_results` (1) · `f1_race_results` (1) · `f1_circuit_images` (1)

**Infrastructure** — `ai_usage` (**0**) · `api_abuse_attempts` (**0**) · `news_seen` (**0**) — RLS activée sans politique : accessibles uniquement à `service_role`.

### F. Fonctions SQL — 66

Les principales :

| Fonction | Rôle |
|---|---|
| `award_xp_spot()` | XP + progression de carte à chaque spot |
| `award_xp_like()` / `revoke_xp_like()` | XP de like, rendue au retrait |
| `award_xp_event()` | XP à la création d'un événement |
| `enforce_spot_daily_quota()` | Plafond journalier (lit `spot_count_daily`) |
| `bump_spot_count()` | Incrémente le compteur cumulatif (jour Paris) |
| `round_spot_coords()` | Arrondi GPS côté base |
| `require_age_confirmed()` | Refuse un profil sans déclaration d'âge |
| `set_invite_code_if_missing()` | Code de parrainage à la création |
| `news_set_expiry()` | Expiration des actualités |
| `auto_claim_weekly_challenges_on_spot()` | Validation automatique des défis |
| `user_tier(uuid)` | Palier dérivé de l'abonnement Stripe |
| `ai_gate_consume()` | Consommation atomique de quota IA |
| `log_api_abuse()` | Journal d'abus |
| `card_norm()` / `color_key()` | Normalisation des clés de carte |
| `card_level_for()` / `card_spot_xp_factor()` | Seuils et facteur dégressif |
| `card_distance_m()` | Distance pour la barrière anti-farm |
| `bump_last_seen()` | Battement de présence |

### G. Déclencheurs — 11

Voir le tableau complet au chapitre 5. Résumé : **5 sur `spots`**, 2 sur `spot_likes`, 2 sur `profiles`, 1 sur `events`, 1 sur `news`.

### H. Politiques RLS — 70

Répartition notable : `events` 7 · `spot_likes` 6 · `spots` 4 · `profiles` 3 · `comments` 3 · `followers` 3 · `brand_follows` 3 · `notification_prefs` 3 · `push_subscriptions` 3 · `radar_prefs` 3. Les autres tables en ont 1 ou 2, sauf `ai_usage` et `api_abuse_attempts` à **0**.

Politiques détaillées au chapitre 5.

### I. Migrations — 75 numérotées

Les plus structurantes :

| Migration | Objet |
|---|---|
| `0015` | `user_tier()` |
| `0058` | Catalogue automobile |
| `0059` | Parrainage |
| `0060` | Onboarding / centres d'intérêt |
| `0061`–`0063` | Grille, classements et résultats F1 |
| `0064` | Quota d'usage IA |
| `0065`–`0066` | Cartes évolutives |
| `0067` | Portail IA (`ai_gate_consume`, `api_abuse_attempts`) |
| `0068` | Déclencheur de quota de spots |
| `0069` | Arrondi GPS en base |
| `0070` | Cache d'informations véhicule |
| `0071` | Suppression de ses propres fichiers (storage) |
| `0072` | `age_confirmed` + déclencheur |
| `0073` | Publication Realtime de `spots` |
| `0074` | Quota non rendu à la suppression + fuseau Paris |
| `0075` | `news_seen` — mémoire des articles déjà analysés |

Plus `schema.sql`, `seed-phase1.sql`, `fix-spots-rls.sql`.

### J. Scripts

| Script | Rôle |
|---|---|
| `apply-rls.mjs` | **Applique une migration** — l'outil principal |
| `build-tutorial.mjs` | Markdown → module servi par `api/tutorial.ts` |
| `build-brand.mjs`, `extract-brand-png.mjs`, `build-hero.mjs` | Identité visuelle |
| `blur-existing-plates.mjs` | Floutage rétroactif des plaques |
| `sync-f1-grid.mjs` | Grille F1 depuis Jolpica |
| `backfill-*.mjs` | Rattrapages (rareté, prix, circuits, garage) |
| `reprocess-*.mjs`, `fix-*.mjs` | Retraitement de spots |
| `audit-cars.mjs`, `check-news.mjs`, `diag-auth.mjs` | Diagnostics |
| `backup-cards.mjs`, `migration-log-cards.mjs` | Sauvegardes |
| `setup-stripe-prices.mjs` | Création des prix Stripe |
| `enable-google.mjs`, `fix-auth-urls.mjs` | Configuration Auth |
| `upload-car-renders.mjs`, `detour-car-renders.mjs`, `generate-image.mjs` | Bibliothèque d'images |

### K. Variables d'environnement — NOMS UNIQUEMENT

> Aucune valeur ne figure dans ce document. Les valeurs vivent dans `.env.local` (jamais commité) et dans la configuration Vercel.

**Serveur** — `SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY` · `SUPABASE_ACCESS_TOKEN` · `SUPABASE_DB_TOKEN` · `ANTHROPIC_API_KEY` · `GEMINI_API_KEY` · `GOOGLE_API_KEY` · `GOOGLE_OAUTH_CLIENT_ID` · `GOOGLE_OAUTH_SECRET` · `STRIPE_SECRET_KEY` · `STRIPE_WEBHOOK_SECRET` · `VAPID_PUBLIC_KEY` · `VAPID_PRIVATE_KEY` · `CRON_SECRET` · `ABUSE_IP_SALT` · `CARIMAGES_API_KEY` · `CARIMAGES_API_SECRET` · `REVS_TUTORIAL_EMAIL` · `REVS_REF` · `HERO_SRC` · `EVENT_SRC`

**Client (préfixe `VITE_`, donc publiques par construction)** — `VITE_SUPABASE_URL` · `VITE_SUPABASE_ANON_KEY` · `VITE_MAPBOX_TOKEN` · `VITE_VAPID_PUBLIC_KEY`

> **Règle** : toute variable préfixée `VITE_` finit dans le bundle navigateur. Ne jamais y placer un secret. La clé `anon` et la clé publique VAPID sont publiques par conception ; la protection vient de la RLS, pas du secret.

### L. Routes

**Publiques** (hors session) — `/auth` · `/reset-password` · `/card-preview` *(aperçu temporaire)*

**Onglets** (rendus par `TabsContainer`, `element={null}` par convention) — `/` · `/map` · `/feed` · `/discover` · `/actu` · `/events` · `/profile`

**Pile** (chargement paresseux, par-dessus les onglets) — `/spot/:id` · `/new-spot` · `/f1/:round` · `/new-event` · `/classement` · `/challenges` · `/badges` · `/badges/:slug` · `/referral` · `/radar` · `/games` · `/race` · `/event/:id/live` · `/mes-marques` · `/brands` · `/brand/:slug` · `/f1-roster` · `/f1-team/:slug` · `/f1-driver/:slug` · `/ma-galerie` · `/u/:id` · `/settings` · `/legal/mentions` · `/legal/privacy` · `/legal/terms` · `/premium` · `/premium/checkout/:tier` · **`/tutorial`** *(accès restreint)*

**Réécriture serveur** — `/s/:id` → `/api/s?id=:id`

**Attrape-tout** — `*` → redirection vers `/`

### M. Tâches planifiées

| Tâche | Cadence | État |
|---|---|---|
| `/api/cron-notify` | `0 17 * * *` | **ACTIVE** |
| `/api/cron-notify?action=stats` | `30 3 * * *` | **ACTIVE** |
| `/api/cron-notify?action=refresh-prices` | `0 4 1 * *` | **ACTIVE** |
| `/api/fetch-news` | `0 5 * * *` | **ACTIVE** (rebranchée 29/09/2026) |
| `/api/f1?refresh=1` | `0 6 * * *` | **ACTIVE** (rebranchée 29/09/2026) |
| `.github/workflows/f1-sync.yml` | `0 6 * * *` | **LEGACY** — ignoré par git, absent de GitHub, **ne s'exécute pas** |

### N. i18n

- **1 013 clés × 2 langues** (fr, en) — `src/locales/fr.json`, `src/locales/en.json`. Comptage vérifié : parité exacte.
- **Bibliothèque** : `react-i18next` 17 / `i18next` 26.
- **Source de vérité de la langue** : `localStorage['revs_lang']`, répliqué dans `profiles.language`.
- **Câblé** : onboarding, navigation, authentification, réglages. **Pas** l'ensemble de l'application.
- **Ce tutoriel n'est pas traduit** — c'est un outil interne, en français, assumé comme tel.

### O. Zones sensibles — rappel

1. `server/ai-gate.js` — le portail IA
2. Les politiques RLS
3. La signature du webhook Stripe (`bodyParser: false` + `constructEvent`)
4. L'arrondi GPS (client **et** base)
5. Les contrôles anti-fraude EXIF (5 min / 300 m)
6. Le quota fondé sur `spot_count_daily`, fuseau Paris
7. L'ordre Storage → base dans les suppressions
8. Le service worker `injectManifest` sans precache

**Plus deux contraintes de plateforme** : le plafond de 12 fonctions Node Vercel (atteint), et le schéma strict de `vercel.json`.

Détail et conséquences au chapitre 14.

---

## 18. CHANGELOG

> Historique des versions de ce document.

### Version 1.1 — 29 septembre 2026

Rebranchement des crons IA.

- Chapitres 9, 11 et 15, annexe M : les crons `fetch-news` et `f1?refresh=1` passent de **EN PAUSE** à **ACTIVE**, après correction de trois gaspillages mesurés (1,00 appel Claude par article contre 2 à 3 ; 52 % des candidats écartés avant l'IA ; mémoire `news_seen` contre la ré-analyse).
- `GP_2026_CAL` n'est plus signalé comme faux : vérifié contre l'API Jolpica, 23 rounds et 23 dates exacts.
- La cause de l'absence de GitHub Actions est identifiée : le jeton `gh` n'a pas la portée `workflow`.
- Comptes : 41 → **42 tables** (`news_seen`), 74 → **75 migrations**.

### Version 1.0 — 29 septembre 2026

Première version.

- 18 chapitres, 15 annexes.
- Architecture de référence : commit `0ba9337` (29/09/2026).
- État du dépôt à la vérification : `b500675`.
- Tous les chiffres relevés dans le dépôt et la base réels, jamais recopiés d'un document antérieur.

**Écarts relevés entre le commit de référence et l'état actuel** — sept, tous documentés dans les chapitres concernés :

1. Publication Realtime de `spots` — corrigée (migration 0073)
2. Quota rendu à la suppression — corrigé (migration 0074)
3. Fuseau du compteur de quota aligné sur Europe/Paris (migration 0074)
4. Requête carte : `select('*')` → 12 colonnes explicites
5. Coordonnées arrondies avant l'appel Mapbox
6. 3 fichiers orphelins supprimés + rollback à l'échec d'insertion
7. Migrations numérotées : 72 → 75

**Découvertes faites pendant la rédaction, non présentes dans la cartographie de référence** :

- **`.github/workflows/` est ignoré par git** et le dépôt GitHub déclare **0 workflow**. Ni le fil d'actualités ni la grille F1 ne sont alimentés automatiquement.
- **La route `/events` n'est pas morte** : elle ouvre l'onglet Découvrir sur sa vue Événements. C'est `/radar` qui est sans lien d'interface.
- **Le plafond de 12 fonctions Node Vercel est atteint**, ce qui contraint toute nouvelle fonction à être en edge.
- Les seuils de cartes évolutives sont **1 / 3 / 5 / 10 / 20**.
