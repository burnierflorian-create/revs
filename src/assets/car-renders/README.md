# Rendus voitures du Showroom

Dépose ici tes **rendus studio** (fond gris uni, pas besoin de détourer toi‑même)
nommés selon la convention :

```
Make__Model.ext
```

- `__` (deux underscores) sépare **la marque** du **modèle**
- `_` (underscore simple) devient une **espace**
- extensions : `.jpg` `.jpeg` `.png` `.webp`

Exemples :

| Fichier                     | Marque        | Modèle       |
| --------------------------- | ------------- | ------------ |
| `Lamborghini__Huracan.jpg`  | Lamborghini   | Huracan      |
| `Mercedes-AMG__GT_63_S.png` | Mercedes-AMG  | GT 63 S      |
| `Rolls_Royce__Ghost.jpg`    | Rolls Royce   | Ghost        |

Puis lance :

```bash
node scripts/detour-car-renders.mjs          # détoure → upload → car_renders
node scripts/detour-car-renders.mjs --dry-run # détoure seulement (aperçu local)
```

Le script retire le fond, recadre, écrit le PNG transparent dans `detoured/`,
l'upload dans le bucket Storage `car-renders` (public) et remplit la table
`car_renders`. Le Showroom pose alors la voiture détourée sur le sol, sous le
spot, avec reflet — sinon il retombe sur la photo du spot.

> Les images (brutes et détourées) sont **gitignorées** : elles vivent dans
> Supabase Storage, pas dans le dépôt.
