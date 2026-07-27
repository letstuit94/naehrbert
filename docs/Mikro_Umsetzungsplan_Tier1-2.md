# Mikronährstoffe — Umsetzungsplan Tier 1 / 1b / 2

Konkreter, datei-für-datei-Plan für die **9 Floor-Nährstoffe**. Natrium (Ceiling)
ist **nicht** Teil dieses Plans (eigener, isolierter PR wegen invertierter Logik).

| Tier | Nährstoffe | Key | Einheit | Besonderheit |
|------|-----------|-----|---------|--------------|
| 1  | Kalzium, Magnesium, Zink, Kalium, Vitamin C, Vitamin D | `calcium_mg`, `magnesium_mg`, `zinc_mg`, `potassium_mg`, `vitamin_c_mg`, `vitamin_d_ug` | mg / µg | Floor, DGE-Ziel höchstens geschlechtsabhängig |
| 1b | Vitamin B12, Folat | `vitamin_b12_ug`, `folate_ug` | µg | Floor, Einheit µg durchziehen |
| 2  | Eisen | `iron_mg` | mg | Floor, DGE-Ziel geschlechts- **und** (bei Frauen) altersabhängig |

Alle 9 sind **Floor** (mehr = besser). Daten liegen bereits vor
(`bls_matcher._MICRO_COLS`, gespeichert in `receipt_items.micros` jsonb). Der Plan
beginnt bei den Zielwerten und der Aggregation — **keine Änderung an der
Einleseschicht**.

---

## Gesetzte Entscheidungen (vor Code)

**E1 — Dichte-Basis (Logikfehler-Falle Nr. 1).**
Mikro-Dichte wird als `summe(micro) / kcal_MIT_bekanntem_wert * 1000` gerechnet,
**nicht** `summe(micro) / kcal_total`. Das weicht **bewusst** vom `fiber`-Muster
(`basket_composition.py:210`, dort `/ kcal_total`) ab:
- Fiber ist bei Makro-Matches fast immer bekannt → Coverage hoch → Verwässerung
  vernachlässigbar.
- Mikros haben lückige Coverage. `/ kcal_total` würde einen Nährstoff, der nur auf
  30 % der kcal bekannt ist, um ~70 % zu niedrig ausweisen → falscher „Mangel".
- Das Plan-Dokument fordert explizit: *„fehlender Wert = unbekannt, nicht 0. Nur
  bekannte Werte zählen (sonst Verwässerung)."*
Die Ehrlichkeit über die Extrapolation trägt **`coverage_pct` pro Nährstoff**, nicht
ein verwässerter Zahlenwert.

**E2 — Zielwert = Tagesziel → Dichte über kcal-Ziel.**
`ziel_pro_1000kcal = dge_tagesziel / (calories_kcal / 1000)`. Umrechnung passiert in
`compute_ideal_profile`, wo `calories` bekannt ist (analog `fiber_g`). Damit ist Ist
(Dichte aus Warenkorb) direkt mit Ziel (Dichte aus Tagesbedarf) vergleichbar,
zeitbezugsfrei.

**E3 — Richtung als Metadatum, nicht als Zahl.**
Richtung (`floor`/`ceiling`) und Einheit sind **konstant pro Nährstoff** → leben
statisch in `micro_requirements.py`, nicht in den per-Profil-Daten. Alle 9 hier sind
`floor`. Das `direction`-Feld wird trotzdem von Anfang an durch die API
mitgeführt, damit Natrium (Ceiling) später nur das Feld umschaltet, ohne die
Vergleichslogik anzufassen (Forward-Compat).

**E4 — Mikros immer aus `item["micros"]` lesen**, nie aus den flachen
`iron_mg`/`calcium_mg`-Spalten (die existieren nur für 2 Nährstoffe, Backward-Compat).
Einheitlich `(item.get("micros") or {}).get(key)` — wie `bucketing.py:76` es bereits macht.

**E5 — DGE-Quelle dokumentieren** (offener Punkt Phase 0). Die Zahlen unten sind
**Platzhalter** und vor Merge gegen die DGE-Referenzwerte (Lizenz/Quelle) zu
verifizieren. Struktur bleibt gleich.

---

## DGE-Referenzwerte (Platzhalter — Quelle vor Merge fixieren)

Erwachsene. `m` = männlich, `w` = weiblich, `d` (prefer_not_to_say) = Mittelwert.

| Key | m | w | Alters-Split (w) | Einheit | Richtung |
|-----|---|---|------------------|---------|----------|
| `calcium_mg`    | 1000 | 1000 | – | mg | floor |
| `magnesium_mg`  | 350  | 300  | – | mg | floor |
| `zinc_mg`       | 10   | 7    | – | mg | floor |
| `potassium_mg`  | 4000 | 4000 | – | mg | floor |
| `vitamin_c_mg`  | 110  | 95   | – | mg | floor |
| `vitamin_d_ug`  | 20   | 20   | – | µg | floor |
| `vitamin_b12_ug`| 4.0  | 4.0  | – | µg | floor |
| `folate_ug`     | 300  | 300  | – | µg | floor |
| `iron_mg`       | 10   | **15 / 10** | 15 bei < 51 J. (menstruierend), sonst 10 | mg | floor |

Tier 1/1b: höchstens ein Geschlechts-Branch. Tier 2 (Eisen): zusätzlich Alters-Branch
innerhalb `w` → daher „mittel" statt „klein".

---

## Schritt 1 — `micro_requirements.py` (neu) · Tier 1 + 1b + 2

Datei `backend/app/services/micro_requirements.py`. Reine Referenz-/Nachschlagelogik,
keine LLM, keine Randomness (analog `ideal_profile.py`).

```python
"""DGE-Referenz-Engine für Mikronährstoff-Zielwerte (Floor, Tier 1/1b/2).

Tagesziele je (Geschlecht, Altersband). Einheit + Richtung sind pro
Nährstoff konstant und liegen hier statisch. Quelle/Lizenz der DGE-Werte:
<TODO E5 vor Merge>.
"""
from backend.app.models.profile import Sex

# Richtung + Einheit — konstant pro Nährstoff (E3). Alle Tier 1/1b/2 = floor.
MICRO_META = {
    "calcium_mg":     {"unit": "mg", "direction": "floor"},
    "magnesium_mg":   {"unit": "mg", "direction": "floor"},
    "zinc_mg":        {"unit": "mg", "direction": "floor"},
    "potassium_mg":   {"unit": "mg", "direction": "floor"},
    "vitamin_c_mg":   {"unit": "mg", "direction": "floor"},
    "vitamin_d_ug":   {"unit": "ug", "direction": "floor"},
    "vitamin_b12_ug": {"unit": "ug", "direction": "floor"},
    "folate_ug":      {"unit": "ug", "direction": "floor"},
    "iron_mg":        {"unit": "mg", "direction": "floor"},
}

# Tagesziele. Wert = Zahl ODER Callable(age) für altersabhängige Fälle (Eisen).
_DAILY = {
    "calcium_mg":     {"m": 1000, "w": 1000},
    "magnesium_mg":   {"m": 350,  "w": 300},
    "zinc_mg":        {"m": 10,   "w": 7},
    "potassium_mg":   {"m": 4000, "w": 4000},
    "vitamin_c_mg":   {"m": 110,  "w": 95},
    "vitamin_d_ug":   {"m": 20,   "w": 20},
    "vitamin_b12_ug": {"m": 4.0,  "w": 4.0},
    "folate_ug":      {"m": 300,  "w": 300},
    # Tier 2: Frauen < 51 J. menstruierend → 15 mg, sonst 10 mg.
    "iron_mg":        {"m": 10,   "w": lambda age: 15 if age < 51 else 10},
}

def _resolve(value, age):
    return value(age) if callable(value) else value

def daily_targets(sex: Sex, age: int) -> dict:
    """Tages-Zielwerte je Nährstoff. prefer_not_to_say = Mittel m/w (analog _bmr)."""
    out = {}
    for key, by_sex in _DAILY.items():
        m = _resolve(by_sex["m"], age)
        w = _resolve(by_sex["w"], age)
        if sex == Sex.MALE:
            out[key] = m
        elif sex == Sex.FEMALE:
            out[key] = w
        else:
            out[key] = (m + w) / 2
    return out
```

**Tests** `backend/tests/test_micro_requirements.py` (neu):
- m vs. w korrekt (z. B. `zinc_mg` 10 vs. 7).
- Eisen-Altersgrenze: w/40 → 15, w/60 → 10, m/40 → 10.
- `prefer_not_to_say` = Mittelwert.
- Alle Keys aus `MICRO_META` auch in `_DAILY` (Vollständigkeit).

---

## Schritt 2 — `IdealProfile` + `compute_ideal_profile` · alle Tiers

**`models/profile.py`** — `IdealProfile` um ein Feld erweitern:

```python
# Ziel-DICHTE je Mikro (target pro 1000 kcal), None wenn Biometrie fehlt.
micronutrients: Dict[str, float] = Field(default_factory=dict)
```

**`services/ideal_profile.py`** — nach `fiber_g` (die Stelle mit `calories`):

```python
from backend.app.services.micro_requirements import daily_targets

# Tagesziel → Dichte (E2): ziel_pro_1000kcal = tagesziel / (kcal / 1000)
micronutrients = {}
if calories and calories > 0:
    for key, daily in daily_targets(profile.sex, age).items():
        micronutrients[key] = round(daily / (calories / 1000.0), 2)
```

…und in den `IdealProfile(...)`-Konstruktor `micronutrients=micronutrients` einhängen.
`age`/`profile.sex` sind an dieser Stelle bereits validiert vorhanden. Bei fehlender
Biometrie greift der bestehende `return None` weiter oben → graceful, unverändert.

**Tests** `test_ideal_profile.py` erweitern:
- `micronutrients` gefüllt, richtige Keys, plausible Dichte
  (`calcium_mg`-Ziel ≈ `1000 / (kcal/1000)`).
- Frau vs. Mann → unterschiedliche `iron_mg`-Dichte.
- Höheres kcal-Ziel → niedrigere Ziel-**Dichte** (Umrechnung greift).

---

## Schritt 3 — `basket_composition.py` (Aggregation) · alle Tiers

Mikro-Summen + **Paired-None** + **Per-Nährstoff-Coverage** (E1). In der Item-Schleife:

```python
# vor der Schleife:
from backend.app.services.micro_requirements import MICRO_META
micro_totals = {k: 0.0 for k in MICRO_META}
micro_kcal_covered = {k: 0.0 for k in MICRO_META}   # kcal MIT bekanntem Wert

# in der Schleife, nach fiber:
item_micros = item.get("micros") or {}
for key in MICRO_META:
    val = item_micros.get(key)
    if val is not None:                    # None = unbekannt, NICHT 0 (E1)
        micro_totals[key] += val * factor
        micro_kcal_covered[key] += kcal_contrib
```

Nach der Schleife (E1 — durch abgedeckte kcal teilen, nicht `kcal_total`):

```python
micro_per_1000kcal = {}
micro_coverage_pct = {}
for key in MICRO_META:
    covered = micro_kcal_covered[key]
    micro_per_1000kcal[key] = round(micro_totals[key] / covered * 1000, 2) if covered > 0 else None
    micro_coverage_pct[key] = round(covered / kcal_total * 100, 1)   # kcal_total hier > 0 garantiert
```

…ins Rückgabe-Dict aufnehmen:

```python
"micro_per_1000kcal": micro_per_1000kcal,
"micro_coverage_pct": micro_coverage_pct,
```

**Tests** `test_basket_composition.py` erweitern:
- Summierung × `factor` korrekt.
- **None-Handling**: Item ohne `magnesium_mg` verwässert `magnesium_mg` **nicht**
  (Dichte = Summe/abgedeckte-kcal, nicht /kcal_total) — der explizite E1-Regressionstest.
- `coverage_pct` = Anteil kcal mit bekanntem Wert (ein Item bekannt / eins nicht → ~50 %).
- Recency-Gewichtung (`factor` enthält `weight`) wirkt auch auf Mikros.
- Nährstoff auf 0 Items bekannt → `micro_per_1000kcal[key] is None`, `coverage 0`.

---

## Schritt 4 — API `/analysis/micro-comparison` · alle Tiers

**`api/analysis.py`** — neuer Endpoint, Spiegel von `target-comparison`.

`_EMPTY_COMPOSITION` um `"micro_per_1000kcal": {}`, `"micro_coverage_pct": {}` ergänzen.
`_targets_or_404` liefert heute nur `macro_percentages`; für Mikros zusätzlich das
`IdealProfile.micronutrients`-Dict durchreichen (kleiner Helper `_micro_targets_or_404`,
der `compute_ideal_profile(...).micronutrients` zurückgibt).

```python
@router.get("/micro-comparison")
def get_micro_comparison(profile_id: int = Depends(require_profile_id)):
    """Ist- vs. Ziel-Dichte je Mikronährstoff (Floor, Tier 1/1b/2).

    Rohe EINKAUFS-Dichte, keine tatsächliche Aufnahme (Disclaimer im FE).
    delta = actual - target; bei Floor: delta >= 0 = Ziel erreicht.
    """
    micro_targets = _micro_targets_or_404(profile_id)   # {key: ziel_pro_1000kcal}
    items = repo.get_all_confirmed_receipt_items(profile_id)
    composition = compute_basket_composition(items, reference_date=_today(),
                                             window_days=_RESULTS_WINDOW_DAYS) or _EMPTY_COMPOSITION
    actual = composition.get("micro_per_1000kcal") or {}
    coverage = composition.get("micro_coverage_pct") or {}

    nutrients = []
    for key, meta in MICRO_META.items():
        a = actual.get(key)
        t = micro_targets.get(key)
        delta = round(a - t, 2) if (a is not None and t is not None) else None
        # Floor: erreicht wenn a >= t. (Ceiling später: a <= t — nur diese Zeile.)
        met = (delta is not None and delta >= 0) if meta["direction"] == "floor" else \
              (delta is not None and delta <= 0)
        nutrients.append({
            "key": key,
            "unit": meta["unit"],
            "direction": meta["direction"],
            "actual_per_1000kcal": a,
            "target_per_1000kcal": t,
            "delta_per_1000kcal": delta,
            "target_met": met if delta is not None else None,
            "coverage_pct": coverage.get(key),
        })
    return {
        "nutrients": nutrients,
        "based_on_purchases": True,   # Honesty-Flag (roher Einkauf, keine Aufnahme)
        "items_considered": composition.get("items_considered", 0),
    }
```

**Optional (später, nicht Tier-1-blockierend):** `sources`-Aufschlüsselung je Nährstoff
(Anteil kcal aus `off`/`bls`/`category` aus `item["sources"]`) — analog Coverage
aggregieren. Als eigenes Feld `source_breakdown` nachrüstbar.

**Tests** `test_api_smoke.py` erweitern: Endpoint 200, Shape `nutrients[]`, Floor-Delta-
Vorzeichen (Ist > Ziel → `target_met true`), leerer Warenkorb → `actual` None, kein 500.

---

## Schritt 5 — Frontend · alle Tiers

**`frontend/src/lib/api.ts`**:

```ts
export interface MicroNutrient {
  key: string
  unit: 'mg' | 'ug'
  direction: 'floor' | 'ceiling'
  actual_per_1000kcal: number | null
  target_per_1000kcal: number | null
  delta_per_1000kcal: number | null
  target_met: boolean | null
  coverage_pct: number | null
}
export interface MicroComparisonResult {
  nutrients: MicroNutrient[]
  based_on_purchases: boolean
  items_considered: number
}
export function getMicroComparison(): Promise<MicroComparisonResult> {
  return request<MicroComparisonResult>('/analysis/micro-comparison')
}
```

**`frontend/src/pages/ResultsPage.tsx`** — neuer Abschnitt „Mikronährstoffe" (in den
bestehenden `Promise.allSettled`/`Slice`-Ladeflow einreihen, wie `getTargetComparison`):
- Pro Nährstoff: Anzeigename + Einheit, Ist- vs. Ziel-Dichte, Ampel gegen
  `target_met` / `delta` (Floor: grün ≥ Ziel). Label-Map key→deutscher Name.
- **Coverage-Hinweis**, wenn `coverage_pct` niedrig — konsistent mit bestehenden
  `low_confidence`-Hinweisen.
- **Deutlicher Disclaimer** (Pflicht): Werte = *eingekaufte Rohmengen*, nicht
  tatsächliche Aufnahme (Zubereitungsverluste, Bioverfügbarkeit).
- Nährstoffe mit `actual == null` (nie im Warenkorb bekannt) grau/„keine Daten".

---

## Reihenfolge & PR-Schnitt

Schritte 1–5 sind für **alle 9 Nährstoffe dieselbe Maschinerie** — der Tier-Unterschied
steckt allein in der Zieltabelle (Schritt 1). Empfohlener Schnitt:

1. **PR A (Backend-Kern, Tier 1 + 1b gemeinsam):** Schritte 1–4 mit den 8 Floor-Zielen
   ohne Alters-Branch. Eisen in `_DAILY` zunächst weglassen. Voll getestet.
2. **PR B (Tier 2 / Eisen):** in `_DAILY` den `iron_mg`-Eintrag mit Alters-Callable +
   Test für die 51-J.-Grenze ergänzen. Sonst **keine** Code-Änderung nötig — die
   Pipeline ist nährstoff-agnostisch. Zeigt, dass Tier 2 wirklich nur „Zieltabelle
   verzweigt" ist.
3. **PR C (Frontend):** Schritt 5 gegen den fertigen Endpoint.

Damit ist der riskante Teil (Aggregations-/Dichte-Logik, E1) einmalig in PR A gekapselt
und durchgetestet, bevor Eisen und UI darauf aufsetzen.

## Forward-Compat für Natrium (Ceiling, NICHT in diesem Plan)

Der Plan ist so gebaut, dass Natrium später **ohne Änderung** an Aggregation/API-Schleife
hinzukommt: `micro_requirements` bekommt `sodium_mg: {"direction": "ceiling"}` + Tagesziel,
und die einzige verzweigende Stelle (`target_met`-Zeile in Schritt 4) behandelt `ceiling`
bereits. Trotzdem eigener PR + eigener Test, weil es der erste invertierte Fall ist und die
Delta-Interpretation im Frontend (Überschreitung = schlecht, Ampel umgekehrt) gesondert
geprüft werden muss.
