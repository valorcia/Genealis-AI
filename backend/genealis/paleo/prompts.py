"""Consignes envoyées au modèle de lecture (lecture principale, seconde passe, photo, mode copier-coller)."""
from __future__ import annotations

from ..ai.documents import EXTRACTION_RULES
from . import scripts

RELATION_KINDS = ("father", "mother", "son", "daughter", "brother", "sister", "half_brother", "half_sister", "uncle", "aunt",
                  "nephew", "niece", "cousin", "grandfather", "grandmother", "grandson", "granddaughter", "brother_in_law",
                  "sister_in_law", "father_in_law", "mother_in_law", "son_in_law", "daughter_in_law", "stepfather",
                  "stepmother", "spouse", "widow", "widower", "godfather", "godmother", "guardian", "neighbour", "friend",
                  "employer", "servant", "none")
MENTION_ROLES = ("subject", "father", "mother", "spouse", "groom", "bride", "witness", "godfather", "godmother", "declarant",
                 "officiant", "deceased", "informant", "neighbour", "other")

READ_SCHEMA = (
    '{"document_kind": "act|register_page|census|letter|notarial|photo|other", '
    '"script_type": "' + "|".join(k for k in scripts.SCRIPTS) + '", "script_confidence": 0.0-1.0, '
    '"language": "code ISO (fr, la, de, it, pl, ru…)", "other_languages": ["…"], '
    '"period_estimate": "ex. « vers 1650 » ou « 1840-1860 »", '
    '"orientation_ok": true, "rotation_needed": 0|90|180|270, '
    '"zones": [{"box_2d": [ymin, xmin, ymax, xmax], "kind": "text|margin_note|signature|stamp|table|printed_form|illustration"}], '
    '"lines": [{"n": 1, "box_2d": [ymin, xmin, ymax, xmax], "zone": 0, '
    '"diplomatic": "transcription diplomatique EXACTE de la ligne (orthographe, abréviations, ponctuation d\'origine)", '
    '"normalized": "même ligne normalisée : abréviations développées, orthographe et ponctuation modernes, noms au nominatif", '
    '"translation": "traduction de la ligne dans la langue demandée, ou null", '
    '"uncertain": [{"text": "passage incertain tel que lu", "alternatives": ["autre lecture possible", "…"], '
    '"reason": "pourquoi c\'est incertain (encre effacée, lettre ambiguë, tache, pli…)", "confidence": 0.0-1.0, '
    '"box_2d": [ymin, xmin, ymax, xmax]}]}], '
    '"translation": "traduction complète, ou null si le document est déjà dans la langue demandée", '
    '"extraction": {"document_type": "birth|baptism|marriage|death|burial|census|notarial|other", "date": "telle qu\'écrite", '
    '"date_iso": "AAAA-MM-JJ ou null", "place": "paroisse / commune", "act_number": null, "officer": "curé, notaire ou officier", '
    '"persons": [{"role": "' + "|".join(MENTION_ROLES) + '", "name_original": "nom exactement comme écrit", '
    '"given_names": "prénoms (forme normalisée)", "surname": "NOM", "sex": "M|F|null", "age": "âge tel qu\'écrit ou null", '
    '"occupation": null, "residence": null, "signed": true|false|null, '
    '"stated_relation": "lien écrit dans le document (ex. « oncle maternel de l\'épouse »), ou null", '
    '"relation_kind": "' + "|".join(RELATION_KINDS) + '|null", "relation_side": "maternal|paternal|unknown|null", '
    '"relation_to_role": "rôle de la personne de référence (groom, bride, subject, father…) ou null", '
    '"deceased": false, "line_n": 1, "excerpt": "citation exacte du passage qui nomme la personne", "confidence": "high|medium|low"}], '
    '"relations": [{"type": "parent|spouse|sibling|other", "from": 0, "to": 1, "evidence": "citation exacte"}], '
    '"summary_fr": "une phrase simple en français pour un débutant"}, '
    '"quality": {"legibility": "good|medium|poor", "problems": ["…"], "self_assessment": "phrase courte"}, '
    '"warnings": ["…"]}'
)

SYSTEM_PALEO = (
    "Tu es un paléographe professionnel (archives françaises, allemandes, italiennes, polonaises, latines et cyrilliques) "
    "et un généalogiste rigoureux. Tu lis l'image jointe d'un document ancien et tu réponds UNIQUEMENT par un objet JSON strict.\n"
    "Règles absolues :\n"
    "1. Ne jamais inventer : ce qui n'est pas lisible est signalé comme incertain, jamais complété par déduction. "
    "Le contexte historique peut guider une hypothèse, jamais la prouver.\n"
    "2. Transcription DIPLOMATIQUE fidèle, ligne par ligne, dans l'ordre de lecture : orthographe, abréviations, majuscules, "
    "ponctuation et coupures d'origine conservées ; lettres suscrites notées avec ^ (ex. « M^e ») ; mots barrés entre [barré: …] ; "
    "ajouts interlinéaires entre \\ … /. Un mot illisible s'écrit [illisible].\n"
    "3. La version NORMALISÉE est séparée : abréviations développées, orthographe moderne, noms propres au nominatif.\n"
    "4. Chaque passage incertain va dans « uncertain » avec ses lectures alternatives classées de la plus probable à la moins "
    "probable, la raison et une confiance entre 0 et 1. Une lecture hypothétique n'est JAMAIS présentée comme certaine.\n"
    "5. Les coordonnées « box_2d » sont [ymin, xmin, ymax, xmax] en millièmes (0-1000) de l'image jointe.\n"
    "6. Extraction : toutes les personnes citées (sujet, parents, conjoints, parrains, témoins, déclarants, officiant), avec le lien "
    "de parenté tel qu'il est écrit (ne jamais déduire un lien absent du texte). Un homonyme n'est jamais présumé parent.\n"
    + EXTRACTION_RULES + "\n"
    "Schéma de la réponse :\n" + READ_SCHEMA
)


def read_user_prompt(*, guidance: str, scribe_context: str, translate_to: str | None, forced_script: str | None,
                     forced_language: str | None, filename: str, document_kind: str | None = None,
                     working_note: str | None = None) -> str:
    parts = ["Lis ce document d'archives et renvoie le JSON demandé (identification de l'écriture et de la langue, zones de "
             "texte, transcription diplomatique ligne par ligne avec coordonnées, passages incertains, version normalisée, "
             "traduction, extraction généalogique)."]
    if forced_script:
        parts.append(f"L'utilisateur indique l'écriture : {forced_script} ({scripts.SCRIPTS.get(forced_script, {}).get('label', '')}). Vérifie-le.")
    if forced_language:
        parts.append(f"L'utilisateur indique la langue : {forced_language}. Vérifie-le.")
    if document_kind:
        parts.append(f"Type de document indiqué : {document_kind}.")
    if translate_to:
        parts.append(f"Traduis en « {translate_to} » si le texte est dans une autre langue (traduction par ligne et complète) ; "
                     "sinon mets null.")
    if working_note:
        parts.append(working_note)
    parts.append("Consignes de lecture pour cette écriture :\n" + guidance)
    if scribe_context:
        parts.append(scribe_context)
    parts.append(f"Nom du fichier : {filename}.")
    return "\n\n".join(parts)


SYSTEM_SECOND_PASS = (
    "Tu es un paléographe. On te montre une DÉCOUPE AGRANDIE d'un document ancien, centrée sur un passage difficile. "
    "Relis uniquement ce passage en examinant chaque lettre. Compare les formes de lettres avec les mots de référence du même "
    "document (lus avec certitude) qui te sont fournis. Le contexte historique peut orienter, jamais prouver. "
    "Ne choisis pas une lecture parce qu'elle est plausible : choisis ce qui est écrit. Si tu ne peux pas trancher, dis-le. "
    "Réponds UNIQUEMENT en JSON : "
    '{"readings": [{"text": "lecture", "confidence": 0.0-1.0, "evidence": "formes de lettres observées"}], '
    '"best": "lecture la plus probable ou null", "agrees_with_initial": true|false, "can_decide": true|false, "notes": "…"}'
)


def second_pass_prompt(*, passage: str, line_text: str, alternatives: list[str], reference_words: list[str],
                       scribe_context: str, guidance: str) -> str:
    parts = [f"Passage à relire (lecture initiale, incertaine) : « {passage} ».",
             f"Ligne complète telle que lue : « {line_text} ».",
             "Lectures alternatives déjà envisagées : " + (", ".join(f"« {a} »" for a in alternatives) if alternatives else "aucune") + "."]
    if reference_words:
        parts.append("Mots du même document lus avec certitude (pour comparer les formes de lettres) : "
                     + ", ".join(f"« {w} »" for w in reference_words[:40]) + ".")
    if scribe_context:
        parts.append(scribe_context)
    if guidance:
        parts.append("Rappel des pièges de cette écriture :\n" + guidance)
    return "\n".join(parts)


SYSTEM_PHOTO = (
    "Tu analyses une photographie ancienne pour un généalogiste. Réponds UNIQUEMENT en JSON strict.\n"
    "INTERDICTION ABSOLUE : n'identifie JAMAIS une personne à partir de son visage ou de son apparence, ne donne aucun nom, "
    "aucune ressemblance (« ressemble à », « probablement le même que »), aucune estimation d'identité. Si une inscription visible "
    "porte un nom, recopie seulement l'inscription telle qu'elle est écrite, sans affirmer qu'elle désigne une personne représentée.\n"
    "Décris : éléments visibles, nombre de personnes et pour chacune sa position, ses vêtements, ses objets et sa posture ; "
    "inscriptions (recto, verso, cadre) avec coordonnées ; cachet ou marque du photographe ; indices géographiques ; "
    "période approximative avec les indices qui la justifient (format du tirage, mode vestimentaire, procédé). "
    "Ne présente jamais une estimation comme une certitude.\n"
    "Schéma : {\"description\": \"…\", \"visible_elements\": [\"…\"], \"people_count\": 0, "
    "\"people\": [{\"position\": \"debout à gauche…\", \"clothing\": \"…\", \"objects\": \"…\", \"posture\": \"…\", \"apparent_age_group\": \"enfant|adolescent|adulte|âgé|inconnu\"}], "
    "\"inscriptions\": [{\"text\": \"tel qu'écrit\", \"location\": \"recto bas, verso…\", \"box_2d\": [ymin, xmin, ymax, xmax], \"uncertain\": false, \"alternatives\": []}], "
    "\"photographer_stamp\": {\"text\": null, \"studio\": null, \"city\": null}, \"geographic_clues\": [\"…\"], "
    "\"period_estimate\": {\"range\": \"ex. 1890-1910\", \"clues\": [\"…\"], \"confidence\": \"low|medium|high\"}, "
    "\"photo_format\": \"carte de visite, carte album, tirage argentique, carte postale…\", \"condition\": \"…\", \"warnings\": [\"…\"]}"
)

PHOTO_NO_FACE_RULE = "n'identifie JAMAIS une personne à partir de son visage"

MANUAL_INTRO = (
    "Je vais joindre l'image d'un document d'archives ancien. Suis exactement les consignes ci-dessous et réponds "
    "uniquement par l'objet JSON demandé (sans texte autour).\n\n"
)
