# REVS — enveloppe native (Capacitor)

Capacitor empaquette le build web existant dans une application Android et
iOS. Il ne duplique pas le projet : `dist/` est copié tel quel dans une
WebView. Le code React n'a pas été modifié pour cette étape.

- **appId** : `app.revs.carspotting`
- **appName** : `REVS`
- **webDir** : `dist`
- **Capacitor** : 8.5.2

Configuration : [`capacitor.config.ts`](./capacitor.config.ts).

---

## Commandes

| Commande | Effet |
|---|---|
| `npm run cap:build` | `npm run build` puis `npx cap sync` — recopie `dist/` dans les deux projets natifs et met à jour les plugins. |
| `npm run cap:android` | `cap:build` puis ouvre le projet dans Android Studio. |
| `npm run cap:ios` | `cap:build` puis ouvre le projet dans Xcode. |

**À retenir : `cap sync` après chaque changement web.** Les projets natifs
embarquent une *copie* de `dist/`. Tant que `cap sync` n'a pas tourné,
l'app native continue d'afficher la version précédente — c'est la cause la
plus fréquente de « j'ai corrigé mais rien ne change ».

---

## Plugins installés

| Plugin | Utilisé pour | État |
|---|---|---|
| `@capacitor/camera` | Photo d'un spot | permissions déclarées |
| `@capacitor/geolocation` | Position du spot | permissions déclarées |
| `@capacitor/splash-screen` | Écran de lancement | configuré (#0a0a0a) |
| `@capacitor/status-bar` | Barre de statut | configuré, **statique** (voir plus bas) |
| `@capacitor/push-notifications` | Notifications | **installé mais non fonctionnel** (voir plus bas) |

Installer un plugin ne branche rien tout seul : le code React appelle
aujourd'hui les API **web** (`navigator.geolocation`, `<input type="file">`,
`PushManager`). Sur Android ces API fonctionnent dans la WebView. Les points
où ce n'est pas vrai sont listés ci-dessous.

---

## Prérequis de build

Vérifiés sur cette machine le 28/09/2026 :

| Outil | État | Nécessaire pour |
|---|---|---|
| Node 24.15 | ✅ | tout |
| Xcode 26.2 | ✅ | iOS |
| CocoaPods | ❌ absent | **plus requis** — Capacitor 8 utilise Swift Package Manager |
| JDK | ❌ **absent** | **bloque tout build Android** |
| Android Studio | ❌ absent | bloque `cap open android` |
| `ANDROID_HOME` | ❌ non défini | bloque le build en ligne de commande |

Le projet Android a bien été **généré**, mais il ne peut pas encore être
**compilé** ici. Pour débloquer :

```sh
brew install --cask temurin@21      # JDK 21 — requis par Capacitor 8
brew install --cask android-studio  # puis SDK + ANDROID_HOME au 1er lancement
```

iOS est prêt à ouvrir dans Xcode dès maintenant.

---

## Les trois choses qui ne marcheront pas telles quelles

Ce sont des constats vérifiés dans le code, pas des hypothèses. Aucune n'est
corrigée : les corriger demande de modifier le code React, ce qui était hors
périmètre de cette étape.

### 1. Push — l'implémentation actuelle ne fonctionne pas en natif

REVS envoie aujourd'hui des **push Web** (VAPID / `web-push`) vers des
endpoints navigateur — voir `src/lib/push.ts`. En natif, le transport est
FCM (Android) et APNs (iOS) : autres jetons, autres identifiants serveur.

Ce qu'il reste à faire :
- projet Firebase + `google-services.json` dans `android/app/` ;
- clé APNs + capability *Push Notifications* dans Xcode ;
- stocker le jeton natif (`PushNotifications.addListener('registration')`)
  dans une colonne distincte des abonnements web ;
- router l'envoi côté serveur selon le type d'abonnement.

Bonne nouvelle : la dégradation est propre. `src/lib/push.ts` teste
`'serviceWorker' in navigator` avant tout, donc sur iOS la fonctionnalité se
désactive au lieu de planter.

### 2. Connexion Google — cassée en natif

`src/pages/Auth.tsx:105` passe `redirectTo: window.location.origin`. Dans
l'app, cette origine vaut `https://localhost` (Android) ou
`capacitor://localhost` (iOS). Google refuse de rediriger vers ces URL, et
Supabase ne les a pas dans sa liste d'URL autorisées.

→ **La connexion par e-mail/mot de passe, elle, fonctionne** : c'est un
appel API, sans redirection. C'est le chemin à utiliser pour les tests.

Correction ultérieure : `@capacitor/browser` + un deep link
`app.revs.carspotting://auth`, déclaré côté Supabase et côté Google.

### 3. Paiement Stripe — problème de règlement, pas de technique

Stripe Checkout fonctionne dans la WebView. Mais la règle App Store 3.1.1
impose l'achat intégré (IAP) pour tout contenu numérique, et Premium en est.
Une soumission publique avec Stripe se fait rejeter.

Ce que ça change concrètement :
- **Play Internal Testing** : pas de revue. ✅ aucun blocage.
- **TestFlight, testeurs internes** (≤100, membres de l'équipe) : pas de
  revue non plus. ✅ aucun blocage pour les 20–30 bêta-testeurs visés.
- **TestFlight externe** puis **sortie publique** : revue Apple. ❌ il
  faudra soit passer par StoreKit, soit masquer l'achat sur iOS.

À ne pas découvrir la veille de la sortie, mais **rien à faire pour la bêta
interne**.

### Et le service worker ?

- **Android** : la WebView est servie en `https://localhost` — contexte
  sécurisé, le service worker s'enregistre normalement. `injectManifest` est
  préservé, la config PWA n'a pas été touchée.
- **iOS** : `capacitor://localhost` n'est pas un contexte sécurisé WebKit,
  le service worker ne s'enregistre pas. Ce n'est pas grave : l'app native
  n'a pas besoin du cache hors-ligne du SW, et `UpdateNotification` se met
  simplement en sommeil. **Non vérifié sur appareil réel** — à confirmer au
  premier build iOS.

---

## Limite connue : barre de statut et thème clair

`capacitor.config.ts` fixe `StatusBar.style: 'DARK'` (texte clair sur fond
sombre), ce qui correspond au thème par défaut. REVS ayant un thème clair,
la barre deviendra peu lisible quand l'utilisateur bascule. La correction
tient en un appel `StatusBar.setStyle()` dans le `ThemeProvider` — donc une
modification du code React, volontairement non faite ici.

---

## Signature

**Aucune clé de signature n'est configurée**, comme convenu.

- Android : pas de keystore, pas de `signingConfigs` dans `build.gradle`.
- iOS : pas d'équipe de développement ni de profil de provisionnement.

À faire manuellement avant le premier upload.

---

## Versionner

Les dossiers `android/` et `ios/` **se committent** — c'est le mode de
fonctionnement de Capacitor. Ils apportent 73 fichiers pour ~0,7 Mo ; les
`.gitignore` générés par Capacitor excluent déjà les artefacts de build et
la copie de `dist/`.

⚠️ Dans ce dépôt, **ne pas utiliser `git add -A`** (cela ajouterait
`.github/news-cron.yml`, volontairement non suivi). Utiliser `git add -u`
plus les chemins explicites.

---

## Prochaines étapes vers la bêta

1. Installer le JDK 21 et Android Studio.
2. `npm run cap:android`, générer un AAB de debug, vérifier que l'app
   démarre et que caméra + GPS répondent.
3. `npm run cap:ios`, choisir une équipe de signature, lancer sur appareil.
4. Icônes et écrans de lancement natifs (`@capacitor/assets` peut les
   générer depuis les sources existantes de `public/icons/`).
5. Créer les fiches Play Console et App Store Connect, monter les
   20–30 testeurs.
6. Décider du sort de Stripe sur iOS **avant** toute soumission externe.
