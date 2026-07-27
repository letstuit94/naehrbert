# Mikronährstoffe — Umsetzungsplan

Ziel: Neben Makros (Protein/Fett/Kohlenhydrate/Ballaststoffe) und Kalorien auch
**Mikronährstoffe** auswerten und gegen personalisierte Ziele vergleichen.

Angefragte Nährstoffe: Eisen, Kalium, Kalzium, Magnesium, Zink, Natrium,
Vitamin B, Vitamin C, Vitamin D. (Vitamin A: **bewusst nicht Teil des Umfangs.**)

Interne Keys (bestehende Konvention, Einheit im Suffix — 1:1 kompatibel mit
`NutritionValues.micros` und den BLS-Spalten):

| Nährstoff   | Key             | Einheit | Richtung  | Extraktion heute |
|-------------|-----------------|---------|-----------|------------------|
| Eisen       | `iron_mg`       | mg      | Floor     | ✅ BLS            |
| Kalium      | `potassium_mg`  | mg      | Floor     | ✅ BLS            |
| Kalzium     | `calcium_mg`    | mg      | Floor     | ✅ BLS            |
| Magnesium   | `magnesium_mg`  | mg      | Floor     | ✅ BLS            |
| Zink        | `zinc_mg`       | mg      | Floor     | ✅ BLS            |
| Natrium     | `sodium_mg`     | mg      | **Ceiling** | ✅ BLS          |
| Vitamin C   | `vitamin_c_mg`  | mg      | Floor     | ✅ BLS            |
| Vitamin D   | `vitamin_d_ug`  | µg      | Floor     | ✅ BLS            |
| Vitamin B12 | `vitamin_b12_ug`| µg      | Floor     | ✅ BLS            |
| Folat (B9)  | `folate_ug`     | µg      | Floor     | ✅ BLS            |

**Vitamin A ist nicht Teil des Umfangs** (Entscheidung). Keine neue BLS-Extraktion,
kein Cache-Rebuild nötig.

**„Vitamin B" = B12 + Folat** (Entscheidung Phase 0). Beide sind bereits in der
Pipeline. B1/B2/B6 werden bewusst nicht ergänzt.

**Konsequenz:** Alle Nährstoffe im Umfang werden bereits heute aus BLS extrahiert
und gespeichert — **es ist keinerlei Änderung an der Einleseschicht erforderlich.**
Die Arbeit beginnt bei den Zielwerten (Phase 2).

---

## Ausgangslage (was bereits steht)

Die **Einlese-/Speicherschicht** ist zu großen Teilen fertig:

- `backend/app/models/nutrition.py` — `NutritionValues.micros` (dict) + `sources`
  (Provenienz je Wert: `off` / `bls` / `category`).
- `backend/app/services/bls_matcher.py` — `_MICRO_COLS` extrahiert 10 Mikros aus
  dem BLS-4.0-Export; `record_nutrition()` gibt sie an den Resolver weiter.
- `backend/app/services/resolver.py` — OFF→BLS-Bridge überlagert BLS-Mikros auf
  eine OFF-Identität und taggt die Herkunft.
- `supabase/migrations/0001_init_schema.sql` — `receipt_items.micros jsonb`,
  `sources jsonb` sind vorhanden. **Keine Migration nötig**, außer man will die
  Provenienz-/Coverage-Auswertung indizieren.
- `backend/app/services/nutrition_mapping.py` — persistiert `micros`+`sources`.

Es **fehlt** die komplette Auswertungs-, Ziel- und Anzeigeschicht (siehe Phasen).

---

## Phasen

### Phase 0 — Entscheidungen (Blocker, vor Code)
- [x] **„Vitamin B" = nur B12 + Folat** (beide bereits extrahiert/gespeichert,
      kein zusätzlicher BLS-Aufwand). B1/B2/B6 werden **nicht** ergänzt.
- [x] **Zeitbezug = dichtebasiert (Mikro pro 1000 kcal)**, nicht Tagesrate.
      Begründung: der Warenkorb deckt eine unbekannte Anzahl Tage ab; % Energie /
      g-pro-1000-kcal umgehen das bereits erfolgreich
      (`ideal_profile.FIBER_G_PER_1000KCAL`, `basket_composition`). DGE-Tagesziele
      werden über das kcal-Ziel in dieselbe Dichte umgerechnet:
      `ziel_pro_1000kcal = dge_tagesziel / (kcal_ziel / 1000)`.
- [ ] Quelle & Lizenz der DGE-Referenzwerte dokumentieren.

### Phase 1 — Datenquelle vervollständigen — **entfällt**
Alle Nährstoffe im Umfang (Eisen, Kalium, Kalzium, Magnesium, Zink, Natrium,
Vit C, Vit D, B12, Folat) werden bereits von `bls_matcher._MICRO_COLS` extrahiert
und persistiert. Keine neue Extraktion, kein Cache-Rebuild.
- [ ] (Optional, geringer Nutzen) OFF-Mikros in `off_api.py` erweitern (heute nur
      iron/calcium). OFF-Mikrodaten sind dünn; Aufwand vs. Ertrag abwägen.

### Phase 2 — Zielwerte (DGE-Referenz-Engine)
- [ ] Neue Referenztabelle `backend/app/services/micro_requirements.py`
      (der in `off_api.py:36` erwähnte, aber nicht existierende
      `nutrient_requirements.py` — ggf. aus dem Vorgänger-Repo als Vorlage).
      Struktur: Nährstoff-Key → Ziel je (Geschlecht, Altersband), inkl.
      Richtung (Floor/Ceiling) und Einheit.
- [ ] `IdealProfile` (`models/profile.py`) um `micronutrients: dict` erweitern;
      `compute_ideal_profile` (`services/ideal_profile.py`) füllt sie aus
      Geschlecht + Alter (`_age_from_dob` existiert bereits). Bei fehlenden
      Biometrie-Daten → weiterhin graceful None.
- [ ] Natrium als Ceiling behandeln (analog `saturated_fat_g`).
- [ ] Tests `backend/tests/test_ideal_profile.py`: korrekte Werte je
      Geschlecht/Alter, Ceiling vs. Floor, Umrechnung in Dichte.

### Phase 3 — Aggregation über den Warenkorb
- [ ] `basket_composition.compute_basket_composition` um Mikro-Summen erweitern:
      je Item `micros[key] * factor` (mit derselben Gramm-/Recency-Gewichtung wie
      Makros), gepaart mit kcal → `micro_per_1000kcal[key]`.
- [ ] „Paired sums"-Muster aus `nutrition_profile.py` beibehalten: fehlender Wert =
      **unbekannt**, nicht 0. Nur bekannte Werte zählen (sonst Verwässerung).
- [ ] Pro Mikro eine **Coverage-Kennzahl** (Anteil kcal mit bekanntem Wert),
      analog `macro_coverage_pct` — die Ehrlichkeits-Labels sind Pflicht.
- [ ] Tests `backend/tests/test_basket_composition.py`: Summierung, None-Handling,
      Coverage, Recency-Gewichtung wirkt auch auf Mikros.

### Phase 4 — API
- [ ] `analysis.py`: neuer Endpoint `GET /analysis/micro-comparison`
      (Spiegel von `target-comparison`): pro Nährstoff `actual_per_1000kcal`,
      `target_per_1000kcal`, `delta`, Richtung, Coverage, `sources`-Aufschlüsselung
      und ein Honesty-Flag (roher Einkaufswert, keine Aufnahme).
- [ ] Ceiling-Nährstoffe im Delta korrekt interpretieren (Überschreitung = schlecht).
- [ ] Tests `backend/tests/test_api_smoke.py`.

### Phase 5 — Frontend
- [ ] `frontend/src/lib/api.ts`: Typen `MicroComparisonResult` + Fetch-Funktion.
- [ ] `frontend/src/pages/ResultsPage.tsx`: neuer Abschnitt „Mikronährstoffe"
      (Ziel/Ist je Nährstoff, Ampel gegen Delta, Ceiling andersherum).
- [ ] **Deutlicher Disclaimer**: Werte basieren auf *eingekauften Rohmengen*, nicht
      auf tatsächlicher Aufnahme (Zubereitungsverluste, Bioverfügbarkeit). Konsistent
      mit den bestehenden „low_confidence"-/Coverage-Hinweisen.
- [ ] Coverage-Hinweis anzeigen, wenn ein Mikro überwiegend aus `bls`-Schätzung
      oder Fallback-Kategorien stammt.

### Phase 6 — Empfehlungen (optional, Ausbaustufe)
- [ ] `bucketing.py` / `diversity.py`: „mehr/weniger davon"-Logik um Mikro-Lücken
      erweitern (heute nur `sodium_mg`). Baut auf Phase 2–3 auf.

---

## Herausforderungen (Zusammenfassung)

1. **Einkauf ≠ Konsum, verschärft.** Zubereitungsverluste (Vitamin C/Folat) und
   Bioverfügbarkeit (Häm- vs. Nicht-Häm-Eisen, Phytat, Kalzium↔Eisen) machen den
   eingekauften Rohwert zu einer schwächeren Proxy für die Aufnahme als bei Makros.
   → Ehrliche Labels, keine vorgetäuschte Präzision.
2. **Mehrdimensionale Ziele.** DGE hängt an Geschlecht + Alter (+ Schwangerschaft),
   braucht eine Referenztabelle statt einer Formel.
3. **Zeitbezug.** Tagesziele vs. warenkorbbasierte Dichte → über kcal-Ziel in
   `pro 1000 kcal` normalisieren.
4. **Richtungssinn.** Natrium ist Ceiling, alle anderen Floor.
5. **Datenlücken & Provenienz.** OFF liefert Mikros dünn, Fallback-Kategorien gar
   nicht → Coverage pro Nährstoff ausweisen.
6. **Einheiten** (mg/µg) über BLS, OFF und DGE konsistent halten.

## Aufwandseinschätzung (grob)
- Phase 1 (Datenquelle): **entfällt**
- Phase 2 (DGE-Engine + Ziele): mittel (Datenrecherche dominiert)
- Phase 3 (Aggregation): mittel
- Phase 4 (API): klein
- Phase 5 (Frontend): mittel
- Phase 6 (Empfehlungen): mittel, optional
