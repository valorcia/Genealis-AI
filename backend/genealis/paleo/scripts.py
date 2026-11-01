"""Catalogue des écritures et des langues des documents anciens, avec des consignes de lecture propres à chacune.

Aucun modèle ne lit « tout » aussi bien : la consigne envoyée au modèle dépend de l'écriture et de la langue
identifiées (ou indiquées par l'utilisateur). Les indications ci-dessous sont des aides de lecture (pièges connus,
abréviations courantes, formules) ; elles ne remplacent jamais ce qui est réellement visible sur l'image.
"""
from __future__ import annotations

from typing import Any

# ---------------------------------------------------------------- langues
LANGUAGES: dict[str, str] = {
    "fr": "Français (ancien et moderne)",
    "la": "Latin (ecclésiastique, notarial)",
    "de": "Allemand",
    "it": "Italien",
    "pl": "Polonais",
    "ru": "Russe",
    "uk": "Ukrainien / ruthène",
    "nl": "Néerlandais / flamand",
    "es": "Espagnol",
    "en": "Anglais",
    "oc": "Occitan",
    "unknown": "Langue non déterminée",
}

# ---------------------------------------------------------------- écritures
# Chaque entrée : libellé, période indicative, langues habituelles, pièges de lecture (formes de lettres),
# abréviations courantes (forme → développement), vocabulaire / formules typiques (terme → sens).
SCRIPTS: dict[str, dict[str, Any]] = {
    "french_cursive": {
        "label": "Cursive française ancienne (XVIIe–XIXe s.)",
        "period": "1600–1900",
        "languages": ["fr", "la", "oc"],
        "letterforms": [
            "s long (ſ) en début et milieu de mot, facile à confondre avec f (le f porte une barre qui traverse la haste, le ſ seulement une amorce à gauche)",
            "u et v, i et j sont interchangeables (« vn » = un, « iour » = jour) : transcrire tel quel",
            "e rond parfois réduit à une boucle ; r final en forme de crochet ; x final proche d'un z",
            "d à haste recourbée vers la gauche ; h et g avec boucles descendantes qui touchent la ligne suivante",
            "majuscules ornées et peu distinctes (I/J, L/S, C/G) : vérifier avec d'autres occurrences du même scribe",
            "accents rares ou absents, apostrophes absentes (« lan » = l'an), mots soudés ou coupés arbitrairement",
            "chiffres et dates souvent en toutes lettres (« mil six cent cinquante ») ; mois en abrégé numérique : 7bre, 8bre, 9bre, Xbre",
        ],
        "abbreviations": {
            "led.": "ledit", "lad.": "ladite", "lesd.": "lesdits", "dud.": "dudit", "susd.": "susdit",
            "pnt / pnte": "présent / présente", "Me": "maître", "Mre": "messire", "Sr / sr": "sieur",
            "hble": "honorable", "hon.": "honnête", "dlle / damlle": "demoiselle", "par.": "paroisse",
            "bapt.": "baptisé", "q / q̃": "que", "pr": "pour / par", "nre": "notaire",
            "7bre / 8bre / 9bre / Xbre": "septembre / octobre / novembre / décembre",
            "trait ou tilde sur une voyelle": "m ou n omis (« cõme » = comme)",
        },
        "vocabulary": {
            "a esté baptisé(e)": "a été baptisé(e)", "fils / fille légitime de": "enfant né d'un couple marié",
            "parrain / marraine": "témoins religieux du baptême", "feu / feue / défunt": "décédé(e) à la date de l'acte",
            "a déclaré ne savoir signer": "la personne ne sait pas signer (information utile)",
            "manouvrier / laboureur": "ouvrier agricole / paysan propriétaire d'un attelage",
        },
    },
    "secretary": {
        "label": "Écriture secrétaire (XVIe–début XVIIe s.)",
        "period": "1500–1650",
        "languages": ["fr", "la"],
        "letterforms": [
            "écriture très liée : les lettres se fondent, compter les jambages (m, n, u, i) un par un",
            "e souvent tracé « à l'envers » comme un petit o ouvert ; r en forme de 2 après o",
            "s final en forme de 6 ou de sigma ; ſ long en début de mot",
            "abréviations par suspension (mot tronqué) et par contraction (lettres du milieu omises, signalées par un trait)",
        ],
        "abbreviations": {"ꝑ": "par / per", "ꝓ": "pro", "q̃": "que", "nre": "notre", "led.": "ledit"},
        "vocabulary": {"honneste personne": "formule de politesse (milieu modeste ou marchand)"},
    },
    "humanistic": {
        "label": "Écriture humanistique / italique (XVe–XVIIe s.)",
        "period": "1450–1700",
        "languages": ["la", "it", "fr"],
        "letterforms": [
            "lettres séparées, proches des caractères d'imprimerie romains ; ſ long fréquent",
            "& et la note tironienne ⁊ pour « et » ; æ / œ souvent écrits e (e cédillé ę)",
        ],
        "abbreviations": {"ꝑ": "per", "ꝓ": "pro", "q;": "que", "Dñs": "Dominus"},
        "vocabulary": {},
    },
    "gothic_textura": {
        "label": "Gothique allemande (manuscrite) et Fraktur imprimée",
        "period": "1400–1940",
        "languages": ["de", "la"],
        "letterforms": [
            "Fraktur : ſ long et f se distinguent par la barre (le f est barré des deux côtés)",
            "Fraktur : k / t / f / ſ et r rond (ꝛ) se confondent sur une impression usée",
            "le Umlaut s'écrit souvent avec un petit e au-dessus (aͤ, oͤ, uͤ) : transcrire ä, ö, ü dans la version normalisée",
            "les noms propres et les mots latins sont souvent composés en caractères romains au milieu du texte gothique",
        ],
        "abbreviations": {"geb.": "geboren / geborene", "ehel.": "ehelich", "dto.": "ditto (idem)"},
        "vocabulary": {},
    },
    "kurrent": {
        "label": "Kurrent (cursive allemande, XVIe–XXe s.)",
        "period": "1500–1945",
        "languages": ["de"],
        "letterforms": [
            "le e ressemble à un n latin (deux petits jambages) : « e » et « n » sont les confusions les plus fréquentes",
            "le u porte un arc (brève ˘) au-dessus qui le distingue du n ; sans arc, lire n",
            "ſ long en début et milieu de syllabe, s rond en fin de mot ; ß (ſz) en fin de syllabe",
            "h descend sous la ligne avec une boucle ; g et j aussi : ne pas les confondre",
            "r ressemble à un petit w ou à un n pointu ; c est un simple crochet",
            "m et n sont faits de jambages pointus : compter les pointes",
            "les noms propres, lieux et mots latins ou français sont souvent écrits en écriture latine au milieu du Kurrent",
        ],
        "abbreviations": {
            "geb.": "geboren / geborene (née)", "ehel.": "ehelich (légitime)", "S.": "Sohn (fils)", "T.": "Tochter (fille)",
            "verh.": "verheiratet (marié)", "ev. / luth. / kath.": "évangélique / luthérien / catholique",
            "dto. / do.": "ditto (idem)", "Jgfr.": "Jungfrau (jeune fille)",
        },
        "vocabulary": {
            "getauft": "baptisé", "Taufpaten / Gevattern": "parrains et marraines", "ehelicher Sohn / eheliche Tochter": "fils / fille légitime",
            "Eheleute": "époux", "gestorben / begraben": "mort / inhumé", "copuliert / getraut": "marié", "Witwe / Wittwer": "veuve / veuf",
            "ledig": "célibataire", "Hebamme": "sage-femme", "Inwohner / Taglöhner / Bauer": "habitant / journalier / paysan",
        },
    },
    "suetterlin": {
        "label": "Sütterlin (écriture scolaire allemande, 1915–1941)",
        "period": "1915–1945",
        "languages": ["de"],
        "letterforms": [
            "plus droite, plus ronde et plus régulière que le Kurrent, mêmes pièges : e ≈ n, u surmonté d'un arc",
            "ſ long en début de syllabe, s rond en fin de mot ; h à boucle descendante",
            "majuscules très différentes de l'alphabet latin (A, D, G, H, S) : comparer avec un tableau de l'alphabet Sütterlin",
        ],
        "abbreviations": {"geb.": "geboren / geborene", "verh.": "verheiratet"},
        "vocabulary": {},
    },
    "latin_ecclesiastical": {
        "label": "Latin des registres paroissiaux",
        "period": "1550–1900",
        "languages": ["la"],
        "letterforms": [
            "écriture du scribe local (française, italienne, allemande ou polonaise) : appliquer aussi les pièges de cette écriture",
            "terminaisons abrégées par un trait ou une boucle : -us, -um, -orum, -is",
        ],
        "abbreviations": {
            "bapt.": "baptizatus / baptizata", "fil. leg.": "filius / filia legitima", "q. / qm / quond.": "quondam (feu, défunt)",
            "D. / Dnus / Dñus": "Dominus (le sieur, titre)", "pbr / presb.": "presbyter (prêtre)", "parochus / par.": "curé",
            "Ecclae / Eccl.": "ecclesiae", "ann. / an.": "annorum (âgé de … ans)", "eiusd. / hui.": "eiusdem / huius (du même / de ce)",
            "7bris / 8bris / 9bris / Xbris": "septembris / octobris / novembris / decembris",
        },
        "vocabulary": {
            "baptizatus est / baptizata est": "a été baptisé(e)", "filius legitimus / filia legitima": "fils / fille légitime",
            "ex legitimo matrimonio": "né(e) d'un mariage légitime", "patrini / patrinus / matrina": "parrains / parrain / marraine",
            "susceptores / levantes": "parrains (ceux qui ont tenu l'enfant)", "conjuges": "époux", "sepultus est / obiit": "a été inhumé / est mort",
            "annorum circiter": "âgé d'environ … ans", "matrimonio juncti sunt": "ont été unis par le mariage",
            "praemissis tribus denuntiationibus": "après la publication des trois bans", "testes": "témoins", "vidua": "veuve",
            "ego infrascriptus parochus": "moi, curé soussigné", "hujus parochiae": "de cette paroisse",
            "noms déclinés": "les noms propres sont au génitif ou à l'ablatif (« filius Joannis » = fils de Jean) : garder la forme écrite dans la transcription diplomatique, mettre le nominatif dans la version normalisée",
            "prénoms latinisés": "Joannes = Jean / Johann / Jan / Giovanni ; Jacobus = Jacques / Jakob / Jakub ; Adalbertus = Wojciech ; Hedwigis = Jadwiga ; Ludovicus = Louis",
        },
    },
    "italian_cursive": {
        "label": "Italien historique (état civil, registres paroissiaux)",
        "period": "1600–1930",
        "languages": ["it", "la"],
        "letterforms": [
            "registres d'état civil du XIXe s. souvent sur formulaires imprimés remplis à la main : distinguer l'imprimé du manuscrit",
            "ſ long et doubles consonnes abrégées par un trait ; z et r peu distincts ; « ss » écrit « ſs »",
        ],
        "abbreviations": {"fu / fù / q.m": "feu, défunt (« figlio del fu Giovanni »)", "D. / Don": "titre (Don)", "Sig.": "signor",
                          "detto / d.to": "dit (surnom)", "nata": "née (nom de jeune fille)"},
        "vocabulary": {
            "di anni": "âgé de … ans", "figlio di / figlia di": "fils / fille de", "Giuseppe di Antonio": "Giuseppe fils d'Antonio (patronyme)",
            "atto di nascita / di matrimonio / di morte": "acte de naissance / mariage / décès", "ufficiale dello stato civile": "officier d'état civil",
            "testimoni": "témoins", "sposi": "époux", "vedova di": "veuve de", "contadino / bracciante / possidente": "paysan / journalier / propriétaire",
            "domiciliato": "domicilié",
        },
    },
    "polish_cursive": {
        "label": "Polonais ancien (registres paroissiaux et d'état civil)",
        "period": "1600–1930",
        "languages": ["pl", "la", "ru"],
        "letterforms": [
            "orthographe ancienne : y pour j, ł parfois sans barre, ą / ę souvent sans ogonek : transcrire tel quel",
            "après 1868, en Pologne du Congrès, les actes sont rédigés en russe (cyrillique) même si les noms sont polonais",
            "avant 1808 et en Galicie, registres souvent en latin avec des noms polonais",
        ],
        "abbreviations": {"wś / wsi": "village", "ur.": "urodzony / urodzona (né)", "zm.": "zmarł / zmarła (mort)", "lat": "âgé de … ans"},
        "vocabulary": {
            "syn / córka": "fils / fille", "świadkowie": "témoins", "rodzice chrzestni / chrzestni": "parrain et marraine",
            "ochrzczony / ochrzczona": "baptisé(e)", "małżonkowie": "époux", "wdowa / wdowiec": "veuve / veuf", "z domu": "née (nom de jeune fille)",
            "Działo się we wsi …": "formule d'ouverture des actes de 1808 à 1868 (« Fait au village de … »)",
            "włościanin / gospodarz / parobek": "paysan / chef d'exploitation / valet de ferme",
            "-ska / -cka, -owa, -ówna": "formes féminines : -owa = épouse de, -ówna = fille de (le nom de famille change selon la personne)",
        },
    },
    "cyrillic_cursive": {
        "label": "Cyrillique historique (avant la réforme de 1918)",
        "period": "1700–1918",
        "languages": ["ru", "uk"],
        "letterforms": [
            "lettres disparues en 1918 : ѣ (yat), і (i décimal), ѳ (fita), ѵ (ijitsa) ; ъ obligatoire en fin de mot après consonne",
            "en cursive, т ressemble à un m latin, и à un u, д à un g ou ∂, л et м commencent par un petit crochet",
            "dates selon le calendrier julien (ancien style) : ajouter 10 jours (XVIIIe), 12 jours (XIXe) ou 13 jours (1900–1918) pour le calendrier grégorien — l'indiquer, ne jamais convertir silencieusement",
        ],
        "abbreviations": {"г.": "год / года (année)", "крест.": "крестьянин (paysan)", "мѣщ.": "мещанин (bourgeois de ville)"},
        "vocabulary": {
            "метрическая книга": "registre paroissial (naissances, mariages, décès)", "родившіеся / бракосочетавшіеся / умершіе": "naissances / mariages / décès",
            "восприемники": "parrain et marraine", "законный бракъ": "mariage légitime", "сынъ / дочь": "fils / fille",
            "вдова / вдовецъ": "veuve / veuf", "лѣтъ": "âgé de … ans", "отчество (-овичъ / -овна)": "patronyme (fils / fille de)",
        },
    },
    "print": {
        "label": "Imprimé (formulaire, journal, faire-part)",
        "period": "1500–aujourd'hui",
        "languages": ["fr", "de", "it", "pl", "la", "en"],
        "letterforms": ["distinguer le texte imprimé (formulaire) des mentions manuscrites ajoutées : les signaler séparément"],
        "abbreviations": {},
        "vocabulary": {},
    },
    "typewritten": {
        "label": "Dactylographié",
        "period": "1880–aujourd'hui",
        "languages": ["fr", "de", "it", "pl", "en"],
        "letterforms": ["lettres frappées deux fois ou corrigées à la main : transcrire la correction et la signaler"],
        "abbreviations": {},
        "vocabulary": {},
    },
    "unknown": {
        "label": "Écriture non déterminée",
        "period": "",
        "languages": [],
        "letterforms": [],
        "abbreviations": {},
        "vocabulary": {},
    },
}

# Abréviations transversales (notariales et ecclésiastiques), ajoutées quand la langue ou le type d'acte s'y prête
ABBREVIATION_SETS: dict[str, dict[str, Any]] = {
    "notarial_fr": {
        "label": "Abréviations notariales françaises",
        "items": {
            "led. / lad. / lesd.": "ledit / ladite / lesdits", "susd. / susnommé": "susdit / susnommé", "pnt / pntes": "présent / présentes",
            "nre / not.": "notaire", "tesm. / tes.": "témoins", "hble homme": "honorable homme", "icelle / ycelle": "celle-ci",
            "l. / lt / s. / d.": "livres / livres tournois / sols / deniers", "fo / fol.": "folio", "r° / v°": "recto / verso",
        },
    },
    "ecclesiastical_la": {
        "label": "Abréviations ecclésiastiques latines",
        "items": {
            "bapt.": "baptizatus", "fil. leg.": "filius legitimus", "q. / qm": "quondam (défunt)", "pbr": "presbyter",
            "Dnus / D.": "Dominus", "Ecclae": "ecclesiae", "ann.": "annorum", "Xbris": "decembris", "ꝑ": "per", "ꝓ": "pro",
        },
    },
}

SCRIPT_ALIASES = {
    "cursive": "french_cursive", "french": "french_cursive", "francaise": "french_cursive", "française": "french_cursive",
    "gothic": "gothic_textura", "fraktur": "gothic_textura", "gothique": "gothic_textura", "sutterlin": "suetterlin",
    "sütterlin": "suetterlin", "latin": "latin_ecclesiastical", "italian": "italian_cursive", "italien": "italian_cursive",
    "polish": "polish_cursive", "polonais": "polish_cursive", "cyrillic": "cyrillic_cursive", "cyrillique": "cyrillic_cursive",
    "printed": "print", "imprimé": "print", "typed": "typewritten", "humanist": "humanistic", "italic": "humanistic",
}
LANG_ALIASES = {"french": "fr", "latin": "la", "german": "de", "italian": "it", "polish": "pl", "russian": "ru",
                "français": "fr", "allemand": "de", "italien": "it", "polonais": "pl", "russe": "ru", "lat": "la"}


def normalize_script(value: Any) -> str | None:
    t = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    if not t or t in ("null", "none"):
        return None
    t = SCRIPT_ALIASES.get(t, t)
    return t if t in SCRIPTS else "unknown"


def normalize_language(value: Any) -> str | None:
    t = str(value or "").strip().lower()
    if not t or t in ("null", "none", "?"):
        return None
    t = LANG_ALIASES.get(t, t)
    t = t.split("-")[0][:8]
    return t if t in LANGUAGES else t[:8]


def catalog() -> dict:
    """Catalogue exposé à l'interface (libellés français)."""
    return {
        "scripts": [{"id": k, "label": v["label"], "period": v["period"], "languages": v["languages"],
                     "letterforms": v["letterforms"], "abbreviations": v["abbreviations"], "vocabulary": v["vocabulary"]}
                    for k, v in SCRIPTS.items()],
        "languages": [{"id": k, "label": v} for k, v in LANGUAGES.items()],
        "abbreviation_sets": [{"id": k, "label": v["label"], "items": v["items"]} for k, v in ABBREVIATION_SETS.items()],
    }


def _fmt_map(d: dict[str, str], limit: int = 14) -> str:
    return " ; ".join(f"« {k} » = {v}" for k, v in list(d.items())[:limit])


def script_guidance(script_type: str | None, language: str | None = None) -> str:
    """Consignes détaillées pour une écriture connue (ou indiquée), sinon résumé de toutes les écritures."""
    st = normalize_script(script_type)
    lang = normalize_language(language)
    if not st or st == "unknown":
        lines = ["Identifie d'abord l'écriture parmi : " + ", ".join(f"{k} ({v['label']})" for k, v in SCRIPTS.items()) + "."]
        lines.append("Pièges principaux par écriture :")
        for k, v in SCRIPTS.items():
            if v["letterforms"]:
                lines.append(f"- {k} : {v['letterforms'][0]}")
        lines.append("Si le texte est en latin, les noms propres sont déclinés (génitif, ablatif) ; en italien « fu » = défunt ; "
                     "en polonais -owa = épouse de, -ówna = fille de ; en cyrillique ancien, dates du calendrier julien.")
        return "\n".join(lines)
    s = SCRIPTS[st]
    out = [f"Écriture : {s['label']} (période indicative {s['period'] or 'inconnue'})."]
    if s["letterforms"]:
        out.append("Pièges de lecture (formes de lettres) :\n" + "\n".join(f"- {x}" for x in s["letterforms"]))
    if s["abbreviations"]:
        out.append("Abréviations courantes : " + _fmt_map(s["abbreviations"]) + ".")
    if s["vocabulary"]:
        out.append("Formules et vocabulaire typiques : " + _fmt_map(s["vocabulary"]) + ".")
    if lang == "la" and st != "latin_ecclesiastical":
        v = SCRIPTS["latin_ecclesiastical"]
        out.append("Le texte est en latin : " + _fmt_map(v["vocabulary"], 8) + ".")
        out.append("Abréviations : " + _fmt_map(ABBREVIATION_SETS["ecclesiastical_la"]["items"]) + ".")
    if lang == "fr" or st in ("french_cursive", "secretary"):
        out.append("Actes notariés : " + _fmt_map(ABBREVIATION_SETS["notarial_fr"]["items"]) + ".")
    out.append("Ces indications aident à lire ; elles ne prouvent jamais une lecture : seule l'image fait foi.")
    return "\n".join(out)
