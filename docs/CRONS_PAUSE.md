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

Recoller ces deux objets dans le tableau `crons` de `vercel.json`, puis déployer :

```json
{ "path": "/api/fetch-news", "schedule": "0 7 * * *" },
{ "path": "/api/f1?refresh=1", "schedule": "0 6 * * *" }
```

Le tableau complet redevient alors :

```json
"crons": [
  { "path": "/api/fetch-news", "schedule": "0 7 * * *" },
  { "path": "/api/f1?refresh=1", "schedule": "0 6 * * *" },
  { "path": "/api/cron-notify", "schedule": "0 17 * * *" },
  { "path": "/api/cron-notify?action=stats", "schedule": "30 3 * * *" },
  { "path": "/api/cron-notify?action=refresh-prices", "schedule": "0 4 1 * *" }
]
```

**Ce qui change par rapport à la configuration d'origine.**

`fetch-news` passe d'une paire d'entrées (04:00 et 05:00 UTC, avec une porte
sur l'heure de Paris à l'intérieur du handler) à une entrée unique à 07:00 UTC,
soit 09:00 à Paris en été et 08:00 en hiver. La porte `parisHour !== 6` du
handler doit être retirée ou élargie, sinon l'exécution no-opera : elle
n'accepte aujourd'hui que le tir qui tombe à 06:00 heure de Paris.

`f1?refresh=1` passe de « tous les deux jours » à « tous les jours à 06:00
UTC », mais l'endpoint décide désormais lui-même s'il travaille : il consulte
d'abord le calendrier F1 et sort immédiatement hors week-end de Grand Prix.
Voir la section suivante.

Penser aussi à retirer les blocs `PAUSE 25/09/2026` en tête de
`api/fetch-news.ts` et `api/f1.ts`.

---

## Optimisations à faire AVANT de rebrancher

### 1. News — tri Haiku avant Sonnet

**État : à faire.** Référence : diagnostic §05.

**Correction d'une prémisse.** La cadence d'origine n'était pas « toutes les
6 h » : `vercel.json` déclarait deux entrées (04:00 et 05:00 UTC) dont une
seule travaillait, grâce à une porte sur l'heure de Paris dans le handler. Le
coût réel était donc déjà d'environ **0,16 $/jour, soit ~4,80 $/mois** — et non
~19,20 $. Passer à une exécution quotidienne à 07:00 UTC ne change donc pas le
coût ; c'est l'optimisation ci-dessous qui le divise par cinq.

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

### 2. F1 — portail calendrier + plafond d'appels

**État : FAIT** — `server/f1-calendar.js` et le câblage dans `api/f1.ts`,
26/09/2026. Il reste à décider du rebranchement.

Trois garde-fous se composent désormais, du moins cher au plus cher :

1. **Portail calendrier (gratuit, aucun appel IA).** `hasF1SessionNear()`
   consulte le calendrier de la saison et ne laisse passer l'exécution que si
   une session F1 tombe dans une fenêtre de 30 h avant à 48 h après maintenant.
   Hors de ces fenêtres, le handler renvoie `{skipped:true, reason:'no_f1_session'}`
   sans toucher à Claude. Mesuré sur 2026 : **120 jours actifs sur 365**.

2. **Garde-fou de fraîcheur (7 jours).** Une entité rafraîchie récemment
   retourne `skipped:fresh` sans appel IA. C'est lui qui fait que, sur les cinq
   ou six jours actifs d'un week-end de GP, seuls les premiers passages
   dépensent réellement.

3. **Plafond de 15 appels IA par exécution** (`MAX_AI_CALLS_PER_RUN`). Il y a 30
   entités (10 écuries + 20 pilotes) : un passage en traite 15, le lendemain
   reprend les 15 restantes puisque le garde-fou de fraîcheur les laisse
   passer. La réponse expose `aiCalls`, `aiCallsMax` et `capped`.

`?force=1` court-circuite le portail calendrier pour une reprise manuelle.

**Pourquoi Jolpica / Ergast et pas OpenF1.** La spec visait
`api.openf1.org`. Testé le 26/09/2026, cette API renvoie **401** avec
« Live F1 session in progress. Global API access (including past sessions) is
restricted to authenticated users until the session ends. » Elle se ferme aux
appels anonymes **pendant** les sessions live, c'est-à-dire exactement quand le
test doit fonctionner. `api.jolpi.ca` est déjà utilisé par
`scripts/sync-f1-grid.mjs`, répond 200, n'a pas cette restriction, et livre le
détail de chaque session du week-end.

**Fenêtre arrière de 30 h : ce n'est pas un réglage cosmétique.** Les
classements, les points et le « dernier GP » ne changent qu'**après** la course.
Sans borne arrière, le portail se serait déclenché dès le mercredi ou le
vendredi, le garde-fou de fraîcheur aurait tout rafraîchi avant la course, puis
aurait sauté le lendemain comme « déjà frais » — et les classements auraient
été systématiquement une course en retard. Vérifié : avec 30 h, **les 23
courses de 2026 ont bien un passage après leur arrivée**.

**Jolpica limite le débit.** Un HTTP 429 a été observé en rafale. Le module
mémorise le calendrier 6 h en mémoire et retente une fois après 1,5 s. Le
portail est **fail-closed** : calendrier injoignable → on ne synchronise pas.
Sauter un jour ne coûte rien, lancer 30 appels « au cas où » coûte ~1,80 $.

**Coût attendu après rebranchement :** ~23 week-ends de GP par an, ~30 entités
chacun réparties sur deux passages de 15, à ~0,059 $ l'entité, soit **~1,77 $
par week-end → ~41 $/an ≈ 3,4 $/mois**. À comparer aux ~27 $/mois de la
configuration « tous les deux jours sans aucun garde-fou ».

**Point ouvert.** La cause de l'arrêt du 1er septembre 2026 n'est pas élucidée
— le dépérissement progressif (4 entités le 29/08, 3 le 31/08, 23 le 01/09,
puis rien) évoque un dépassement de durée. Le plafond de 15 appels réduit
mécaniquement le risque, mais seuls les logs Vercel trancheront.

---

### 3. Bug repéré au passage : `GP_2026_CAL` est faux

`api/f1.ts` embarque un calendrier codé en dur, injecté dans les prompts « pour
que Claude sache quelle course chercher par `round` ». Confronté aux données
Jolpica du 26/09/2026, il est décalé :

| round | `GP_2026_CAL` | Réalité Jolpica |
|---|---|---|
| 15 | GP d'Italie, 06/09 | GP d'Azerbaïdjan, **26/09** |
| 16 | GP de Madrid, 13/09 | GP de Bahreïn en Malaisie, 04/10 |
| 17 | GP d'Azerbaïdjan, **27/09** | GP de Singapour, 11/10 |
| 18 | GP de Singapour, 11/10 | GP des États-Unis, 25/10 |

Il compte aussi 24 entrées contre 23 courses réelles. Conséquence : les prompts
F1 demandent à Claude des informations sur **le mauvais Grand Prix**. Non
corrigé — ce n'était pas dans le périmètre. À traiter avant de rebrancher, sans
quoi le cron produira des données fausses en payant pour elles.

---

## Traçabilité

- Diagnostic complet ayant motivé la pause : audit REVS du 25/09/2026, §03 à §05 et §15.
- Fichiers touchés par la pause : `vercel.json`, `api/fetch-news.ts` (commentaire seul),
  `api/f1.ts` (commentaire + contrôle de fraîcheur).
- Aucun contenu supprimé en base.
