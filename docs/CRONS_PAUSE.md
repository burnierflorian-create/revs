# Crons IA en pause — 25/09/2026

**État : les deux crons IA coûteux sont débranchés. Le contenu déjà en base reste servi
normalement à l'application.** Rien n'a été supprimé côté endpoints ; seules les entrées
`crons` de `vercel.json` ont été retirées, et elles sont reproduites telles quelles plus bas.

```
PAUSE 25/09/2026 — rebrancher en version optimisée avant beta
News : ajouter tri Haiku avant Sonnet (voir diagnostic §05)
F1   : ajouter contrôle de fraîcheur generated_at dans refreshEntity()
```

---

## Pourquoi

Au 25/09/2026 : 5 comptes en base (dont ~3 de test), 29 spots, dernier spot le 12/08,
3 appels d'identification enregistrés dans `ai_usage` en deux mois. Autrement dit, aucune
activité réelle — mais deux crons continuaient à dépenser tous les jours.

| Cron | Cadence | Coût estimé | Ce qu'il produisait |
|---|---|---|---|
| `/api/fetch-news` (×2 entrées) | quotidien, 06:00 Paris | **~4,80 $/mois** | ~700 appels Sonnet pour **7 articles publiés** en 25 jours, soit ≈100 appels par article |
| `/api/f1?refresh=1` | tous les 2 jours | **~27 $/mois** | 30 appels Sonnet + `web_search` par passage, **sans aucun contrôle de fraîcheur** |

**Économie : ~32 $/mois**, soit plus de 99 % de la dépense IA du projet — la reconnaissance
photo, elle, coûte ~0,01 $ par capture et ne pesait quasiment rien.

Le cron F1 n'écrivait plus rien depuis le 01/09/2026 (probable dépassement de durée de
fonction), donc sa mise en pause ne dégrade rien qui fonctionnait encore.

### Ce qui reste actif et ne change pas

- `/api/cron-notify` (17:00 UTC) — notifications push, **aucune IA**
- `/api/cron-notify?action=stats` (03:30 UTC) — rafraîchissement de vue matérialisée, **aucune IA**
- `/api/cron-notify?action=refresh-prices` (1ᵉʳ du mois) — 1 appel Haiku par spot, **~0,01 $/mois**, négligeable
- `.github/workflows/f1-sync.yml` (06:00 UTC) — grille F1 depuis l'API Ergast/Jolpica, **aucune IA, gratuit**

### Ce que les utilisateurs continuent de voir

Rien ne disparaît de l'app. Les 50 articles d'actualité et la grille F1 2026 déjà en base
restent lus normalement par `News.tsx`, `F1Roster`, `F1TeamDetail` et `F1DriverDetail`.
Seule la fraîcheur se fige : le fil d'actualité n'acquiert plus de nouvel article, et les
fiches écuries/pilotes gardent leurs chiffres du 01/09/2026.

`news_meta.last_fetched_at` se fige également — le libellé « Mis à jour il y a X » de
l'écran Actu va donc vieillir visiblement. À surveiller si tu ouvres l'app à des testeurs
avant le rebranchement.

---

## Comment rebrancher

> **Pourquoi les lignes ne sont pas simplement commentées dans `vercel.json`**
> Le fichier est du JSON strict, validé contre `https://openapi.vercel.sh/vercel.json`.
> Ce schéma déclare `additionalProperties: false` et n'autorise que 43 propriétés
> nommées. Un commentaire `//` fait échouer le parsing, et une clé maison du type
> `"_pausedCrons"` est rejetée à la validation — **les deux cassent le déploiement**.
> Les entrées sont donc conservées ici, prêtes à recoller.
>
> Alternative si tu veux vraiment des commentaires dans la config : Vercel supporte
> `vercel.toml` (mêmes propriétés, commentaires natifs `#`). Un seul fichier de config
> par projet, donc cela implique de convertir aussi le bloc `rewrites` — dont la règle
> SPA `/(.*)` → `/index.html` est critique. Non fait volontairement.

Recoller ces trois objets dans le tableau `crons` de `vercel.json`, puis déployer :

```json
{ "path": "/api/fetch-news?tz=cest", "schedule": "0 4 * * *" },
{ "path": "/api/fetch-news?tz=cet",  "schedule": "0 5 * * *" },
{ "path": "/api/f1?refresh=1",       "schedule": "0 4 */2 * *" }
```

Le tableau complet redevient alors :

```json
"crons": [
  { "path": "/api/fetch-news?tz=cest", "schedule": "0 4 * * *" },
  { "path": "/api/fetch-news?tz=cet", "schedule": "0 5 * * *" },
  { "path": "/api/cron-notify", "schedule": "0 17 * * *" },
  { "path": "/api/cron-notify?action=stats", "schedule": "30 3 * * *" },
  { "path": "/api/cron-notify?action=refresh-prices", "schedule": "0 4 1 * *" },
  { "path": "/api/f1?refresh=1", "schedule": "0 4 */2 * *" }
]
```

Les deux entrées `fetch-news` sont normales et ne font pas double emploi : Vercel ne
planifie qu'en UTC, donc le handler tire à 04:00 et 05:00 UTC et ne travaille que sur le
tir qui tombe à 06:00 heure de Paris (04:00 UTC en été, 05:00 en hiver). L'autre no-ope.

Penser aussi à retirer les blocs `PAUSE 25/09/2026` en tête de `api/fetch-news.ts` et
`api/f1.ts`.

---

## Optimisations à faire AVANT de rebrancher

### 1. News — tri Haiku avant Sonnet

**État : à faire.** Référence : diagnostic §05.

Aujourd'hui, un seul appel Sonnet fait à la fois le tri de pertinence, la catégorisation,
la traduction du titre et la rédaction du résumé — on paie donc le tarif rédaction pour
trier des articles qu'on va jeter. Trois changements, par ordre de rentabilité :

1. **Corriger `makeFallback()`** (`api/fetch-news.ts`, chemin de succès de `summarize()`).
   Il est appelé inconditionnellement alors que son résultat ne sert que si `summary` est
   vide. Comme il teste le titre et la description **d'origine** — en anglais dans 20 flux
   sur 24 — il déclenche une traduction Sonnet quasi systématique et jetée aussitôt.
   Ne le calculer que si `summary` est réellement vide. *≈50 % du coût actualités, une ligne.*

2. **Mémoriser les articles rejetés.** L'ensemble `known` est construit à partir de la table
   `news`, elle-même écrêtée à 50 lignes ; un article analysé puis rejeté n'est enregistré
   nulle part et peut repasser par Claude plusieurs jours de suite (fenêtre de candidature
   de 7 jours). Ajouter une table `news_seen(url, seen_at, verdict)` avec purge à 30 jours.
   *40 à 60 % du coût restant.*

3. **Remonter les filtres gratuits avant l'appel IA.** « Pas d'image RSS » et « titre
   commercial » sont des tests locaux instantanés qui s'exécutent actuellement *après*
   `summarize()`. Tout article sans image paie un appel Sonnet complet avant d'être jeté.
   *Déplacement de code, sans risque.*

Puis séparer tri et rédaction : un passage **Haiku** à sortie structurée (booléen de
pertinence + catégorie, ~50 jetons de sortie) sur les candidats, et **Sonnet** uniquement
sur les articles retenus. Cible : ~0,032 $ par exécution contre ~0,16 $ aujourd'hui,
soit **−80 %**.

### 2. F1 — contrôle de fraîcheur dans `refreshEntity()`

**État : DÉJÀ FAIT** — présent dans l'arbre de travail au 25/09/2026, à committer.

`refreshEntity()` (`api/f1.ts`) lit désormais `generated_at` en plus de `data`, et retourne
`skipped:fresh` sans appeler Claude pour toute entité déjà peuplée et rafraîchie depuis
moins de `TTL_MS` (7 jours). Un `generated_at` absent ou illisible est traité comme périmé,
pour ne jamais bloquer une ligne réellement obsolète.

Il reste donc **un point ouvert avant rebranchement** : comprendre pourquoi le cron n'écrit
plus rien depuis le 01/09/2026. Les dates d'écriture montrent un dépérissement progressif
(4 entités le 29/08, 3 le 31/08, 23 le 01/09, puis plus rien) — profil typique d'une
fonction qui expire de plus en plus tôt, pas d'un cron désactivé. `api/f1.ts` déclare
`maxDuration: 300`, mais 30 appels Claude + `web_search` par lots de 4 peuvent dépasser ce
budget. **Les logs Vercel trancheront.** Avec le contrôle de fraîcheur, le premier passage
après rebranchement restera de toute façon le plus long — envisager de traiter les entités
par tranches (`?slice=1of2`, déjà supporté par le handler).

---

## Traçabilité

- Diagnostic complet ayant motivé la pause : audit REVS du 25/09/2026, §03 à §05 et §15.
- Fichiers touchés par la pause : `vercel.json`, `api/fetch-news.ts` (commentaire seul),
  `api/f1.ts` (commentaire + contrôle de fraîcheur).
- Aucun contenu supprimé en base.
