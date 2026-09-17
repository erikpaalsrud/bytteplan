# Bytteplan – Bjerke IL

Kampdags-app (PWA) for trenerteamet. Norsk grensesnitt, offline-støtte og lokal lagring, med valgfri server for pushvarsler på låst telefon.

1. **Kampen:** Velg 3er, 5er, 7er eller 9er, motstander og egne tider.
2. **Spillere:** Legg til navn eller velg huskede spillere. Velg keeper i 5er/7er/9er. Spillertype og favorittposisjon er valgfrie.
3. **Oppstilling:** Se og juster oppstillingen, forhåndsvis bytteplanen, og start kampen.

3er bruker tre utespillere uten keeper. De øvrige formatene inkluderer én keeper. Formasjonene er faste forslag; spillere kan bytte plass.

- 1–12 perioder, hver med egen lengde på 1–120 minutter (halvminuttssteg).
- Pause på 0–60 minutter og bytteintervall på 10–3600 sekunder.
- Velg antall spillere per bytte, eller Auto (opptil to).
- Byttekø med posisjonsvariasjon, skadebytte, kort pause og manuelle bytter.
- Kampklokke, faktisk spilletid, resultat og delbar kamprapport.
- Eksisterende 5er-kamper og historikk beholdes.

Byttekøen tilstreber jevn utespilletid. Fast keeper, avrunding ved kampslutt, skader og manuelle bytter kan gi ulik total spilletid. Forhåndsvisningen forutsetter samme keeper og bytter til oppsatt tid. Periodetid og pauser er trenerens valg, ikke validering mot turneringsregler.

**Personvern:** Navn og statistikk lagres i localStorage på enheten. Når pushvarsler aktiveres, lagres enhetens pushabonnement og varseltider på serveren, uten spillernavn. Kopiering og deling av rapport skjer på trenerens initiativ. Nettleserdata kan slettes av brukeren eller nettleseren; kopier rapporter du vil beholde. Varsler i bakgrunnen avhenger av nettleseren. Klokka tar igjen forløpt tid ved retur, begrenset til periodens slutt.

## Kjøring og kontroll

Appen med pushserver kjører på Railway: **https://bytteplan-production.up.railway.app** (git-koblet; push til `main` deployer automatisk). For kun lokal kampføring kan mappen fortsatt serveres statisk, også på GitHub Pages — men varsler på låst telefon krever Railway-adressen. Selvhosting med Docker/Caddy, nøkkelgenerering og brukertest er beskrevet i [server/README.md](server/README.md).

```sh
npm ci --ignore-scripts
npm test
```

Mobil nettlesertest krever Playwright og Chromium installert i testmiljøet:

```sh
node tests/browser.mjs
# Eller pek til en eksisterende Playwright-modul:
PLAYWRIGHT_MODULE=/absolutt/sti/til/playwright/index.mjs node tests/browser.mjs
```

Nettlesertesten bruker en lokal server og skriver skjermbilder til `/private/tmp/bytte-*.png` på macOS. Se `REVIEW.md` for funn, rettelser og gjenværende begrensninger.
