/* Vérification automatisée de l'interface contre le moteur réel (données fictives dans un dossier séparé). */
const { chromium } = require('playwright')
const base = process.env.GENEALIS_URL || 'http://127.0.0.1:8777'
const routes = ['#/', '#/arbre', '#/chronologie', '#/carte', '#/histoire', '#/enquetes', '#/archives', '#/questions', '#/assistant', '#/parametres', '#/bienvenue']
;(async () => {
  const browser = await chromium.launch()
  const mobile = process.env.MOBILE === '1'
  const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1600, height: 1000 }, isMobile: mobile, hasTouch: mobile })
  if (process.env.GENEALIS_PASSWORD) {
    await page.goto(`${base}/#/`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
    const field = await page.$('input[type=password]')
    if (!field) { console.log('ATTENDU : écran de connexion absent'); process.exit(1) }
    await field.fill(process.env.GENEALIS_PASSWORD)
    await page.click('button:has-text("Entrer")')
    await page.waitForTimeout(1500)
    console.log('connexion par mot de passe : ok')
  }
  const errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
  page.on('response', (r) => { if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`) })
  for (const r of routes) {
    await page.goto(`${base}/${r}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
    const text = (await page.innerText('body')).slice(0, 120).replace(/\n/g, ' ')
    const placeholder = /en construction/i.test(await page.innerText('body'))
    console.log(`${r.padEnd(14)} ${placeholder ? 'PLACEHOLDER' : 'ok'}  ${text}`)
    await page.screenshot({ path: `${process.env.SHOT_DIR || '/tmp'}/shot-${mobile ? 'm-' : ''}${r.replace(/[#/]/g, '') || 'home'}.png` })
  }
  // Fiche de la première personne
  const persons = await (await page.request.get(`${base}/api/persons`, { headers: process.env.GENEALIS_PASSWORD ? { 'X-Genealis-Token': process.env.GENEALIS_PASSWORD } : {} })).json()
  if (persons.length) {
    await page.goto(`${base}/#/personnes/${persons[0].id}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
    console.log(`#/personnes/:id   ${(await page.innerText('body')).slice(0, 120).replace(/\n/g, ' ')}`)
    await page.screenshot({ path: `${process.env.SHOT_DIR || '/tmp'}/shot-${mobile ? 'm-' : ''}personne.png` })
  }
  await browser.close()
  console.log(errors.length ? `\n${errors.length} erreur(s) :\n` + errors.join('\n') : '\nAucune erreur JS/HTTP 5xx.')
  process.exit(errors.length ? 1 : 0)
})()
