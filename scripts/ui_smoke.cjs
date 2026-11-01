/* Vérification automatisée de toutes les pages contre le moteur réel (données fictives dans un dossier séparé). */
const { chromium } = require('playwright')
const base = process.env.GENEALIS_URL || 'http://127.0.0.1:8777'
const shots = process.env.SHOT_DIR || '/tmp'
const routes = ['/', '/demarrer', '/section/recherche', '/section/editer', '/section/graphiques', '/section/vues', '/section/rapports', '/section/listes',
  '/section/publication', '/favoris', '/tableau-de-bord', '/arbre-interactif', '/arbre', '/chronologie', '/graphiques/sablier', '/graphiques/ascendance',
  '/graphiques/descendance', '/graphiques/eventail', '/graphiques/double-ascendance', '/graphiques/distribution', '/graphiques/statistiques',
  '/graphiques/liens', '/graphiques/sociogramme', '/graphiques/circulaire', '/graphiques/genogramme', '/carte', '/vues/arbre-virtuel', '/vues/globe',
  '/vues/cartes-statistiques', '/vues/quiz', '/rapports/synthese-personnelle', '/rapports/ascendance', '/rapports/chronique', '/rapports/etat-de-la-base',
  '/histoire', '/listes/personnes', '/listes/familles', '/listes/medias', '/listes/anniversaires', '/publication/site', '/publication/supprimer-sous-arbre',
  '/enquetes', '/archives', '/questions', '/assistant', '/parametres', '/bienvenue', '/section/livre', '/livre', '/livre/personne',
  '/livre/metiers', '/livre/villages', '/livre/a-trouver', '/documents/importer', '/sources-consultees', '/archives?tab=sources',
  '/investigation', '/couts', '/parametres?tab=enquetes']
;(async () => {
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {})
  const mobile = process.env.MOBILE === '1'
  const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const errors = []
  let current = ''
  page.on('pageerror', (e) => errors.push(`${current} pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|tile\.openstreetmap|Failed to load resource/.test(m.text())) errors.push(`${current} console: ${m.text()}`) })
  page.on('response', (r) => { if (r.status() >= 500) errors.push(`${current} HTTP ${r.status()} ${r.url()}`) })
  if (process.env.GENEALIS_PASSWORD) {
    await page.goto(`${base}/#/`, { waitUntil: 'networkidle' }); await page.waitForTimeout(600)
    const f = await page.$('input[type=password]')
    if (f) { await f.fill(process.env.GENEALIS_PASSWORD); await page.click('button:has-text("Entrer")'); await page.waitForTimeout(1500); console.log('connexion : ok') }
  }
  const persons = await (await page.request.get(`${base}/api/persons`, { headers: process.env.GENEALIS_PASSWORD ? { 'X-Genealis-Token': process.env.GENEALIS_PASSWORD } : {} })).json()
  if (persons.length) routes.push(`/personnes/${persons[0].id}`, `/livre/personne/${persons[0].id}`)
  const tasks = await (await page.request.get(`${base}/api/trace/tasks`, { headers: process.env.GENEALIS_PASSWORD ? { 'X-Genealis-Token': process.env.GENEALIS_PASSWORD } : {} })).json().catch(() => [])
  const tlist = Array.isArray(tasks) ? tasks : (tasks.tasks || tasks.items || [])
  if (tlist.length) routes.push(`/enquetes/${tlist[0].id}`)
  const invs = await (await page.request.get(`${base}/api/investigations`, { headers: process.env.GENEALIS_PASSWORD ? { 'X-Genealis-Token': process.env.GENEALIS_PASSWORD } : {} })).json().catch(() => [])
  routes.push(`/investigation/${Array.isArray(invs) && invs.length ? invs[0].id : 'inexistante'}`)
  let bad = 0
  for (const r of routes) {
    current = r
    await page.goto(`${base}/#${r}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(900)
    const body = await page.innerText('body')
    const placeholder = /en construction/i.test(body)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)
    if (placeholder || overflow) bad++
    console.log(`${(placeholder ? 'PLACEHOLDER' : overflow ? 'DEBORDEMENT' : 'ok').padEnd(11)} ${r}`)
    await page.screenshot({ path: `${shots}/${mobile ? 'm' : 'd'}${r.replace(/[^a-z0-9]+/gi, '_')}.png` })
  }
  await browser.close()
  console.log(errors.length ? `\n${errors.length} erreur(s) :\n` + [...new Set(errors)].join('\n') : '\nAucune erreur JavaScript ni serveur.')
  process.exit(errors.length || bad ? 1 : 0)
})()
