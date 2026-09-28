# REVS — identité visuelle

Charte officielle, en vigueur depuis le 28/09/2026.

> **Tous les fichiers de `public/brand/` sont générés.** Ne jamais les éditer
> à la main : modifier `scripts/build-brand.mjs` puis lancer `npm run brand`.

---

## ⚠️ Le monogramme est une IMAGE, pas un tracé

Depuis le 28/09/2026, le monogramme R+V n'est plus redessiné en SVG : c'est
le PNG découpé dans la planche de référence, par
`scripts/extract-brand-png.mjs` (`npm run brand:png`). La découpe native est
conservée dans `brand-source/` pour que le script reste rejouable.

**Ce que ce choix coûte, et qu'il faut connaître avant de s'appuyer dessus :**

| | |
|---|---|
| Résolution utile | **428 × 175 px**. Au-delà d'environ 400 px de large, l'agrandissement se voit. |
| Thème | Un PNG ne suit pas `currentColor`. D'où **deux fichiers** : `revs-monogram.png` (blanc + rouge) et `revs-monogram-dark.png` (noir + rouge, pour fond clair). |
| Éclairage | Le dégradé métallique et les reflets sont **cuits** dans l'image. Ils se retrouvent à toutes les tailles. |
| Impression | Il n'existe plus de maître vectoriel du monogramme utilisé en production. Les SVG de `public/brand/` restent générés par `build-brand.mjs` mais ne sont plus la source de l'application. |

Le MOT « REVS » et la tagline restent, eux, en tracés : ils correspondent à
la référence, et les recomposer avec une police système redonnerait une forme
différente d'un appareil à l'autre.

---

## Géométrie du tracé (historique)

Un R et un V construits comme **un seul dessin**. Le mark repose sur deux
familles d'obliques, et c'est ce qui le fait tenir :

| | pente | pièces |
|---|---|---|
| descendantes-**droite** | +0.42 | jambage du R, **bras gauche du V** |
| descendantes-**gauche** | −0.45 | dalle rouge, **bras droit du V** |

Le jambage du R et le bras gauche du V courent en parallèle à **10 unités
d'écart constant** : c'est la double diagonale qui donne sa vitesse au mark.

**Le R n'a pas de hampe.** Sa place est tenue par la **dalle rouge**,
détachée d'environ 5 unités du coin bas-gauche de la panse. C'est le point
de construction le plus important — et c'est pour ça que le monogramme « se
lit rouge à gauche » alors que la panse, elle, est claire.

Répartition des couleurs :

- **rouge** : la dalle (position de la hampe) + le bras gauche du V ;
- **blanc** : la panse du R avec son contrepoinçon, son jambage, et le bras
  droit du V.

Tout est bâti sur une grille de **120 unités de hauteur**, graisse **unique de
24 unités**. Aucune inclinaison globale : les obliques sont dessinées dans
leurs coordonnées finales, et leurs deux pentes sont volontairement
différentes — ce qu'un skew uniforme ne peut pas produire. Le mot REVS, lui,
porte sa propre italique de 10°.

**Ratio du monogramme ≈ 1.84** (la planche de référence est à 1.82). Toujours
dimensionner par la hauteur.

---

## Couleurs

| Rôle | Token CSS | Valeur |
|---|---|---|
| Rouge REVS | `--revs-red` | `#E8203A` |
| Noir | `--revs-black` | `#0B0B0B` |
| Blanc | `--revs-white` | `#FFFFFF` |
| Gris | `--revs-gray` | `#9A9A9A` |

`--revs-red` est **dérivé de `--color-accent`**, pas réécrit : il ne peut pas
exister deux rouges REVS qui divergent. Avant cette charte,
`public/icons/master.svg` utilisait `#D40000` — un second rouge qui ne
correspondait à rien.

Les couleurs de marque ne basculent **jamais** avec le thème. Ce qui change en
thème clair, c'est le fichier qu'on affiche, pas la définition de la couleur.

> Sur fond clair, la tagline passe à `#6B6B6B`. Ce n'est pas un cinquième gris :
> `#9A9A9A` tombe à 2.8:1 de contraste sur blanc, donc illisible.

---

## Choisir sa variante

| Contexte | Fichier |
|---|---|
| **Logo principal** (vertical : monogramme / REVS / tagline) | `revs-logo-primary.svg` · `.png` · `-light.svg` |
| Logo horizontal | `revs-logo-horizontal.svg` · `.png` · `-tagline.svg` · `-light.svg` |
| Une seule couleur | `revs-logo-monochrome-white.svg` / `-black.svg` |
| Symbole seul | `revs-monogram.svg`, `-light`, `-white`, `-black` |
| Mot seul | `revs-wordmark.svg`, `-light` |
| Icône d'app (coins arrondis) | `revs-icon-{1024,512,256,128}.png` |
| Icône carrée (natif / maskable) | `revs-icon-master.svg` |
| Favicon | `favicon.svg`, `favicon-{32,16}.png` |
| Partage social | `revs-og-image.jpg` (1200×630) |
| Écran de lancement | `revs-splash.svg` · `.png` (2732×2732) |

⚠️ **`revs-icon-*.png` a des coins arrondis et donc de la transparence.**
Réservés au web et à la communication. Ne **jamais** les utiliser comme icône
native : iOS applique déjà son propre masque (double arrondi) et refuse un
canal alpha à l'upload App Store, et l'icône adaptative Android exige une
image à fond perdu. Les cibles natives et l'icône PWA `maskable` passent par
le master **carré**.

**Dans l'application, ne pas référencer ces fichiers** : utiliser les
composants de `src/components/Logo.tsx` (`RevsMark`, `RevsWordmark`,
`RevsLogo`). Ils lisent `src/lib/brand-paths.ts`, généré par le même script,
donc le logo affiché est rigoureusement celui des fichiers.

Par défaut ils rendent en `currentColor` : le parent impose la couleur avec
`text-fg` (thématique) ou `text-white` (surfaces toujours sombres).

---

## Règles

**À faire**

- Dimensionner par la hauteur.
- Laisser autour du logo au moins la hauteur du monogramme comme marge.
- Sur fond complexe ou en impression, prendre une variante monochrome.

**À ne pas faire**

- Recomposer « REVS » avec une police. Le mot est un tracé ; toute police
  système donnera une forme différente d'un appareil à l'autre — c'est
  exactement ce que cette charte a corrigé.
- Déplacer le rouge. Dans le monogramme il porte la dalle et le bras gauche
  du V ; dans le mot, le bras gauche du V. C'est une règle de système, pas
  une décoration — et surtout, ne pas colorer la panse du R : c'est elle qui
  porte le contraste qui distingue le R du V.
- Ajouter un glow, une ombre portée ou un dégradé dans un fichier maître. Les
  effets appartiennent aux maquettes.
- Arrondir les coins du master d'icône : il est carré, les plateformes posent
  leur propre masque.
- Étirer : le monogramme n'est pas carré.

---

## Limites connues

- **16 px** : à cette taille la contre-forme du R se ferme et le monogramme
  devient une masse. C'est inhérent à la taille, pas corrigeable sans dessiner
  un second symbole simplifié. 32 px et au-delà : net.
- **`og:image` pointe sur `https://revs-ten.vercel.app`** en dur dans
  `index.html`. À changer en même temps qu'un éventuel nom de domaine propre —
  les réseaux sociaux ne résolvent pas les chemins relatifs.
- **L'application n'a pas d'en-tête.** `MainLayout` laisse chaque onglet
  gérer son haut de page. Le monogramme est donc posé dans la barre de
  micro-stats de l'accueil (`Home.tsx`), à gauche du compteur « en ligne » :
  c'est la seule barre de tête réelle, et l'y insérer évitait de décaler tout
  le contenu. Les autres onglets n'affichent pas la marque.

---

## Régénérer

```sh
npm run brand
```

Écrit ~70 fichiers : les SVG maîtres, les PNG d'icône et de favicon,
l'image Open Graph, les splash, `src/lib/brand-paths.ts`, et les assets natifs
Android (`mipmap-*`, `drawable-*`) et iOS (`Assets.xcassets`).

Les assets natifs survivent à `cap sync`, mais **pas** à une suppression puis
recréation de la plateforme (`cap add`). Dans ce cas, relancer `npm run brand`.
