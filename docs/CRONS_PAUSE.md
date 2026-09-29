# Crons IA — pause du 25/09/2026, rebranchement du 29/09/2026

**État : les deux crons IA sont REBRANCHÉS, après correction des gaspillages qui avaient
motivé leur mise en pause.** Ce document garde l'historique complet : ce qui n'allait pas,
ce qui a été corrigé, ce qui a été vérifié, et ce qui reste à faire.

```
PAUSE        25/09/2026 — ~32 $/mois pour zéro lecteur
REBRANCHÉ    29/09/2026 — après correction des trois gaspillages « actu »
                          et vérification des trois garde-fous « F1 »
RESTE        tri Haiku avant Sonnet (actu) — voir §« Ce qui reste »
```

---

## 1 · Pourquoi la pause

Au 25/09/2026 : 5 comptes en base (dont ~3 de test), 29 spots, dernier spot le 12/08,
3 appels d'identification enregistrés dans `ai_usage` en deux mois. Autrement dit, aucune
activité réelle — mais deux crons continuaient à dépenser tous les jours.

| Cron | Cadence | Coût estimé | Ce qu'il produisait |
|---|---|---|---|
| `/api/fetch-news` (×2 entrées) | quotidien, 06:00 Paris | **~4,80 $/mois** | ~700 appels Sonnet pour **7 articles publiés** en 25 jours, soit ≈100 appels par article |
| `/api/f1?refresh=1` | tous les 2 jours | **~27 $/mois** | 30 appels Sonnet + `web_search` par passage, **sans aucun contrôle de fraîcheur** |

**Économie de la pause : ~32 $/mois**, soit plus de 99 % de la dépense IA du projet — la
reconnaissance photo, elle, coûte ~0,01 $ par capture et ne pesait quasiment rien.

Restés actifs pendant toute la pause, et inchangés : `/api/cron-notify` (17:00 UTC, push,
aucune IA), `?action=stats` (03:30 UTC, vue matérialisée), `?action=refresh-prices`
(1ᵉʳ du mois, ~0,01 $/mois).

---

## 2 · Actualités — les trois gaspillages, corrigés

### 2.1 · `makeFallback()` appelé sur le chemin de succès

`summarize()` appelait `makeFallback()` **inconditionnellement** avant de renvoyer son
résultat, alors que celui-ci ne sert que si le résumé est vide. Or `makeFallback()` teste
le titre et la description **d'origine** — en anglais dans 20 flux sur 24 — et déclenche
donc un `translateToFrench` (jusqu'à deux appels Sonnet) sur pratiquement chaque article,
pour jeter le résultat à la ligne suivante.

**Corrigé :** le chemin nominal retourne directement dès que le résumé est non vide.

> **Mesuré le 29/09/2026**, pipeline complet contre un serveur Anthropic factice :
> **1,00 appel Claude par article** analysé. Avant, chaque article en payait 2 à 3.

### 2.2 · Les filtres gratuits s'exécutaient après l'appel IA

« Pas d'image RSS » et « titre commercial » sont des tests locaux instantanés. Ils
tournaient **après** `summarize()` : tout article condamné payait son analyse complète
avant d'être jeté.

**Corrigé :** les deux tests remontent avant le plafond `MAX_TRANSLATE`. Le test commercial
reste **doublé** après l'IA — en amont il ne voit que le titre d'origine, en aval il voit
aussi le titre traduit. C'est un pré-filtre, pas un remplacement.

> **Mesuré le 29/09/2026 :** sur 29 candidats frais, **15 écartés sans payer (52 %)**.
>
> Nuance importante : comme `MAX_TRANSLATE` plafonne déjà à 14, ce filtre ne réduit pas
> toujours le NOMBRE d'appels — il change ce qu'ils achètent. Les 14 places payantes vont
> désormais à des candidats publiables au lieu d'être gaspillées par des condamnés
> d'avance. Le jour où il y a plus de 14 candidats viables, l'effet est un meilleur
> rendement ; en dessous, c'est une économie sèche.

### 2.3 · Aucune mémoire des articles rejetés

L'ensemble `known` était construit à partir de la table `news`, elle-même écrêtée à
50 lignes, alors que la fenêtre de candidature est de **7 jours** : un article analysé puis
rejeté n'était consigné nulle part et pouvait repasser par Claude chaque jour.

**Corrigé :** table `news_seen` (migration **0075**), purgée à 30 jours à chaque exécution.
Tout URL passé par le collecteur y est consigné — rejeté **comme** accepté, puisque `news`
est écrêtée et qu'un accepté évincé redeviendrait « inconnu ».

RLS activée, **zéro politique** : seule la clé `service_role` y accède, comme `ai_usage` et
`api_abuse_attempts`. C'est un compteur anti-gaspillage, il ne doit pas être contournable
depuis le navigateur.

> **Vérifié le 29/09/2026 :** deux passages consécutifs analysent **14 articles
> entièrement différents** (mémoire 29 → 56 URL). Si la mémoire échouait, le second passage
> aurait ré-analysé les mêmes et la table serait restée à 29.

### 2.4 · La porte horaire remplacée par une porte journalière

Avant, la porte exigeait exactement 06:00 heure de Paris, ce qui obligeait `vercel.json` à
déclarer **deux** entrées (04:00 et 05:00 UTC) pour couvrir le changement d'heure — une
seule travaillait. Deux créneaux de cron pour une exécution, et un horaire impossible à
changer sans toucher au code.

Maintenant, la porte compare le **jour parisien** du dernier passage réussi
(`news_meta.last_fetched_at`, déjà écrit en fin d'exécution) au jour courant. Une seule
entrée suffit, à n'importe quelle heure, et un double déclenchement accidentel ne repaie
pas l'analyse. L'horodatage n'étant posé qu'en fin d'exécution réussie, un passage qui
échoue à mi-chemin ne bloque pas celui du lendemain.

> **Vérifié :** second appel le même jour → `{"skipped":true,"reason":"already_fetched_today"}`,
> zéro appel IA.

---

## 3 · F1 — les trois garde-fous, vérifiés

Ces garde-fous étaient **déjà écrits** au moment de la pause (`server/f1-calendar.js`,
26/09/2026). Ce qui manquait, c'était la vérification qu'ils tiennent. Faite le 29/09.

1. **Portail calendrier — gratuit, aucun appel IA.** `hasF1SessionNear()` consulte le
   calendrier de la saison et ne laisse passer l'exécution que si une session F1 tombe dans
   une fenêtre de 30 h avant à 48 h après. Hors fenêtre, le handler renvoie
   `{skipped:true, reason:'no_f1_session'}` sans toucher à Claude.
   → **Vérifié le 29/09 : porte fermée, zéro appel.**
2. **Fraîcheur 7 jours par entité** — une entité rafraîchie récemment retourne
   `skipped:fresh` sans appel. C'est lui qui fait que, sur les cinq ou six jours actifs d'un
   week-end de GP, seuls les premiers passages dépensent réellement.
3. **Plafond de 15 appels IA par exécution** (`MAX_AI_CALLS_PER_RUN`). Il y a 30 entités
   (10 écuries + 20 pilotes) : un passage en traite 15, le lendemain reprend les 15
   restantes. La réponse expose `aiCalls`, `aiCallsMax` et `capped`.

`?force=1` court-circuite le portail calendrier pour une reprise manuelle.

### 3.1 · Le calendrier codé en dur était faux — et ne l'est plus

`GP_2026_CAL` (dans `api/f1.ts`) est injecté dans les invites « pour que Claude sache quelle
course chercher par `round` ». Au 26/09/2026 il était **décalé** : round 15 annonçait le GP
d'Italie au 06/09 alors que la réalité était l'Azerbaïdjan au 26/09, et il comptait
24 entrées pour 23 courses. Les invites demandaient donc des informations sur **le mauvais
Grand Prix**, en payant pour elles. C'était la condition bloquante du rebranchement.

> **Vérifié le 29/09/2026 contre l'API Jolpica** : **23 rounds, 23 dates, correspondance
> exacte**. Le calendrier a été corrigé entre-temps.

Une imprécision subsiste, sans effet sur le coût : le round 16 est le « Bahrain Grand Prix
in Malaysia », disputé **en Malaisie**. `GP_2026_CAL` et `src/lib/f1.ts` le situent tous
deux à Bahreïn. À corriger côté données.

### 3.2 · Pourquoi Jolpica / Ergast et pas OpenF1

La spec visait `api.openf1.org`. Testé le 26/09/2026, cette API renvoie **401** avec
« Live F1 session in progress. Global API access […] is restricted to authenticated users
until the session ends. » Elle se ferme aux appels anonymes **pendant** les sessions live,
c'est-à-dire exactement quand le test doit fonctionner. `api.jolpi.ca` répond 200, n'a pas
cette restriction, et livre le détail de chaque session du week-end.

### 3.3 · Pourquoi une fenêtre arrière de 30 h

Ce n'est pas un réglage cosmétique. Les classements, les points et le « dernier GP » ne
changent qu'**après** la course. Sans borne arrière, le portail se serait déclenché dès le
mercredi, le garde-fou de fraîcheur aurait tout rafraîchi avant la course, puis aurait sauté
le lendemain comme « déjà frais » — et les classements auraient été systématiquement une
course en retard. Vérifié : avec 30 h, **les 23 courses de 2026 ont bien un passage après
leur arrivée**.

Jolpica limite le débit (HTTP 429 observé en rafale). Le module mémorise le calendrier 6 h
en mémoire et retente une fois après 1,5 s. Le portail est **fail-closed** : calendrier
injoignable → on ne synchronise pas. Sauter un jour ne coûte rien ; lancer 30 appels « au
cas où » coûte ~1,80 $.

---

## 4 · Configuration actuelle

```json
"crons": [
  { "path": "/api/fetch-news",                     "schedule": "0 5 * * *" },
  { "path": "/api/f1?refresh=1",                   "schedule": "0 6 * * *" },
  { "path": "/api/cron-notify",                    "schedule": "0 17 * * *" },
  { "path": "/api/cron-notify?action=stats",       "schedule": "30 3 * * *" },
  { "path": "/api/cron-notify?action=refresh-prices", "schedule": "0 4 1 * *" }
]
```

`fetch-news` à 05:00 UTC = 07:00 Paris en été, 06:00 en hiver. L'heure exacte n'a plus
d'importance : la porte journalière garantit une exécution réelle par jour parisien.

`f1?refresh=1` tourne tous les jours mais ne dépense que pendant les week-ends de Grand
Prix, grâce au portail calendrier.

### 4.1 · Faille trouvée et corrigée au passage

En rebranchant, la porte d'accès de `/api/fetch-news` s'est révélée **contournable par un
simple paramètre d'URL**. Elle était écrite ainsi :

```js
if (!isCron && !force && purge !== '1' && purge_en !== '1') → refus
```

Les leviers de maintenance figuraient donc parmi les **exemptions** à l'authentification,
alors qu'ils sont précisément ce qu'il faut protéger le plus. Sans aucun jeton :

| Appel | Effet |
|---|---|
| `?force=1` | exécution complète du pipeline Sonnet — dépense d'API à la demande d'un inconnu |
| `?purge=1` | **suppression de TOUTE la table `news`** |
| `?purge_en=1` | suppression de toutes les lignes jugées anglaises |

**Corrigé le 29/09/2026** : le jeton est exigé en tête de handler, avant le moindre travail.
Les leviers ne sont plus que des options offertes à un appelant déjà authentifié. Et le
contrôle est **fail-closed** — un `CRON_SECRET` absent refuse tout, là où l'ancien
`!cronSecret || …` ouvrait l'endpoint à la terre entière. Si la variable disparaît, le fil
cesse de se mettre à jour : panne visible, et sans facture.

`api/f1.ts` et `api/cron-notify.ts` n'avaient pas ce défaut — leurs leviers (`?force=1`,
`?action=`) sont placés APRÈS le contrôle d'authentification.

Vérifié en production le 29/09 : `/api/f1?refresh=1` sans en-tête renvoie **401**,
`/api/fetch-news` également depuis le correctif.

> **Note sur `vercel.json`** : le fichier est du JSON strict validé contre
> `https://openapi.vercel.sh/vercel.json`, avec `additionalProperties: false`. Il n'accepte
> ni commentaire `//` ni clé maison — **les deux cassent le déploiement**. C'est pourquoi
> les entrées en veille étaient conservées dans ce document plutôt qu'en commentaire.

---

## 5 · Coût attendu après rebranchement

| Cron | Avant | Après | Base de calcul |
|---|---|---|---|
| Actualités | ~4,80 $/mois | **~1,5 à 2 $/mois** | 14 appels/jour à 1,00 appel par article, sans ré-analyse |
| F1 | ~27 $/mois | **~3,4 $/mois** | ~23 week-ends de GP × ~30 entités × ~0,059 $, réparties sur deux passages de 15 |

**Total : de l'ordre de 5 $/mois contre ~32 $/mois avant la pause.**

Ces chiffres sont des estimations construites sur des mesures réelles (1,00 appel par
article, 52 % de pré-filtrage), pas sur des relevés de facturation. À confronter à la
console Anthropic après un mois.

---

## 6 · Ce qui reste

### Tri Haiku avant Sonnet — **non fait**

Aujourd'hui, un seul appel Sonnet fait à la fois le tri de pertinence, la catégorisation,
la traduction du titre et la rédaction du résumé : on paie le tarif rédaction pour trier
des articles qu'on va jeter. La suite logique est de séparer les deux — un passage **Haiku**
à sortie structurée (booléen de pertinence + catégorie, ~50 jetons de sortie) sur les
candidats, puis **Sonnet** uniquement sur les articles retenus.

Gain attendu : encore **−50 à −70 %** sur le poste actualités. Ce n'est plus bloquant, mais
c'est le prochain geste utile.

### Observabilité

La réponse de `/api/fetch-news` expose désormais `aiCalls` et `prefilterSkipped`. Le rapport
entre les deux dit si le rebranchement tient ses promesses, sans ouvrir la console Anthropic.

### Point non élucidé

La cause de l'arrêt du cron F1 le 1ᵉʳ septembre 2026 n'est pas connue — le dépérissement
progressif (4 entités le 29/08, 3 le 31/08, 23 le 01/09, puis rien) évoque un dépassement de
durée. Le plafond de 15 appels réduit mécaniquement le risque, mais seuls les logs Vercel
trancheront. À surveiller au premier week-end de GP après rebranchement (**round 16, Bahrain
GP in Malaysia, 4 octobre 2026** — portail ouvert à partir du 1ᵉʳ octobre environ).

---

## 7 · Traçabilité

- Diagnostic initial : audit REVS du 25/09/2026, §03 à §05 et §15.
- Fichiers touchés par la pause : `vercel.json`, `api/fetch-news.ts`, `api/f1.ts` (commentaires).
- Fichiers touchés par le rebranchement : `vercel.json`, `api/fetch-news.ts`, `api/f1.ts`,
  `supabase/0075-news-seen.sql`.
- Aucun contenu supprimé en base, ni pendant la pause ni au rebranchement.
