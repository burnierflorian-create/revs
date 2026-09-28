# REVS — identité visuelle

Charte officielle, en vigueur depuis le 28/09/2026.

> **Tous les fichiers de `public/brand/` sont générés.** Ne jamais les éditer
> à la main : modifier `scripts/build-brand.mjs` puis lancer `npm run brand`.

---

## Le monogramme

Un R et un V construits comme **un seul dessin**, pas comme deux lettres
posées côte à côte.

- La **diagonale rouge** est le bras gauche du V. Elle traverse la panse du R
  entre y≈8 et y≈37 : c'est cette intersection qui soude les deux lettres.
- Le **jambage du R** court en parallèle, blanc, à 6 unités d'écart constant.
  Cette double diagonale est la signature du mark.
- Tout est bâti sur une grille de **120 unités de hauteur** avec une graisse
  **unique de 24 unités**, puis incliné de **10°** d'un seul bloc.

L'inclinaison produit un effet qu'on cherchait : les deux bras du V n'ont plus
la même pente (le gauche s'adoucit à 0.37, le droit se redresse à 0.73). C'est
de là que vient la sensation de vitesse — pas d'un glow, pas d'un dégradé, pas
de « lignes de mouvement ».

**Ratio du monogramme : 270.16 × 144 ≈ 1.876.** Toujours dimensionner par la
hauteur.

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
| Fond sombre (défaut) | `revs-logo-primary.svg` (= `revs-logo-dark.svg`) |
| Fond clair | `revs-logo-light.svg` |
| Avec tagline | `revs-logo-tagline.svg` / `-light.svg` |
| Une seule couleur | `revs-logo-monochrome-white.svg` / `-black.svg` |
| Symbole seul | `revs-monogram.svg`, `-light`, `-white`, `-black` |
| Mot seul | `revs-wordmark.svg`, `-light` |
| Icône d'application | `revs-icon-master.svg` + `revs-icon-{1024,512,256,128}.png` |
| Favicon | `favicon.svg`, `favicon-{32,16}.png` |
| Partage social | `og-image.jpg` (1200×630) |
| Écran de lancement | `splash.png` (2732×2732) |

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
- Déplacer le rouge sur une autre lettre. Le rouge est **sur le V**, dans le
  monogramme comme dans le mot. C'est la règle du système, pas une décoration.
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
- **Pas de logo dans l'en-tête de l'application.** Aucune surface n'en
  affichait avant cette charte (`MainLayout` n'a pas d'en-tête de marque, et
  `TitleChip` montre le titre de l'utilisateur). Le composant est prêt : un
  `<RevsLogo height={20} />` suffit le jour où on en veut un.

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
