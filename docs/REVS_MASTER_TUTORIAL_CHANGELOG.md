# REVS Master Tutorial — changelog

Le journal des versions vit **dans le tutoriel lui-même**, au chapitre 18
(`docs/REVS_MASTER_TUTORIAL.md`, section `## 18. CHANGELOG`). Il y est
consultable directement depuis la page `/tutorial`, ce qui est l'endroit où
on le cherche vraiment.

Le dupliquer ici créerait deux versions du même historique, qui divergeraient
au premier oubli — exactement ce que le chapitre 2 du tutoriel demande
d'éviter. Ce fichier n'est donc qu'un panneau indicateur.

## Comment ajouter une entrée

1. Ouvrir `docs/REVS_MASTER_TUTORIAL.md`.
2. Mettre à jour le bloc `<!-- meta … -->` en tête : `version` et
   `lastVerified` au minimum.
3. Ajouter une section `### Version X.Y — <date>` en tête du chapitre 18.
4. Régénérer : `npm run tutorial` (ou simplement `npm run build`).
5. Commiter le Markdown **et** `server/tutorial-content.js` (généré).

## Versions

| Version | Date | Résumé |
|---|---|---|
| 1.0 | 29/09/2026 | Première version — 18 chapitres, 15 annexes, architecture de référence `0ba9337` |
