# Textes de référence pour mesurer la qualité de lecture (CER / WER)

Chaque fichier `*.json` de ce dossier décrit UN document et sa transcription de référence **vérifiée par un humain** :

```json
{
  "id": "ad-exemple-bms-1650-p12",
  "title": "Registre paroissial de … (1650), vue 12, acte 3",
  "script_type": "french_cursive",
  "language": "fr",
  "period": "1650",
  "image_url_public": "https://… (adresse publique de l'image sur le site d'archives)",
  "licence": "conditions de réutilisation du site d'archives (ex. Licence Ouverte Etalab 2.0)",
  "reference_text": "ligne 1\nligne 2\n…",
  "notes": "qui a transcrit, quand, conventions (abréviations conservées, ſ noté s, etc.)",
  "synthetic": false
}
```

`reference_text` doit être une transcription **diplomatique** (même conventions que GENEALIS : orthographe et
abréviations d'origine, une ligne du document = une ligne du texte), sinon le CER/WER mesure surtout la différence de
conventions. Le rapport donne aussi un score « normalisé » (sans majuscules, accents, ponctuation ; ſ/s, u/v, i/j unifiés).

## Règles

- **N'inventez jamais un texte de référence.** Une référence doit venir d'une transcription relue (la vôtre, faite
  lentement sur l'image, ou une transcription publiée par un service d'archives ou une association, avec sa source).
- Ne mettez dans ce dossier que des documents **publics** dont la licence autorise la réutilisation, et jamais de
  document concernant une personne vivante.
- Les fichiers `synthetique-*.json` sont des textes **synthétiques** (inventés, marqués `"synthetic": true`) utilisés
  par les tests automatiques avec des images dessinées par l'ordinateur : ils vérifient le calcul, **pas** la capacité
  à lire une écriture ancienne réelle.

## Ajouter un document réel vérifié

1. Téléchargez l'image depuis le site d'archives (en respectant ses conditions) et importez-la dans GENEALIS.
2. Transcrivez-la vous-même ligne par ligne (ou reprenez une transcription publiée, en citant la source dans `notes`).
3. Créez `<id>.json` ici avec les champs ci-dessus.
4. Dans le lecteur, lancez la lecture automatique, puis `POST /api/paleo/benchmark` avec `{"ref_id": "<id>", "reading_id": "…"}`
   (ou le bouton « Mesurer la qualité » du lecteur). Le résultat est conservé dans la lecture (`quality.benchmarks`).

Protocole complet : `docs/PALEOGRAPHIE.md`.
