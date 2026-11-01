import io


def test_flux_complet_api(client):
    r = client.post("/api/persons", json={"given_names": "Jean", "surname": "Dupont", "sex": "M", "birth_date": "1895", "birth_place": "Nancy"})
    assert r.status_code == 201
    jean = r.json()
    assert jean["birth_year"] == 1895 and jean["birth_place"].startswith("Nancy")
    r = client.post("/api/persons", json={"given_names": "Louis", "surname": "Dupont", "sex": "M", "birth_date": "1860", "birth_place": "Toul", "is_root": False})
    louis = r.json()
    r = client.post("/api/persons/relations", json={"parent_id": louis["id"], "child_id": jean["id"]})
    assert r.status_code == 201
    # Boucle interdite
    r = client.post("/api/persons/relations", json={"parent_id": jean["id"], "child_id": louis["id"]})
    assert r.status_code == 400
    tree = client.get(f"/api/tree/ancestors?root_id={jean['id']}").json()
    assert tree["generations"] == 2 and len(tree["nodes"]) == 2
    tl = client.get(f"/api/timeline?root_id={jean['id']}").json()
    assert len(tl["items"]) == 2 and tl["historical_events"]
    dash = client.get("/api/dashboard").json()
    assert dash["persons"] == 2
    # Source + citation -> confiance mise à jour
    s = client.post("/api/sources", json={"title": "Acte de naissance de Jean Dupont (fictif)", "repository": "AD54", "reference": "2E 1/5",
                                           "reliability": "primary", "register_type": "état civil", "year": 1895}).json()
    rel_id = client.get(f"/api/persons/{jean['id']}").json()["parent_relations"][0]["id"]
    client.post("/api/sources/citations", json={"source_id": s["id"], "target_type": "parent_child", "target_id": rel_id, "confidence": "green"})
    detail = client.get(f"/api/persons/{jean['id']}").json()
    assert detail["parent_relations"][0]["confidence"] == "orange"  # une seule source primaire : à corroborer
    # Export GEDCOM / PDF / CSV
    assert "Dupont" in client.get("/api/export/gedcom").text
    assert client.get(f"/api/export/person/{jean['id']}.pdf").content[:4] == b"%PDF"
    assert "Dupont" in client.get("/api/export/persons.csv").text
    # Import GEDCOM
    ged = client.get("/api/export/gedcom").content
    r = client.post("/api/import/gedcom", files={"file": ("x.ged", io.BytesIO(ged), "text/plain")})
    assert r.json()["persons"] == 2
    # Recherche plein texte
    assert client.get("/api/persons?q=dupont").json()
    # Chat sans IA
    r = client.post("/api/chat", json={"message": "Montre-moi les contradictions"})
    assert "contradiction" in r.json()["content"].lower()
    r = client.post("/api/chat", json={"message": "Pourquoi penses-tu que Louis Dupont est mon ancêtre ?"})
    assert "confiance" in r.json()["content"].lower()
    # Connecteurs : aucun n'est annoncé opérationnel sans test
    cons = client.get("/api/research/connectors").json()
    assert cons and all(not c["operational"] for c in cons)
    assert any(c["id"] == "ad54" for c in cons)


def test_onboarding_et_questions(client):
    r = client.post("/api/onboarding", json={"given_names": "Camille", "surname": "Durant", "birth_date": "1990", "birth_place": "Nancy", "sex": "F",
                                             "father": {"given_names": "Pierre", "surname": "Durant"},
                                             "mother": {"given_names": "Anna", "surname": "Rossi"},
                                             "grandparents": [{"side": "father", "role": "father", "given_names": "Jean", "surname": "Durant"}],
                                             "origin_countries": ["Italie"], "autonomy_mode": 1, "start_research": True})
    assert r.status_code == 200, r.text
    data = r.json()
    assert len(data["parents"]) == 2 and len(data["grandparents"]) == 1 and data["tasks"]
    # Mode 1 : les tâches attendent l'accord
    tasks = client.get("/api/research/tasks").json()
    assert tasks and all(t["status"] == "waiting_user" for t in tasks)
    assert all(t["plan"] for t in tasks if t["task_type"] != "explore_branch")
    qs = client.get("/api/research/questions").json()
    assert qs and any("mère" in q["title"] or "né" in q["title"] for q in qs)
    # Réponse "info" ajoute une mère et relance les pistes
    q = next(q for q in qs if "mère" in q["title"])
    r = client.post(f"/api/research/questions/{q['id']}/answer", json={"answer_type": "info", "answer": "Marie Kowalski",
                                                                       "payload": {"parent": {"given_names": "Marie", "surname": "Kowalski", "sex": "F"}}})
    assert r.json()["status"] == "answered"
    assert client.get("/api/settings").json()["onboarding_done"] is True
    # Deuxième onboarding refusé
    assert client.post("/api/onboarding", json={"given_names": "X"}).status_code == 400
