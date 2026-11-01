"""Repères généraux pour le livre (connaissances historiques générales rédigées pour GENEALIS).

Rien ici ne concerne une personne de l'arbre : ce sont des notes de contexte, affichées dans des encadrés
étiquetés « Repère général », séparés des faits tirés des actes.
"""
from __future__ import annotations

# Régions reconnues à partir du département / de la région / du pays d'un lieu
REGION_DEPARTMENTS = {
    "lorraine": ["meurthe-et-moselle", "meurthe", "moselle", "meuse", "vosges", "lorraine"],
    "alsace": ["bas-rhin", "haut-rhin", "alsace"],
}

# « La vie de tous les jours » : notes générales par période (France), puis variantes régionales prioritaires.
DAILY_LIFE: list[dict] = [
    {"start": 1600, "end": 1714, "region": "FR", "title": "Au XVIIe siècle",
     "text": "La plupart des familles vivent de la terre et dépendent des récoltes de céréales : une mauvaise année peut entraîner disette et forte mortalité. La paroisse rythme la vie, avec le baptême donné le jour même ou le lendemain de la naissance, la messe du dimanche et les fêtes religieuses. Une grande partie des enfants n'atteint pas l'âge adulte."},
    {"start": 1600, "end": 1697, "region": "lorraine", "title": "La Lorraine du XVIIe siècle",
     "text": "Indépendant du royaume de France, le duché de Lorraine est ravagé pendant la guerre de Trente Ans par les passages de troupes, la peste et la famine ; de nombreux villages sont alors dépeuplés. Le duché est ensuite occupé à plusieurs reprises par les armées françaises, jusqu'au traité de Ryswick en 1697."},
    {"start": 1715, "end": 1788, "region": "FR", "title": "Au XVIIIe siècle",
     "text": "La vie rurale reste organisée autour de la communauté villageoise et de la paroisse. On se marie tard, vers 25 ans pour les femmes et 27 ans pour les hommes, le plus souvent avec un conjoint du même village ou des environs. Le curé tient les registres de baptêmes, mariages et sépultures, et la capacité à signer progresse, surtout chez les hommes."},
    {"start": 1698, "end": 1766, "region": "lorraine", "title": "La Lorraine des ducs Léopold et Stanislas",
     "text": "Après les guerres du siècle précédent, le duc Léopold encourage la reconstruction et le repeuplement des villages, où s'installent des familles venues de régions voisines. Sous Stanislas, beau-père de Louis XV, la Lorraine se prépare à devenir française, ce qui arrive à sa mort en 1766."},
    {"start": 1789, "end": 1815, "region": "FR", "title": "Révolution et Empire",
     "text": "En 1792, la tenue de l'état civil passe du curé à un officier municipal, et le calendrier républicain est utilisé dans les actes jusqu'à la fin de 1805. La conscription, instituée en 1798, puis les guerres de l'Empire appellent un grand nombre de jeunes hommes sous les drapeaux."},
    {"start": 1816, "end": 1870, "region": "FR", "title": "Le XIXe siècle rural",
     "text": "La population des campagnes atteint son maximum vers le milieu du siècle. Beaucoup de familles complètent le travail des champs par un artisanat à domicile (tissage, broderie, vannerie). La loi Guizot de 1833 oblige chaque commune à entretenir une école primaire de garçons, et le chemin de fer atteint les villes à partir des années 1850."},
    {"start": 1871, "end": 1913, "region": "FR", "title": "La Belle Époque",
     "text": "L'école primaire devient gratuite en 1881, puis obligatoire et laïque en 1882 pour les enfants de 6 à 13 ans. Le chemin de fer relie peu à peu bourgs et villes, et le service militaire se généralise à tous les jeunes hommes. Beaucoup de ruraux partent vers les villes et les usines."},
    {"start": 1871, "end": 1913, "region": "lorraine", "title": "La Lorraine coupée en deux",
     "text": "Après 1871, la nouvelle frontière franco-allemande traverse la Lorraine : la Moselle est annexée à l'Empire allemand, tandis que les arrondissements restés français forment la Meurthe-et-Moselle. Le chemin de fer relie les villages aux villes, l'école devient gratuite et obligatoire (1881-1882), et le bassin de Briey et de Longwy devient l'un des grands centres sidérurgiques d'Europe."},
    {"start": 1914, "end": 1918, "region": "FR", "title": "La Grande Guerre",
     "text": "La plupart des hommes en âge de combattre sont mobilisés ; les femmes, les enfants et les anciens assurent les travaux des champs et des usines. Environ 1,4 million de soldats français meurent pendant le conflit."},
    {"start": 1919, "end": 1938, "region": "FR", "title": "L'entre-deux-guerres",
     "text": "Les régions dévastées se reconstruisent et l'électricité gagne les campagnes. La journée de huit heures est votée en 1919 et les premiers congés payés sont accordés en 1936."},
    {"start": 1939, "end": 1945, "region": "FR", "title": "La Seconde Guerre mondiale",
     "text": "Sous l'Occupation, le rationnement et les cartes d'alimentation touchent tous les foyers. Environ 1,8 million de soldats français sont faits prisonniers en 1940, et beaucoup restent en captivité jusqu'en 1945."},
    {"start": 1946, "end": 1975, "region": "FR", "title": "Les Trente Glorieuses",
     "text": "La vie quotidienne se transforme : Sécurité sociale (1945), mécanisation de l'agriculture, exode rural, arrivée de l'automobile, de la télévision et de l'électroménager dans les foyers."},
]

# Repères historiques régionaux (pour « Mon époque » et l'annexe des villages)
REGIONAL_TIMELINE: list[dict] = [
    {"start": 1618, "end": 1648, "region": "lorraine", "label": "Guerre de Trente Ans",
     "text": "La Lorraine est ravagée par les armées, la peste et la famine ; une grande partie de la population disparaît."},
    {"start": 1670, "end": 1697, "region": "lorraine", "label": "Occupation française du duché",
     "text": "Louis XIV occupe le duché de Lorraine ; le traité de Ryswick (1697) le rend au duc Léopold."},
    {"start": 1698, "end": 1729, "region": "lorraine", "label": "Règne du duc Léopold",
     "text": "Reconstruction de la Lorraine : repeuplement des villages, routes et manufactures."},
    {"start": 1737, "end": 1766, "region": "lorraine", "label": "Stanislas, duc de Lorraine",
     "text": "Stanislas Leszczynski, beau-père de Louis XV, règne sur la Lorraine ; à sa mort en 1766, le duché devient français."},
    {"start": 1790, "end": 1790, "region": "lorraine", "label": "Création des départements",
     "text": "La Lorraine est divisée en quatre départements : Meurthe, Moselle, Meuse et Vosges."},
    {"start": 1871, "end": 1871, "region": "lorraine", "label": "Traité de Francfort",
     "text": "La Moselle et une partie de la Meurthe sont annexées à l'Empire allemand ; le reste forme la Meurthe-et-Moselle."},
    {"start": 1914, "end": 1914, "region": "lorraine", "label": "Batailles de Lorraine",
     "text": "Août-septembre 1914 : combats de Morhange, de la trouée de Charmes et du Grand-Couronné, qui protège Nancy."},
    {"start": 1940, "end": 1944, "region": "lorraine", "label": "Annexion de fait de la Moselle",
     "text": "La Moselle est annexée de fait par l'Allemagne nazie ; le reste de la Lorraine est occupé jusqu'à la Libération (Nancy, 15 septembre 1944)."},
    {"start": 1648, "end": 1648, "region": "alsace", "label": "Traités de Westphalie",
     "text": "Une grande partie de l'Alsace passe sous souveraineté française."},
    {"start": 1871, "end": 1918, "region": "alsace", "label": "Alsace annexée",
     "text": "L'Alsace est annexée à l'Empire allemand jusqu'en 1918."},
    {"start": 1940, "end": 1944, "region": "alsace", "label": "Annexion de fait",
     "text": "L'Alsace est annexée de fait par l'Allemagne nazie ; de nombreux jeunes hommes sont incorporés de force."},
    {"start": 1693, "end": 1694, "region": "FR", "label": "Grande famine",
     "text": "Après de mauvaises récoltes, la famine et les épidémies tuent plus d'un million de personnes dans le royaume."},
    {"start": 1709, "end": 1709, "region": "FR", "label": "Grand Hiver",
     "text": "Un froid exceptionnel détruit les semences et les arbres fruitiers, suivi d'une disette."},
    {"start": 1832, "end": 1832, "region": "FR", "label": "Épidémie de choléra",
     "text": "Le choléra touche la France et fait des dizaines de milliers de morts."},
    {"start": 1848, "end": 1848, "region": "FR", "label": "Révolution de 1848",
     "text": "Proclamation de la IIe République, suffrage universel masculin et abolition de l'esclavage."},
    {"start": 1881, "end": 1882, "region": "FR", "label": "Lois Jules Ferry",
     "text": "L'école primaire devient gratuite, obligatoire et laïque."},
    {"start": 1905, "end": 1905, "region": "FR", "label": "Séparation des Églises et de l'État",
     "text": "La loi du 9 décembre 1905 sépare les Églises et l'État."},
    {"start": 1918, "end": 1919, "region": "EU", "label": "Grippe dite « espagnole »",
     "text": "La pandémie fait des centaines de milliers de morts en France."},
]


def region_of(department: str | None, region: str | None, country: str | None) -> list[str]:
    """Clés de région applicables à un lieu : ['lorraine', 'FR', 'EU'] par exemple."""
    from unidecode import unidecode

    keys: list[str] = []
    blob = unidecode(" ".join(x for x in (department, region) if x).lower())
    for key, deps in REGION_DEPARTMENTS.items():
        if any(unidecode(d) in blob for d in deps):
            keys.append(key)
    c = unidecode((country or "").lower())
    if not c or "france" in c or keys:
        keys.append("FR")
    elif "ital" in c:
        keys.append("IT")
    elif "polo" in c or "polska" in c:
        keys.append("PL")
    elif "belg" in c:
        keys.append("BE")
    keys.append("EU")
    return keys
