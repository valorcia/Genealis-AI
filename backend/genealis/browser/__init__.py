"""Navigation autonome locale (worker du PC de l'utilisateur) : Playwright (déterministe) + Browser Use (agent IA).

Ce paquet s'importe SANS Playwright ni Browser Use : ces dépendances (extra `pip install -e "backend[browser]"`)
ne sont chargées que dans les fonctions qui en ont besoin, pour que le backend hébergé (Vercel) reste léger.

- `security` : politique d'adresses (http/https, aucune adresse interne), politique par site (CGU), injections, téléchargements ;
- `guard` : mandataire réseau local qui applique cette politique à CHAQUE connexion du navigateur ;
- `detect` : CAPTCHA, connexion, abonnement, 403/429, défi anti-robot → assistance humaine ;
- `playwright_driver` : recettes déterministes (0 appel IA) ;
- `agent_driver` : agent Browser Use + Gemini, plafonné ;
- `cloud` : Browser Use Cloud (payant), refusé sans autorisation explicite ;
- `service` : choix de la stratégie la moins chère (`execute_browse_task`) ;
- `store` : enregistrement des pages visitées et documents (côté serveur) ;
- `worker` : boucle du worker local (`python -m genealis.browser.worker`).
"""
