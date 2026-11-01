# GENEALIS AI v0.4 — Architecture et contrats entre modules

Ce document est le contrat commun des modules v0.4. Toute nouvelle table est **additive** (migration
`7b2c4e9a0f11`, non destructive). Aucune table v0.3 n'est modifiée.

## 1. Vue d'ensemble

```
             Interface (Vercel ou local)  ── Centre d'investigation, Lecteur de documents, Coûts
                          │ /api/*
       ┌──────────────────┴───────────────────────────────────────────────┐
       │ Backend FastAPI (Vercel serverless OU PC local)                  │
       │  investigation/ (RESEARCH DIRECTOR) ── queue.py (file persistante)│
       │  paleo/ (lecture des écritures anciennes)                        │
       │  services/cost.py (quotas, cache, budget)  ai/providers.py       │
       │  api/worker.py  ◄────── missions de navigation ──────┐            │
       └──────────────────────────────────────────────────────┼───────────┘
                                                              │ HTTPS + ACCESS_TOKEN
                                  ┌───────────────────────────┴────────────┐
                                  │ Worker navigateur LOCAL (PC Windows)   │
                                  │ browser/ : Playwright (déterministe)   │
                                  │          + Browser Use OSS (agent IA)  │
                                  └────────────────────────────────────────┘
```

Vercel ne peut pas exécuter de navigateur : la navigation se fait **toujours** sur le PC de l'utilisateur
(worker local), qui réserve des tâches `browse` dans la file et renvoie pages, captures et documents.
Les dépendances navigateur sont dans l'extra `pip install .[browser]` (jamais installé sur Vercel).

## 2. Tables (genealis/models/investigation.py)

| Table | Rôle |
|---|---|
| `investigations` | Enquête : personne, objectif, état, mode de coût, plafond d'appels IA, mémoire, statistiques |
| `investigation_tasks` | File persistante : kind, état, stratégie, priorité, génération, params, result, tentatives, empreinte, bail |
| `investigation_events` | Fil d'activité en temps réel |
| `page_visits` | Pages réellement ouvertes (url, issue, capture, extrait, téléchargements, alertes de sécurité) |
| `ai_call_logs` | Chaque appel IA (ok, cache_hit, quota_refused, error, rate_limited), jetons, coût estimé |
| `ai_cache` | Réponses IA réutilisées (clé = empreinte fournisseur+modèle+prompt+fichiers) |
| `document_readings` | Lecture paléographique : diplomatique, normalisée, traduction, lignes avec bbox, passages incertains |
| `reading_corrections` | Corrections humaines, réutilisées pour la même main / le même type d'écriture |
| `person_mentions` | Personnes citées dans un document (témoins, parrains…) — jamais fusionnées automatiquement |

États des enquêtes : `pending` EN ATTENTE, `running` EN COURS, `paused`, `done` TERMINÉE, `blocked` BLOQUÉE,
`to_verify` À VÉRIFIER, `failed` ÉCHEC, `stopped`. États des tâches : `pending`, `running`, `done`, `blocked`,
`to_verify`, `failed`, `cancelled`. Libellés : `models.STATUS_LABELS_FR`.

## 3. Couche IA — `AIClient.complete(...)` (genealis/ai/providers.py)

Ordre garanti pour chaque appel : protection des personnes vivantes → cache → plafonds (aucun envoi si dépassé)
→ journal des transmissions → limite de simultanéité → appel → comptage des jetons → cache.

Paramètres utiles : `purpose` (libellé court, sert au tableau des coûts), `personal`, `json_mode`, `attachments=[(octets, mime)]`,
`web_search` (Gemini + Google Search, renvoie `resp.grounding`), `cacheable` (défaut vrai sauf `purpose="test"`),
`subject_person_ids` (un document rattaché à une personne peut-être vivante n'est **jamais** envoyé sans autorisation).

Réponse : `AIResponse(text, provider, model, raw, grounding, usage, cached)`.

Exceptions (genealis/ai/errors.py) : `AIUnavailable` ⊃ `ExternalTransferRefused`, `QuotaExceeded(scope, retry_after_s)`
avec `scope` ∈ daily | minute | investigation | budget | provider | mode. **Un QuotaExceeded doit arrêter la boucle
d'enquête (état BLOQUÉE avec la raison), jamais être réessayé en boucle.**

Attribution des appels à une enquête : `with cost.ai_context(investigation_id=..., task_id=...)`.

Modes (`cost_mode`) : `free` GRATUIT (aucun service payant, pas d'Anthropic, pas de Browser Use Cloud),
`hybrid` HYBRIDE (payant seulement si budget > 0 et autorisé), `commercial` COMMERCIAL (abonnements personnels
claude.ai/chatgpt.com interdits ; comptes, quotas et coûts par `owner_id`).

Audit Gemini : `GET /api/ai/gemini/audit` (liste officielle des modèles via l'API Google, aucun appel de génération),
`POST /api/ai/gemini/audit` (2 appels de test : image + recherche Google). Les références de modèles proviennent
de l'API `models.list` de Google avec la clé de l'utilisateur ; le modèle recommandé est un « flash » multimodal.

## 4. File de tâches — genealis/investigation/queue.py

`enqueue(db, inv_id, kind, title, person_id=, params=, priority=, strategy=, generation=, parent_task_id=)` → `(task, created)`
(déduplication par empreinte : jamais deux fois la même recherche) ; `claim(db, worker, kinds=, investigation_id=, lease_s=)` ;
`heartbeat` ; `complete(db, task, result, status="done"|"to_verify"|"blocked")` ; `fail(db, task, error, retry=)` ;
`block(db, task, reason, needs_human=)` ; `requeue_expired(db)` (reprise après redémarrage) ; `emit(db, inv_id, kind, message, data, task_id)`.

Types de tâches (`kind`) et propriétaire :

| kind | Exécuté par | params → result |
|---|---|---|
| `plan` | Director | → tâches créées |
| `web_search` | Director (serveur) — connecteurs gratuits + `gemini_web` | `{query, person_id, goal}` → `{findings:[{title,url,snippet,domain}], queries, sources}` |
| `browse` | **Worker local** (browser/) | voir §5 |
| `analyze_document` | Director → `paleo.pipeline.read_document` | `{media_id}` → `{reading_id, mentions:[ids]}` |
| `verify` | Director | `{mention_ids, person_id}` → `{proposals:[…]}` |
| `witness_followup` | Director | `{mention_id}` → piste (hypothèse / question / nouvelle recherche) |
| `expand_generation` | Director | `{person_id, generation}` → nouvelles tâches pour les parents |
| `human_assist` | Utilisateur | `{reason, url}` → reprise après action humaine |

## 5. Navigation — tâche `browse` (genealis/browser/)

`params` : `{goal: str, start_url?: str, query?: str, allowed_domains?: [..], max_steps?: int, expect: "documents"|"links"|"text",
person: {given_names, surname, birth_year?, place?} (jamais de personne vivante), strategy_hint?: "playwright"|"browser_agent"}`.

`result` : `{outcome: "ok"|"blocked"|"failed", blocked_reason?, needs_human?: bool, pages: [page_visit_id], documents: [media_id],
findings: [{title, url, snippet, archival_reference?}], strategy_used, steps, notes}`.

Stratégies, de la moins chère à la plus chère : 1 `web_search` (serveur), 2 `playwright` (recette déterministe, 0 appel IA),
3 `browser_agent` (Browser Use + Gemini, plafonné en étapes), 4 `human` (pause, l'utilisateur agit, puis reprise).

Sécurité obligatoire : schémas http/https uniquement ; refus des adresses internes (loopback, privées, link-local,
métadonnées cloud) après résolution DNS ; refus `file:`, `chrome:`, `data:` ; types de téléchargement limités
(PDF, JPEG, PNG, TIFF, WEBP, JP2) et taille maximale ; contenu des pages traité comme **donnée non fiable**
(jamais comme instruction) ; détection des tentatives d'injection ; pas de CAPTCHA résolu, pas de connexion,
pas de contournement d'abonnement ou de protection anti-automatisation → tâche BLOQUÉE + `needs_human`.
Sites dont les conditions interdisent l'automatisation (liste `web_archive.NO_AUTO` : Geneanet, FamilySearch, Ancestry,
MyHeritage, Filae) → stratégie `human` uniquement (ouverture pour l'utilisateur) ou résultats de recherche web.
Télémétrie Browser Use désactivée (`ANONYMIZED_TELEMETRY=false`, voir config.py).

API worker (api/worker.py, authentifiée par ACCESS_TOKEN) : `POST /api/worker/claim`, `POST /api/worker/tasks/{id}/heartbeat`,
`POST /api/worker/tasks/{id}/visit` (PageVisit + capture), `POST /api/worker/tasks/{id}/document` (fichier téléchargé → Media),
`POST /api/worker/tasks/{id}/result`, `GET /api/worker/status`.

## 6. Paléographie — genealis/paleo/

`read_document(db, media, *, options=None) -> DocumentReading` : original jamais modifié ; copie de travail
(orientation, contraste) ; identification langue + écriture ; zones ; transcription diplomatique ligne par ligne avec bbox
(0-1000 relatives à l'image originale) ; passages incertains avec lectures alternatives ; version normalisée ;
traduction ; extraction généalogique ; seconde passe agrandie sur les passages difficiles ; comparaison avec les autres
pages de la même main (`scribe_key`) et les corrections humaines. Photos : description sans **jamais** identifier
une personne par son visage. `mentions_from_reading(db, reading, investigation_id=None) -> list[PersonMention]`.

## 7. Interface

Routes réservées : `/investigation` (tableau de bord), `/investigation/:id` (vue 3 colonnes en direct),
`/couts` (coûts et quotas), `/documents/:mediaId/lecture` (lecteur : zoom, rotation, contraste, négatif, découpe,
transcription et traduction en parallèle, passages incertains surlignés, correction manuelle).

## 8. Règles de validation (rappel des règles absolues)

Une filiation n'est **jamais** enregistrée comme certaine sans preuve suffisante : un acte primaire nommant
explicitement les parents ET une identification de la personne au-delà du seul nom. Sinon : hypothèse (À VÉRIFIER)
ou question à l'utilisateur. Un témoin homonyme n'est jamais présumé parent. Une hypothèse de lecture n'est jamais
présentée comme une certitude.
