# Umsetzungsplan für Stuart

Konsolidierte Reihenfolge dessen, was nach [Konsum.md](Konsum.md), [Vorrat.md](Vorrat.md)
und [GapUndEmpfehlung.md](GapUndEmpfehlung.md) gebaut wird — als **abhängigkeits­geordnete
Phasen** mit den konkreten Andockpunkten im Code.

> Die drei Docs enthalten das *Warum* und die Design-Entscheidungen. Dieses Dokument ist
> die *Reihenfolge* und die *To-dos*. Lies die drei Docs für Details; hier steht, womit du
> anfängst und was worauf aufbaut.

---

## Überblick: die drei Features

| Doc | Feature | Kern |
|---|---|---|
| [Vorrat.md](Vorrat.md) | **Basket / Vorrat** | Bestand = Einkäufe − Entnahmen (Ledger), Basket-Page |
| [Konsum.md](Konsum.md) | **Konsum ≠ Einkauf** | Kauf-Historie → Konsumrate/Tag (Zeitfenster, Haushalt) |
| [GapUndEmpfehlung.md](GapUndEmpfehlung.md) | **Gap-Analyse & Empfehlung** | Ist vs. Soll-Profil, vorrats-bewusste Tipps |

Sie hängen voneinander ab: **Vorrat** liefert das bessere Konsum-Signal (`entfernt`),
**Konsum** liefert die Zeit-/Absolut-Ebene, **Gap** verrechnet beides gegen das
Soll-Profil. Deshalb die Phasenreihenfolge unten.

---

## Phase 0 — Freischalter (blockiert alles andere)

**0.1 `.gitignore` reparieren.** Die Zeile [`lib/`](.gitignore#L17) (aus dem Python-
Template) verschluckt das gesamte `frontend/src/lib/` — es ist derzeit **nicht eingecheckt**,
das Frontend lässt sich nicht bauen. Regel einschränken (z. B. auf venv-Pfade) oder
`!frontend/src/lib/` ausnehmen, dann die `lib`-Dateien wiederherstellen und committen.
*Ohne das ist keine Frontend-Arbeit möglich.*

**0.2 Konzeptentscheidung: „IST" je Feature.** Vor dem Bauen festlegen, welches Ist gemeint
ist ([GapUndEmpfehlung §2.1](GapUndEmpfehlung.md)): **Gekauft** / **Konsum** / **Bestand**.
Reine Entscheidung, aber sie bestimmt, was die Gap liest.

---

## Phase 1 — Datenfundament (Genauigkeit, bevor irgendwas darauf rechnet)

Jede Analyse ist nur so gut wie diese Stufe. Reihenfolge egal, aber **vor** Phase 3/4.

- **1.1 Coverage-/Konfidenz-Label.** Nutzt das schon vorhandene
  [`match_quality`](backend/app/analytics/match_quality.py) — Anteil sicher gematchter kcal
  an jede Gap-Aussage hängen. Kleiner Aufwand, große Ehrlichkeit ([Konsum.md §6](Konsum.md#L126)).
- **1.2 `or 0.0`-Bug.** In [basket_composition.py:65-67](backend/app/services/basket_composition.py#L65-L67)
  wird „unbekannt" als *null* gezählt → verzerrt die Verteilung. Sauber auf „fehlend"
  behandeln (paired sums wie in [nutrition_profile.py](backend/app/services/nutrition_profile.py#L89)).
- **1.3 Mengenerfassung `count` × `unit_size`.** Parser wirft heute Anzahl *oder* Größe weg
  ([receipt_text_parser.py:246-257](backend/app/services/receipt_text_parser.py#L246-L257)).
  Getrennt erfassen ([Vorrat.md §6.3](Vorrat.md)) — **Achtung:** kein reines Umbenennen von
  `quantity`, sondern Interpretation (piece→count / Masse→unit_size). Berührt
  [`grams_for`](backend/app/services/nutrition_profile.py#L27) und Konsum.mds `factor`.
- **1.4 (optional) `grams_for` verfeinern:** 1 g/ml-Näherung + 100-g-Stück-Default sind grob.

---

## Phase 2 — Vorrat / Basket ([Vorrat.md](Vorrat.md))

Eigenständig, hoher Nutzerwert, kann parallel zu Phase 1 laufen.

- **2.1 Migration** `supabase/migrations/0008_pantry.sql`: Tabelle `pantry_removals`
  (`receipt_item_id`, `reason ∈ {eaten, removed}`, `quantity` optional, `removed_at`) +
  View `v_pantry`. DDL steht in [Vorrat.md §3-4](Vorrat.md).
- **2.2 Repo** ([repo.py](backend/app/db/repo.py)): `add_pantry_removal(...)`,
  `remove_pantry_removal(id)`, `get_pantry(profile_id)` (Read-Query aus §4).
- **2.3 API** (neuer Router `backend/app/api/pantry.py`, Muster wie
  [profile.py](backend/app/api/profile.py), Auth via `require_profile_id`):
  `GET /pantry`, `POST /pantry/removals`, `DELETE /pantry/removals/{id}`.
- **2.4 Frontend Basket-Page** (siehe [Mockup.html](Mockup.html)): pro-Lot-Liste (MVP),
  primär „Gegessen", „entfernt" hinter „⋯". Route + Startseite für Bestandskunden.
- **Merke:** `gegessen` und `entfernt` senken **beide** den Bestand; die Gap-Wirkung
  unterscheidet sich erst in Phase 4 ([GapUndEmpfehlung §4](GapUndEmpfehlung.md)).
- **Später:** aggregierte Anzeige pro Produkt (FIFO), Teil-Entnahme via `quantity`.

---

## Phase 3 — Konsum: Zeit- & Absolut-Ebene ([Konsum.md](Konsum.md))

Rein backend, laut Konsum.md ~½ Tag für Stufe 1+2.

- **3.1 Datum in die Query** ([get_all_confirmed_receipt_items](backend/app/db/repo.py#L108)):
  `purchased_at`/`created_at` mitziehen.
- **3.2 Stufe 1 — Fenster + Tagesrate** in
  [compute_basket_composition](backend/app/services/basket_composition.py#L52):
  Parameter `reference_date`, `window_days` (Default ~28).
- **3.3 Stufe 2 — EWMA** (Halbwertszeit ~30 Tage) als Gewichtung.
- **3.4 Haushaltsgröße** — neues Feld auf [ProfileCreate/Profile](backend/app/models/profile.py#L71),
  für **absolute** Werte (Portion/Person).
- **3.5 Coverage** (Grocery-kcal/Tag vs. TDEE) + optional Auswärts-Frequenz-Feld;
  Ergebnis als Vertrauensmaß labeln (Stufe 5).

---

## Phase 4 — Gap & Empfehlungen ([GapUndEmpfehlung.md](GapUndEmpfehlung.md))

Baut auf Phase 1-3.

- **4.1 Absolute g/Tag-Gap.** Heutiges [`/target-comparison`](backend/app/api/analysis.py#L105)
  vergleicht nur **%-Verteilung**. Ergänze absolute Gramm/Tag (aus Phase 3) gegen das
  Soll aus [ideal_profile.py](backend/app/services/ideal_profile.py) — das beantwortet
  „genug Protein für Muskelaufbau?".
- **4.2 Konsum-Korrektur durch Vorrat.** `entfernt`-Events (Phase 2) von der Konsum-
  Schätzung abziehen (= Verderb-Korrektur, ersetzt Konsum.mds statische Koeffizienten).
  **Basis bleibt der Einkauf; `gegessen` ändert die Gap nicht** (Effekt-Tabelle in
  [GapUndEmpfehlung §4](GapUndEmpfehlung.md)). `gegessen`-Vollprotokoll nur als Opt-in.
- **4.3 Vorrats-bewusste Empfehlungen (Tipp-Page).**
  - *Deterministisch:* welche Zutaten den Gap schließen + was im Lager liegt — Erweiterung
    von [`/buckets`](backend/app/services/bucketing.py) um Vorrats-Bewusstsein.
  - *LLM nur für die Prosa:* [recipe_engine.py](backend/app/services/recipe_engine.py) mit
    vorgegebenen Zutaten füttern (heute vorrats-blind, Nährwerte LLM-geschätzt).
  - *Basket-Optimierung:* greedy + gedeckelt (1-3 Zukäufe), reale Gebinde, ehrliches
    „deckt ~X%".

---

## Phase 5 — Frontend-Oberflächen & Feinschliff

- **5.1 Insights-Page.** Analysen gestaffelt (Details siehe unten / Gap-Doc):
  sofort verfügbar sind Score, Makro-Ist-vs-Ziel, Qualitäts-Dichten
  ([nutrition_profile](backend/app/services/nutrition_profile.py)), Vielfalt
  ([/diversity](backend/app/services/diversity.py)), Coverage. Absolute Ebene & Trends
  kommen mit Phase 3.
- **5.2 Navigation / IA** (siehe [Mockup.html](Mockup.html)): Bottom-Nav **Basket · Tipp ·
  Insights** + Profil-Icon + „+"-FAB; Purchases → **Bon-Verlauf** hinters Profil;
  Bestandskunden landen auf Basket, neue → Onboarding.

---

## Abhängigkeits-Kurzform

```
Phase 0 (Freischalter)
   ├─ 0.1 .gitignore  ── blockiert alle Frontend-Arbeit
   └─ 0.2 IST-Begriff ── blockiert Gap-Design
Phase 1 (Datenfundament) ─────────────┐
Phase 2 (Vorrat/Basket) ──┐           │
Phase 3 (Konsum) ─────────┤ beide     │ liefern die
                          ▼ nötig für ▼ Grundlage für
                        Phase 4 (Gap & Empfehlungen)
                                     │
                                     ▼
                        Phase 5 (Insights & IA-Feinschliff)
```

Parallelisierbar: **Phase 2** (Vorrat) und **Phase 3** (Konsum) sind unabhängig
voneinander und können gleichzeitig laufen; beide münden in Phase 4.

---

## Offene Entscheidungen (vor bzw. während der Phasen zu klären)

- **IST-Begriff je Feature** (Phase 0.2).
- **Basket-Anzeige:** pro-Lot (MVP) vs. pro-Produkt aggregiert ([Vorrat.md §5](Vorrat.md)).
- **Empfehlungs-Zutaten:** kontrollierte Liste vs. freie Gemini-Zutaten
  ([GapUndEmpfehlung §3.2](GapUndEmpfehlung.md)).
- **Coverage-Schwelle**, ab der Empfehlungen als „unsicher" gelabelt werden.

## Nicht Teil dieser drei Docs (separat, nur zur Erinnerung)

- **BLS-first-Matching** — zurückgestellte Änderung an
  [resolver.py](backend/app/services/resolver.py) (heute OFF-first). Unabhängig von den
  drei Docs; nur anfassen, wenn bewusst gewollt.
