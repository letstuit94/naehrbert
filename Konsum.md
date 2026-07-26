# Konsum statt Einkauf — Konzept & Umsetzung

Wie wir die Makro-Verteilung der Results von „was gekauft wurde" auf „was tatsächlich
konsumiert wird" umstellen — mit **so wenig User-Input wie möglich**.

---

## 1. Ausgangslage (Ist-Zustand)

Die Results-Verteilung wird in
[`compute_basket_composition`](backend/app/services/basket_composition.py#L52-L74)
berechnet: Sie summiert **alle jemals bestätigten** Kassenbon-Positionen eines Profils
([`get_all_confirmed_receipt_items`](backend/app/db/repo.py#L108-L126)), skaliert jede über
`grams_for(...) / 100` auf die gekaufte Menge und bildet einen **kalorien-gewichteten**
Protein/Fett/Carb-Split ([`_pct_split`](backend/app/services/basket_composition.py#L37-L49)).

**Kernproblem:** Das ist eine **Lebenszeit-Summe aller Einkäufe** — kein Zeitbezug, kein
Personenbezug, keine Korrektur für das, was mit den Lebensmitteln wirklich passiert.
„Warenkorb" meint faktisch „alles, was du je hochgeladen hast".

---

## 2. Learning: Warum Einkauf ≠ Konsum

Vier Effekte trennen den Einkauf vom tatsächlichen Konsum. Entscheidend ist, dass sie
**unterschiedlich** auf absolute Mengen und auf die **Verteilung (%)** wirken:

| Effekt | Absolut | Verteilung (%) | Ursache |
|---|:---:|:---:|---|
| **Zeitpunkt** (wöchentlich kaufen, täglich essen) | ja | nein¹ | Einkauf ist bursty, Konsum glatt |
| **Haushalt teilt** (mehrere Personen aus 1 Bon) | ja, stark | **nein** | konstanter Teiler kürzt sich in den Prozenten raus |
| **Bulk / Vorrat** (5 kg Reis über Monate) | ja | ja | verzerrt kurze Zeitfenster |
| **Verderb / Verschwendung** | ja | leicht | Obst/Gemüse verderben stärker als Trockenware |
| **Auswärts essen** (nie als Lebensmittel gekauft) | **unterschätzt** | ja | Restaurant-/Kantinen-Essen hat anderes Makroprofil |

¹ über ein ausreichend langes Fenster vernachlässigbar

### Zwei zentrale Einsichten

1. **Verteilung ist skaleninvariant.** Jeder Effekt, der Protein/Fett/Carbs *gleichmäßig*
   skaliert (v. a. Haushaltsgröße), verschwindet in den Prozenten. Für die reine
   Makro-*Verteilung* verzerren daher nur **Bulk-Käufe**, **differenzieller Verderb** und
   **Auswärts-Essen mit abweichendem Makroprofil**.

2. **Massenerhaltung.** Über ein genügend langes Fenster gilt
   **Ø-Einkaufsrate = Ø-Konsumrate** — man kann auf Dauer nicht mehr essen als man kauft,
   und der Vorrat wächst nicht unendlich. Deshalb lässt sich der Konsum aus Einkaufsdaten
   *überhaupt* rekonstruieren, ohne den User zu fragen.

---

## 3. Empfehlung: gestaffelt nach Input-Aufwand

### Stufe 1 — Null Input: gleitendes Fenster + Tagesrate
Nur Bons der letzten **N Tage** (Default ~28 ≈ 4 Wocheneinkäufe) statt „alle jemals",
geteilt durch die Tageszahl → **Konsum pro Tag**. Wandelt „alle Einkäufe" direkt in eine
aktuelle Konsumrate. Datum (`purchased_at`) ist bereits vorhanden.

### Stufe 2 — Null Input: EWMA-Glättung
Bons **exponentiell nach Aktualität** gewichten (Halbwertszeit ~30 Tage) statt harter
Fenstergrenze. Ein einmaliger Bulk-Kauf spikt so nicht das ganze Fenster; die Verteilung
passt sich sanft an geänderte Gewohnheiten an.

### Stufe 3 — Null Input, optional: Verderb-Koeffizienten
Statische Lookup-Tabelle je Kategorie („edible yield", z. B. Obst/Gemüse 0.85,
Trockenware 1.0). Verschiebt die Verteilung leicht Richtung Konsum.
**Modellannahme, niedrigere Konfidenz** → abschaltbarer Feinschliff, nicht Kern.

### Stufe 4 — Frage 1 (einmalig): Haushaltsgröße
„Wie viele Personen essen regelmäßig aus euren Einkäufen mit?" Höchstwertige Einzelfrage
für **absolute** Werte (kcal/Protein-Gramm vs. Target). **Für die reine Verteilung nicht
nötig** — kürzt sich raus. Wird aber von Stufe 5 (Coverage) gebraucht.

### Stufe 5 — Auswärts essen: Coverage messen + Frage 2
- **Coverage (Null Input):** Grocery-kcal/Tag/Person gegen **TDEE-Target** vergleichen.
  Große Lücke ⇒ viel ungedeckt. Vermischt zwar Auswärts-Essen + Verderb + ungescannte
  Einkäufe, taugt aber hervorragend als **Vertrauensmaß**: bei hoher Coverage ist die
  Korrektur egal; bei niedriger dominieren Annahmen — das dem User **ehrlich labeln**.
- **Frage 2 (einmalig): Auswärts-Frequenz.** „Wie viele Mahlzeiten pro Woche außer Haus?"
  → Anteil *f*. Korrektur:
  - Verteilung: `verteilung = (1 − f)·zuhause + f·restaurant_default`
    (statisches, grobes Makro-Template; optional Selektor Kantine/Restaurant/Fast Food)
  - Absolut: Heim-Konsum deckt `(1 − f)` der Mahlzeiten → hochskalieren
- Die gemessene Coverage-Lücke kann *f* **vorschlagen**, das der User nur bestätigt
  („Deine Einkäufe decken ~60 % deines Bedarfs — isst du oft auswärts?").

---

## 4. Der gesamte Input auf einen Blick

| Realismus-Baustein | User-Input |
|---|---|
| Timing / Tagesrate | **keiner** |
| Bulk-Glättung | **keiner** |
| Verderb (optional) | **keiner** |
| Haushalt (absolute Werte) | 1× Haushaltsgröße |
| Auswärts essen | 1× Frequenz (Coverage kann sie vorschlagen) |

→ **Genau zwei einmalige Onboarding-Fragen** für den vollen Konsum-Realismus; alles davor
ist Null-Input.

### Ausdrücklich *nicht* empfohlen
Food-Diary / Bestätigen einzelner Mahlzeiten oder Scannen von Restaurant-Bons — maximale
Genauigkeit, aber genau der laufende Aufwand, den wir vermeiden wollen. Höchstens später
als optionaler Opt-in-Nudge.

---

## 5. Andockpunkte im Code

| Schritt | Ort |
|---|---|
| Datum in Analyse-Query mitziehen | [`get_all_confirmed_receipt_items`](backend/app/db/repo.py#L108-L126) — `purchased_at`/`created_at` in den `select`-Join |
| Fenster + Gewichtung + Tagesrate | [`compute_basket_composition`](backend/app/services/basket_composition.py#L52-L74): Parameter `reference_date`, `window_days`, optional `recency_weight`; `factor = grams/100 * weight` |
| Prozent-Logik | [`_pct_split`](backend/app/services/basket_composition.py#L37-L49) bleibt unverändert (schon gewichtsbasiert) |
| Haushaltsgröße, Auswärts-Frequenz | neues Feld auf [`Profile`](backend/app/models/profile.py#L71-L112) |
| Coverage (Grocery-kcal vs. TDEE), Auswärts-Mischung, Labeling | [`analysis.py`](backend/app/api/analysis.py) — dort laufen Targets ([`compute_ideal_profile`](backend/app/services/ideal_profile.py#L97-L165)) und Results zusammen |

### Konkreter erster Schritt
Stufe 1 + 2 sind rein backend-seitig (~½ Tag): Datum in die Query, Fenster + EWMA in
`compute_basket_composition`, Tagesrate zusätzlich ausweisen, Fensterlänge/Halbwertszeit
als konfigurierbare Defaults, Tests. Die Prozent-Logik ändert sich nicht.

---

## 6. Offene Punkte / Vorsicht
- **Konfidenz kommunizieren:** Bei wenigen Bons oder niedriger Coverage ist die Verteilung
  wackelig — als solche kennzeichnen, nicht Präzision vortäuschen.
- **Restaurant-Template ist eine Annahme.** Ohne Einzel-Logging bleibt der Makro-Mix des
  Auswärts-Essens geschätzt.
- Bereits bekannte, davon **unabhängige** Baustellen (aus der Analyse der Berechnungslogik):
  `or 0.0` verwechselt „unbekannt" mit „null"; Fallback kollabiert faktisch auf `"other"`;
  grobe Mengenumrechnung (1 g/ml, 100 g-Default). Diese verzerren die Results zusätzlich,
  sind aber getrennt zu beheben.
- **Abhängigkeit zur Vorrats-Planung:** [Vorrat.md §6.3](Vorrat.md) plant, die
  `quantity`-Semantik in getrennte `count` × `unit_size` aufzuspalten. Das ändert die
  Grundlage von `grams_for`/`factor` (Andockpunkte in §5 oben) — wird das umgesetzt,
  müssen die Mengen-Rechnungen hier mitgezogen werden. Ebenfalls verwandt:
  [GapUndEmpfehlung.md](GapUndEmpfehlung.md) (Konsum = Einkauf als Gap-Basis, Vorrat-
  `entfernt` als Verderb-Korrektur).
