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

## Umsetzungsstand (Stand: 2026-07-23)

**Gebaut & gemergt-bereit auf Branch `basket`:** Phase 0.1, die gesamte **Phase 2
(Vorrat/Basket)** inkl. **Teil-Entnahme** und **Multipack-Mengen**, plus etwas
Phase-1-Vorarbeit, die schon vorher gelandet war.

- ✅ **0.1 `.gitignore`** — behoben (`/lib/` verankert), `frontend/src/lib/` eingecheckt.
- ✅ **1.1 Coverage-Label / 1.2 `or 0.0` / Konsum Stufe 1+2** — bereits vor dieser
  Arbeit umgesetzt (`basket_composition.py`: `match_coverage_pct`, `low_confidence`,
  EWMA/`window_days`). Docs waren hier veraltet.
- ✅ **Phase 2 komplett** — Migration `0008_pantry.sql`, Repo, Router `pantry.py`,
  Frontend `BasketPage`, Nav-Link. **Pro-Lot-MVP** (Aggregation bewusst in späteren
  Sprint verschoben).
- ✅ **Teil-Entnahme** (über den ursprünglichen MVP hinaus) — Migration
  `0009_pantry_partial.sql` (`v_pantry.remaining_quantity` = Kauf − Σ Entnahmen),
  Mengen-Regler in der Zeile, Server-Clamp auf den Rest, Makros skalieren auf den Rest.
- ✅ **Multipack-Mengen** — Parser rechnet „N × gemessene Größe" zu einer Gesamtmenge
  zusammen (Joghurt 4×150 g → 600 g). **Ersetzt** für den MVP die volle
  `count`/`unit_size`-Trennung aus 1.3/§6.3 (die bleibt zurückgestellt).
- ✅ **UI-Feinschliff** — verifizierter Anzeigename, „Tage im Basket" statt Kaufdatum,
  Inline-Edit (Name → Fix-Match-Suche, Menge → Zahlenfeld), Nährwerte als Subtitel,
  Icon-Buttons 🍴/🗑️. **Purchases-Tab ausgeblendet** (Route + Nav-Link entfernt).

**Getroffene Entscheidungen (gemeinsam):** pro-Lot statt Aggregation (Sprint später);
Über-Entnahme wird **geclampt**, nicht mit 409 abgelehnt; Stück-Teilmenge über
**Viertel-Schieberegler**; UI **englisch**; §6.3 (getrennte `count`/`unit_size`)
zugunsten der Parser-Multiplikation zurückgestellt.

**Noch offen:** Migrationen 0008+0009 in Nicht-Dev-Umgebungen anwenden; Phase 3.4/3.5
(Haushalt/Coverage-Frage), Phase 4 (Gap & Empfehlungen), Aggregation pro Produkt (FIFO),
volle `count`/`unit_size`-Trennung, `grams_for`-Verfeinerung (1.4).

---

## Phase 0 — Freischalter (blockiert alles andere)

**0.1 `.gitignore` reparieren.** ✅ **Erledigt** (commit e524c8d): Regel auf `/lib/`
verankert, `frontend/src/lib/` eingecheckt. *(Ursprung: die Python-Template-Zeile `lib/`
verschluckte `frontend/src/lib/`, das Frontend ließ sich nicht bauen.)*

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
- **1.3 Mengenerfassung `count` × `unit_size`.** ⚠️ **Teilweise / anders gelöst.** Statt der
  vollen Trennung wurde für Multipacks die **Parser-Multiplikation** gewählt (commit c547be6):
  liegt ein „×N"-Multiplikator neben einer *gemessenen* Größe, rechnet der Parser sie zur
  **Gesamtmenge** zusammen (Joghurt 4×150 g → 600 g). Das deckt die häufigen Fälle ab, ohne
  Schema-Umbau. Die **volle `count`/`unit_size`-Trennung** ([Vorrat.md §6.3](Vorrat.md)) bleibt
  **zurückgestellt** — nötig erst für becherweises Abhaken aggregierter Multipacks; berührt dann
  [`grams_for`](backend/app/services/nutrition_profile.py#L27) und Konsum.mds `factor`.
- **1.4 (optional) `grams_for` verfeinern:** 1 g/ml-Näherung + 100-g-Stück-Default sind grob.

---

## Phase 2 — Vorrat / Basket ([Vorrat.md](Vorrat.md)) — ✅ umgesetzt

Eigenständig, hoher Nutzerwert, kann parallel zu Phase 1 laufen.

- ✅ **2.1 Migration** [`0008_pantry.sql`](supabase/migrations/0008_pantry.sql): Tabelle
  `pantry_removals` (`receipt_item_id`, `reason ∈ {eaten, removed}`, `quantity` optional,
  `removed_at`) + View `v_pantry`. **Nachgezogen:** [`0009_pantry_partial.sql`](supabase/migrations/0009_pantry_partial.sql)
  ersetzt `v_pantry` durch eine Variante mit `remaining_quantity` (Teil-Entnahme).
- ✅ **2.2 Repo** ([repo.py](backend/app/db/repo.py)): `add_pantry_removal(...)`,
  `remove_pantry_removal(id)`, `get_pantry(profile_id)`, `get_lot_remaining(id)` (für den
  Clamp), `get_receipt_item_owner(id)` (Ownership).
- ✅ **2.3 API** ([pantry.py](backend/app/api/pantry.py), Auth via `require_profile_id`):
  `GET /pantry`, `POST /pantry/removals` (mit `quantity` + Server-Clamp auf den Rest),
  `DELETE /pantry/removals/{id}`.
- ✅ **2.4 Frontend Basket-Page** ([BasketPage.tsx](frontend/src/pages/BasketPage.tsx)):
  pro-Lot-Liste, Icon-Buttons 🍴 (gegessen) / 🗑️ (entfernt) je mit Mengen-Regler,
  Route + Nav-Link. **Abweichungen vom Plan:** keine `Mockup.html` (existierte nie);
  „entfernt" ist ein zweiter Icon-Button statt „⋯"-Menü; **keine** Startseiten-Umleitung
  für Bestandskunden (IA-Umbau bewusst zurückgestellt).
- **Merke:** `gegessen` und `entfernt` senken **beide** den Bestand; die Gap-Wirkung
  unterscheidet sich erst in Phase 4 ([GapUndEmpfehlung §4](GapUndEmpfehlung.md)).
- ✅ **Teil-Entnahme** (war „Später") — via `pantry_removals.quantity` + `remaining_quantity`,
  Regler pro Zeile (Zahlenfeld bei Masse, Viertel-Schieberegler bei Stück).
- **Später (weiterhin offen):** aggregierte Anzeige pro Produkt (FIFO).

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
- **5.2 Navigation / IA** (Vision; die früher referenzierte `Mockup.html` existiert **nicht**
  im Repo): Bottom-Nav **Basket · Tipp · Insights** + Profil-Icon + „+"-FAB; Purchases →
  **Bon-Verlauf** hinters Profil; Bestandskunden landen auf Basket, neue → Onboarding.
  **Teil-Vorgriff:** Der **Purchases-Tab ist bereits ausgeblendet** (Route + Nav-Link entfernt,
  Seite als Datei behalten); der restliche IA-Umbau (Bottom-Nav/FAB, Basket als Landing) steht
  noch aus.

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

- **IST-Begriff je Feature** (Phase 0.2). **Bewusst in den nächsten Sprint verschoben:**
  erst Phase 2 + 3 bauen, dann am konkreten Datenstand entscheiden. Blockiert nur Phase 4
  (Gap-Design), nicht Phase 2/3. **Guardrail:** `eaten` und `removed` in Phase 2 getrennt
  speichern (nicht kollabieren), sonst ist der Konsum-Korrektur-Pfad in Phase 4 zu.
- **Basket-Anzeige:** ✅ **entschieden** — pro-Lot (MVP) gebaut; pro-Produkt aggregiert
  ([Vorrat.md §5](Vorrat.md)) bewusst in einen späteren Sprint verschoben.
- **Empfehlungs-Zutaten:** kontrollierte Liste vs. freie Gemini-Zutaten
  ([GapUndEmpfehlung §3.2](GapUndEmpfehlung.md)).
- **Coverage-Schwelle**, ab der Empfehlungen als „unsicher" gelabelt werden.

## Nicht Teil dieser drei Docs (separat, nur zur Erinnerung)

- **BLS-first-Matching** — zurückgestellte Änderung an
  [resolver.py](backend/app/services/resolver.py) (heute OFF-first). Unabhängig von den
  drei Docs; nur anfassen, wenn bewusst gewollt.
