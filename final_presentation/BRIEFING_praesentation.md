# NutriWise Präsentation — Briefing zur Optimierung (neuer Chat)

*Zweck: Damit eine frische LLM-Session die Midterm-Präsentation gezielt optimieren kann. Stand: 2026-07-17,
Branch `presentation`. Alle Präsentations-Dateien liegen in `midterm_presentation/`.*

## 0. So startest du den neuen Chat
1. Auf Branch **`presentation`** arbeiten (dort liegt die Präsentation).
2. Diese Datei + die Build-Skripte anhängen (siehe Abschnitt 2).
3. Den Kontext-Prompt unten einfügen.
4. **Wichtig:** Erst die Änderungsliste zur Freigabe nennen, dann bauen (siehe Abschnitt 9).

> **Kontext-Prompt (einfügen):** „Du optimierst die Midterm-Präsentation von **NutriWise** (AI-PM-Capstone).
> Die `.pptx`-Dateien werden **aus Python-Skripten mit python-pptx generiert** (`build_deck.py` = EN,
> `build_deck_de.py` = DE) — sie werden **nicht** direkt in PowerPoint editiert. Zum Ändern: das Skript
> anpassen und neu bauen. Design ist Salbeigrün-Corporate (`#7c9a6a`, sans-serif). 14 Folien, zwei
> Sprecher (Jennifer Rake = Sprecherin 2, Stuart Kasemeier = Sprecher 1). Halte die Zahlen aus diesem
> Briefing exakt ein und nenne Änderungen erst zur Freigabe, bevor du Dateien bearbeitest."

---

## 1. WICHTIGSTE REGEL: Die Präsentation ist generiert, nicht handgemalt

Die `.pptx` entstehen zu 100 % aus den Build-Skripten. **Jede Änderung passiert im Skript, dann wird neu
gebaut** — sonst gehen manuelle PowerPoint-Edits beim nächsten Build verloren.

- `build_deck.py` → `NutriWise_Midterm_Presentation_v1.pptx` (Englisch, 14 Folien)
- `build_deck_de.py` → `NutriWise_Midterm_Presentation_v1_DE.pptx` (Deutsch, 14 Folien)
- Beide erzeugen zuerst 3 Charts (matplotlib) aus `../bls_off_judgments.json`, dann das Deck.

**Neue Version immer in eine neue Datei** (z. B. `..._v2.pptx`) schreiben — die Vorversion bleibt erhalten
(Zeile `out=os.path.join(OUTDIR, "...")` am Skriptende anpassen).

---

## 2. Datei-Inventar (`midterm_presentation/`)

| Datei | Rolle | Priorität für neuen Chat |
|---|---|---|
| `build_deck.py` | Build-Skript EN (Quelle der Wahrheit für Inhalt/Layout) | **Muss** |
| `build_deck_de.py` | Build-Skript DE | **Muss** (für DE) |
| `NutriWise_Midterm_Presentation_v1.pptx` | aktuelles EN-Deck | Referenz |
| `NutriWise_Midterm_Presentation_v1_DE.pptx` | aktuelles DE-Deck | Referenz |
| `NutriWise_Midterm_Presentation.pptx` | v0 (Ausgangsstand) | Archiv |
| `requirements.md` | Aufgabenstellung (Pflicht-Topics des Capstones) | **Muss** |
| `../bls_off_judgments.json` | Datengrundlage der Charts + Baseline-Zahlen | **Muss** |
| `../frontend/src/index.css` | Design-Tokens (Salbeigrün, Font) | Optional |
| `eda_*.png`, `baseline*.png` | vom Skript erzeugte Charts (Zwischenprodukte, werden überschrieben) | – |

> Hinweis: Die Skripte sind aktuell **untracked** — vor dem neuen Chat **committen** (auf `presentation`),
> damit sie sicher verfügbar sind. `ROOT` im Skript ist ein absoluter Pfad → auf anderer Maschine anpassen.

---

## 3. Build-Workflow

```bash
# aus dem Repo-Root, venv aktiv; braucht python-pptx + matplotlib
.venv/bin/pip install python-pptx matplotlib   # falls noch nicht vorhanden
.venv/bin/python midterm_presentation/build_deck.py       # EN
.venv/bin/python midterm_presentation/build_deck_de.py    # DE
```

Das Skript ist idempotent: Charts + `.pptx` werden bei jedem Lauf neu erzeugt.

---

## 4. Foliengliederung (14 Folien, v1)

| # | Folie | Sprecher | Inhalt (Kurz) |
|---|---|---|---|
| 1 | Titel | beide | Hook, Team, Version 1 |
| 2 | Problem | S1 | manuelles Loggen scheitert; Bon als ehrlicher Proxy |
| 3 | Lösung | S1 | Kern-Loop: Upload → Vorrat → Abhaken → Lücken + 2 Empfehlungen |
| 4 | **UI / User-Journey** | S1/S2 | 4 Handy-Mockups (Onboarding → Vorrat → Log → Insights) |
| 5 | KPIs | S1 | Kachel „Woche 1: Abhaken klebt?" (Make-or-Break) + 30 %/>20 %/<2 Min |
| 6 | Roadmap | S1 | Fertig / In Arbeit / Nächstes |
| 7 | Live-Demo | S1→S2 | 6-Schritt-Flow + stilisierte Ergebnis-Karte |
| 8 | Evaluations-Metrik | S2 | LLM-Judge-Panel, Precision + Konsens |
| 9 | Daten | S2 | 3 Quellen, Eval-Set-Form, ehrliche Challenges |
| 10 | EDA (Plots) | S2 | Kategorien-Bar + Long-Tail-Bar |
| 11 | Pipeline | S2 | gestufter Resolver (Tier 0–3) |
| 12 | Baseline | S2 | OFF-vs-BLS-Head-to-Head-Chart + Stat-Kacheln |
| 13 | Nächstes/Zukunft | S2 | Embeddings, Portions-ML, Validierung + Prinzip-Zeile |
| 14 | Danke | beide | Einzeiler, Team |

Jede Folie hat **Sprechernotizen** (im `notes(...)`-Aufruf im Skript).

---

## 5. Design-System & Skript-Struktur

- **Palette-Konstanten** (oben im Skript): `SAGE=#7C9A6A`, `SAGE_DK`, `SAGE_LT`, `SAGE_SOFT=#EEF2EA`,
  `CLAY=#B36A4A` (niedrig/negativ), `SAND` (neutral), `INK=#1D1D21`, `INK_SOFT`, `CANVAS=#FAFAFA`, `LINE`.
  Font `Arial` (System-Sans, kein Serif). **Ein Akzent (Salbeigrün); Semantik (Clay/Amber) getrennt.**
- **Helper-Funktionen:** `slide()`, `bg()`, `rect(...)`, `txt(runs)`, `R(text,size,color,bold,italic)`,
  `notes(speaker,body)`, `kicker()`, `heading()`, `rule()`, `footer(page)`, `logo()`, `stat()`, `pill()`,
  `mpshell()` (Handy-Mockup auf Folie 4). Layout in **Zoll**, Folie 13.333×7.5 (16:9).
- **⚠️ Footer-Nummerierung ist manuell:** `footer(s, N)` je Folie + Nenner `"/ 14"` in `footer()`. **Wenn du
  eine Folie einfügst/entfernst, musst du alle nachfolgenden `footer(s,N)` und den Nenner anpassen** (am
  besten absteigend, um Kollisionen zu vermeiden).

---

## 6. Fakten & Zahlen (nicht widersprechen)

- **Baseline (aus `bls_off_judgments.json`):** 76 Items / 227 Vorkommen; **OFF 54 % korrekt, 66 % nutzbar**,
  24 % kein Treffer; **BLS 32 % korrekt, 36 % falsch**; **Judge-Konsens 96 %**. Ziel: **≥70 % nutzbar**.
  Die 54 %/32 % sind **Head-to-Head, nicht additiv.**
- **Produkt:** regelbasiert/LLM-Hybrid; OCR = **Tesseract on-device** (nicht Gemini); Gemini nur Nutri-Coach
  (nur Formulierung). Kern-Loop: Vorrat + Abhaken + inventar-bewusste Empfehlung + Next Cart.
- **Framing:** „Schätzung aus Einkauf + Tages-Log, keine medizinische Beratung"; Trends statt exakter kcal.
- **Make-or-Break:** klebt die Abhak-Gewohnheit über Woche 1?
- **Team:** Jennifer Rake (Sprecherin 2, Daten/Modell), Stuart Kasemeier (Sprecher 1, Business).

---

## 7. Pflicht-Topics des Capstones (müssen abgedeckt bleiben)

Aus `requirements.md`: Intro · Business-Ziel/Motivation · Erfolgskriterien/KPIs · Roadmap · Evaluations-Metrik ·
Datenquellen & Challenges · **EDA mit Plots** · ML-Workflow/Pipeline · **Baseline-Modell & Performance** ·
Danke (+ optional Advanced/Future). → Mapping siehe Abschnitt 4. **Bei Umbau nichts davon streichen.**

---

## 8. Optimierungs-Ansätze & bekannte Grenzen

**Bekannte Grenze:** In der reinen Assistenten-Umgebung lässt sich `.pptx` **nicht rendern** (kein
LibreOffice) — Layout wurde nur **rechnerisch** auf Overflow geprüft. **Empfehlung:** Deck in
PowerPoint/LibreOffice öffnen und auf Textumbrüche prüfen, besonders im **DE-Deck** (deutscher Text ist
~15–20 % länger → Overflow-Risiko auf Kacheln/Karten). Ggf. Schriftgrößen/Umbrüche im Skript justieren.

**Mögliche Optimierungen (Vorschläge, nicht Auftrag):**
- Folie 4: **echte Screenshots** aus dem UI-Prototyp statt nativer Mockups (App/Dummy kurz rendern lassen).
- DE-Textlängen prüfen und knackiger fassen; Sprechernotizen aufs 10–12-Min-Timing trimmen.
- Optionale **Backup-Folien** (Detail-EDA, Confusion, KPI-Sequenzierung) nach der Danke-Folie.
- Konsistenz-Check EN↔DE (gleiche Zahlen/Aussagen).

---

## 9. Arbeitsweise / Guardrails

- **Freigabe-Flow (wichtig, Nutzerpräferenz):** Bei Deck-Änderungen **erst eine nummerierte Änderungsliste
  zur Freigabe** nennen, nichts bearbeiten, dann umsetzen. Ergebnis in **neue versionierte Datei** (`_v2`).
- Änderungen **im Build-Skript**, danach neu bauen (nicht im .pptx direkt).
- Design-System einhalten (ein Akzent Salbeigrün, sans-serif, Weißraum). Zahlen aus Abschnitt 6 nicht ändern.
- Nach dem Bauen Struktur/Footer/Chart-Umlaute programmatisch verifizieren (via python-pptx auslesen).

---

## 10. Aktueller Repo-Stand (für Transparenz)

- Branch **`presentation`**; Präsentation liegt in `midterm_presentation/` (v0, v1 EN, v1 DE + Skripte + Charts).
- Die Build-Skripte sind neu ins Repo gelegt und **noch untracked** → committen empfohlen.
- Nicht (mehr) im Working Tree: `Optimierungen/projektbewertung_ml_und_optimierungen.md` und
  `Optimierungen/NutriWise_UI_Dummy.html` (ML-Bewertung + UI-Prototyp). Falls für die Optimierung gebraucht,
  können sie wiederhergestellt werden — für reine Deck-Arbeit aber nicht nötig.
