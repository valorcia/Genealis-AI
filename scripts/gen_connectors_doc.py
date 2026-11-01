"""Génère ARCHIVE_CONNECTORS.md à partir du registre réel des connecteurs (jamais rédigé à la main)."""
from __future__ import annotations

import os
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
os.environ.setdefault("GENEALIS_DATA_DIR", str(ROOT / "backend" / "genealis_data_tmp"))

from genealis.connectors import registry_service  # noqa: E402,F401
from genealis.connectors.base import registry  # noqa: E402

MODE = {"api": "API documentée", "html": "Lecture de pages HTML (expérimental)", "browser": "Navigateur (assisté)", "manual": "Import manuel"}
COUNTRY = {"FR": "France", "IT": "Italie", "PL": "Pologne", "BE": "Belgique", "LU": "Luxembourg", "DE": "Allemagne", "CH": "Suisse",
           "AT": "Autriche", "CZ": "Tchéquie", "SK": "Slovaquie", "HU": "Hongrie", "ES": "Espagne", "PT": "Portugal", "GB": "Royaume-Uni",
           "US": "États-Unis", "CA": "Canada", "*": "International / plateformes"}

lines = [
    "# ARCHIVE_CONNECTORS.md — Sources réellement intégrées et capacités vérifiées",
    "",
    f"_Généré le {date.today():%d/%m/%Y} par `scripts/gen_connectors_doc.py` à partir du registre des connecteurs._",
    "",
    "## Principe d'honnêteté",
    "",
    "- **Aucun connecteur n'est affiché comme opérationnel tant que son test réel (`POST /api/research/connectors/{id}/test`) n'a pas réussi** depuis la machine de l'utilisateur. Le statut par défaut est « non testé ».",
    "- L'environnement de développement cloud où ce projet a été construit **bloquait l'accès réseau à tous les sites d'archives** (seuls les dépôts de paquets étaient joignables). Les capacités ci-dessous sont donc déclarées d'après la documentation publique de chaque service et **doivent être validées depuis votre poste** via le tableau de bord « Enquêtes IA → Connecteurs ».",
    "- Aucun contournement de CAPTCHA, d'authentification ou de protection anti-robot n'est implémenté ; `robots.txt` est consulté avant toute lecture HTML.",
    "- Tous les connecteurs sont **gratuits et sans clé API**. Les modes « navigateur » ouvrent la bonne page de recherche ; l'acte est ensuite importé manuellement pour analyse.",
    "",
    "## Synthèse",
    "",
    "| Mode d'accès | Nombre |",
    "|---|---|",
]
counts: dict[str, int] = {}
for c in registry.all():
    counts[c.capabilities.access_mode] = counts.get(c.capabilities.access_mode, 0) + 1
for k, v in counts.items():
    lines.append(f"| {MODE.get(k, k)} | {v} |")
lines += ["", f"Total : {len(registry.all())} connecteurs.", ""]

by_country: dict[str, list] = {}
for c in registry.all():
    by_country.setdefault(c.capabilities.country, []).append(c)
order = ["FR", "IT", "PL", "BE", "LU", "DE", "CH", "AT", "CZ", "SK", "HU", "ES", "PT", "GB", "US", "CA", "*"]
for cc in order + [k for k in by_country if k not in order]:
    if cc not in by_country:
        continue
    lines += [f"## {COUNTRY.get(cc, cc)}", ""]
    for c in sorted(by_country[cc], key=lambda x: (x.capabilities.access_mode not in ('api', 'html'), x.capabilities.name)):
        k = c.capabilities
        period = f"{k.period_start or '…'} – {k.period_end or 'aujourd’hui'}"
        lines += [f"### {k.name} (`{k.id}`)", "",
                  f"- **Organisme** : {k.organization}",
                  f"- **Mode d'accès** : {MODE.get(k.access_mode, k.access_mode)}" + (" — identifiants requis" if k.requires_credentials else " — gratuit, sans clé"),
                  f"- **Collections** : {'; '.join(k.collections)}",
                  f"- **Zones** : {', '.join(k.areas)} · **Période** : {period} · **Langues** : {', '.join(k.languages)}",
                  f"- **Champs de recherche** : {', '.join(k.search_fields) or '—'}",
                  f"- **Formats** : {', '.join(k.formats)}",
                  f"- **Limites** : {' / '.join(k.limitations) or '—'}",
                  f"- **Droits** : {k.reuse_terms}" + (f" ([conditions]({k.terms_url}))" if k.terms_url else ""),
                  f"- **Site** : {k.homepage}",
                  f"- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.",
                  f"- **Notes** : {k.notes}" if k.notes else "",
                  ""]
out = ROOT / "ARCHIVE_CONNECTORS.md"
out.write_text("\n".join(l for l in lines if l is not None), encoding="utf-8")
print(f"{out} : {len(registry.all())} connecteurs documentés")
