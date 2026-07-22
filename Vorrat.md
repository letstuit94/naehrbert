# Vorratsübersicht (Basket) — Konzept & Plan

Wie aus allen hochgeladenen Kassenbons ein **aktueller Vorrat** pro User entsteht,
den eine neue Frontend-Page **„Basket"** anzeigt — und warum das Datenmodell ein
**Entnahme-Ledger** ist und keine Statusspalte auf `receipt_items`.

> Status: **geplant, noch nicht gebaut.** Diese Datei ist die Entscheidungs- und
> Umsetzungsgrundlage, kein Implementierungsstand.

---

## 1. Ziel

Nach dem bestehenden Flow (Upload → OCR → Korrektur → Matching → Nährwerte) liegen
alle gekauften Positionen bereinigt und angereichert in
[`receipt_items`](supabase/migrations/0001_init_schema.sql#L40-L82). Daraus soll ein
**Vorrat** entstehen:

> **Vorrat = alle bestätigten Food-Positionen eines Users − alle Entnahmen**

Eine Entnahme passiert auf zwei Weisen:
- **„gegessen"** → das Item wurde konsumiert
- **„entfernt (x)"** → das Item ist raus, aber *nicht* gegessen (verdorben, verschenkt, Fehlkauf)

Beide reduzieren den Vorrat; der Unterschied ist analytisch wichtig (siehe §6).

---

## 2. Datenmodell-Entscheidung

Drei Ansätze wurden abgewogen:

| Ansatz | Urteil |
|---|---|
| Spalten an `receipt_items` (z. B. `consumption_status`) | ❌ mutiert die Einkaufs-Historie |
| Neue Tabelle = Kopie aller Items + Statusspalten | ❌ dupliziert Daten, driftet aus dem Takt |
| **Append-only Entnahme-Ledger + berechneter Vorrat** | ✅ gewählt |

### Warum kein Status an `receipt_items`

`receipt_items` ist ein **unveränderliches Faktenprotokoll** („Auf Bon X stand
Position Y"). Es wird bereits als reine *Einkaufs*-Historie gelesen —
[`get_all_confirmed_receipt_items`](backend/app/db/repo.py#L108-L125) summiert **alle
jemals bestätigten** Positionen für die Results, und die geplante Konsum-Logik
([Konsum.md](Konsum.md)) wertet dieselben Zeilen über Zeitfenster aus.

- **Semantische Kollision (Kerngrund):** Die Konsum-Logik schätzt Verbrauch *aus*
  Einkäufen. Würde sie „gegessene" Zeilen ausschließen, zählte sie die Korrektur
  **doppelt**. Der Vorrats-Status muss dort liegen, wo die Einkaufs-Analytik ihn per
  Default ignoriert → separate Tabelle.
- **Granularität:** Ein Produkt taucht über viele Bons auf; Teilverbrauch (1 kg Reis
  über Wochen) lässt sich mit einem Boolean nicht abbilden.
- **Audit/Zeitbezug:** Ein überschriebenes Feld verliert „wann entnommen" — genau das
  braucht die Konsum-Analyse.

### Warum kein mutable Aggregat-Bestand

Eine Tabelle „ein Stand pro Produkt, laufend rauf-/runtergerechnet" driftet, ist schwer
konsistent zu halten und macht die Rekonstruktion vergangener Zustände unmöglich.

### Gewählt: Entnahme-Ledger

`receipt_items` bleibt der unangetastete „+"-Strom (Einkauf). Eine kleine neue Tabelle
ist der „−"-Strom (Entnahme). Der Vorrat wird **zur Lesezeit berechnet**, nie
gespeichert. Es gibt also keine dritte Item-Liste.

**Wichtig:** Was der Nutzer auf der Basket-Page sieht ≠ wie es gespeichert wird. Die
Page zeigt eine Item-Liste mit „gegessen"/„entfernt"-Buttons; dahinter steht der
Ledger, keine Statusspalte.

---

## 3. Schema (geplant)

Neue Migration `0008_pantry.sql`, im Stil der bestehenden Migrationen (uuid-PK,
`timestamptz`, FK mit Cascade):

```sql
create table pantry_removals (
    id               uuid primary key default gen_random_uuid(),
    receipt_item_id  uuid not null references receipt_items(id) on delete cascade,
    reason           text not null check (reason in ('eaten', 'removed')),  -- 'gegessen' | 'x'
    quantity         numeric,      -- optional: Teilentnahme; NULL = ganze Position
    removed_at       timestamptz not null default now()
);
create index pantry_removals_item_idx on pantry_removals (receipt_item_id);
```

Designentscheidungen:
- **Bindung an `receipt_item_id`** (nicht an einen Produktnamen): Die Zeile trägt
  Nährwerte + Menge + Einheit + Herkunft schon exakt → Vorrats- und Nährwert-Rechnung
  bleiben präzise. `ON DELETE CASCADE` hält es sauber.
- **Profil-Bezug transitiv** über `receipt_items → receipts.profile_id` — keine
  redundante `profile_id`-Spalte nötig.
- **`quantity` optional:** MVP nutzt es nicht (ganze Position raus, NULL). Feld ist
  schon da, falls später Teilverbrauch gewünscht ist — ohne Migration.

---

## 4. Read-Logik — Vorrat berechnen

Vorrat = bestätigte Food-Items **ohne** zugehörige Entnahme. Als View `v_pantry`
oder in der Service-Schicht:

```sql
select ri.*
from receipt_items ri
join receipts r on r.id = ri.receipt_id
where r.status = 'confirmed'
  and r.profile_id = :profile_id
  and ri.is_non_food = false
  and not exists (select 1 from pantry_removals pr where pr.receipt_item_id = ri.id);
```

---

## 5. Anzeige: pro Lot (MVP) vs. pro Produkt (Ausbau)

**„Lot" = eine einzelne Kauf-Position auf einem einzelnen Bon = eine `receipt_items`-Zeile.**
Dasselbe Produkt auf zwei Bons sind zwei Lots.

### Speicherung: immer pro Lot, nie summiert

Jedes Lot behält eigene Nährwerte, Menge, Einheit, Kaufdatum, Preis, Match-Herkunft.
Summieren beim Speichern würde Herkunft *und* die eindeutige Entnahme-Zuordnung
zerstören.

### Anzeige-Stufe 1 — MVP: pro Lot (gewählt für Start)

Die Basket-Page zeigt jede Kauf-Position als eigene, einzeln abhakbare Zeile:

```
Dein Vorrat
─────────────────────────────
Gurke        1 Stück · 05.01. · Lidl     [gegessen] [x]
Salatgurke   3 Stück · 12.01. · Edeka    [gegessen] [x]
Tomaten      500 g   · 12.01. · Edeka    [gegessen] [x]
```

Entnahme = `pantry_removals`-Zeile auf genau dieses Lot. Vorteile:
- **kein Gruppierungs-Schlüssel** nötig („Gurke" vs. „Salatgurke"?),
- **keine Einheiten-Umrechnung** (nie „1 Stück + 500 g"),
- **keine FIFO-Regel** — der Nutzer klickt das konkrete Lot an.

Nachteil: Bei häufigen Wiederkäufen wird die Liste lang/repetitiv. Reine
Anzeige-Kosmetik.

### Anzeige-Stufe 2 — Ausbau: pro Produkt aggregiert

„Gurke: 4 Stück" statt vier Zeilen. Rein **Read-/Anzeige-Logik, keine Schemaänderung**.
Erfordert drei Regeln:
1. **Gruppierungs-Schlüssel:** Match-Identität (`bls_code`/`off_id`), Fallback
   normalisierter Name.
2. **Einheiten:** nur Kompatibles summieren; sonst über
   [`units`/`grams_for`](backend/app/services/units.py) auf Gramm normalisieren.
3. **Entnahme auf Gruppe:** **FIFO** (ältester Kauf zuerst) → der Ledger bleibt pro
   Lot präzise, die Anzeige aggregiert.

Weil das Datenmodell in beiden Stufen identisch ist, ist „pro Lot" der risikofreie
Startpunkt — kein späterer Migrationsbedarf.

---

## 6. Mengen-Erfassung & Teil-Entnahme (Regler im Basket)

### 6.1 Ist-Zustand: eine kollabierte Zahl

`receipt_items` erfasst heute nur
[`quantity` + `unit`](supabase/migrations/0001_init_schema.sql#L47-L48) — **eine
einzelne Menge**, keine getrennte „Anzahl" und „Größe". Der Parser erkennt zwar
*beide* Signale (einen Multiplikator `x2` **und** eine eingebettete Einheitsgröße
`500g`), speichert aber bewusst nur **eines** davon — `if mult: … else: qty_m`
([receipt_text_parser.py:246-257](backend/app/services/receipt_text_parser.py#L246-L257)):

- `Butter 500g x2` → wird zu `quantity=2, unit=piece` **oder** `quantity=500, unit=g`,
  nie „2 × 500 g".
- Fehlt jede Menge: `quantity=1, unit=piece, uncertain=True` (→ Review-Flag).
- Stück → Gramm läuft über eine grobe Default-Tabelle (100 g/Stück,
  [`piece_weight_grams`](backend/app/services/units.py#L76-L87)) — von
  [Konsum.md](Konsum.md#L132-L134) als bekannte Ungenauigkeit gelistet.

### 6.2 Zwei Dimensionen, die getrennt gehören

| Dimension | Bedeutung | Butter | Milch |
|---|---|:---:|:---:|
| **Anzahl** (count) | wie oft dieselbe Einheit gekauft wurde | 2 | 3 |
| **Einheitsgröße** (unit_size + unit) | Inhalt je Einheit | 500 g | 1 L |
| = **Gesamtmenge** | Anzahl × Einheitsgröße | 1000 g | 3 L |

### 6.3 Plan: Anzahl × Einheitsgröße getrennt erfassen

Eigener, abgegrenzter Schritt (**Parser + Schema + Review-UI**), unabhängig vom
Vorrat-Ledger. Neue Spalten auf `receipt_items`:

```
count      numeric   -- Anzahl gekaufter Einheiten (2, 3)
unit_size  numeric   -- Inhalt je Einheit (500, 1)
unit       text      -- Einheit dazu (g, l, ml, piece) — existiert bereits
```

Der Parser erfasst dann **beide** Signale, statt eines wegzuwerfen. Gesamtmenge =
`count × unit_size`.

**Kein reines Umbenennen von `quantity`.** Das heutige `quantity` bedeutet je nach
Einheit *Verschiedenes* ([receipt_text_parser.py:246-257](backend/app/services/receipt_text_parser.py#L246-L257)):
im `x2`-Zweig ist es eine **Anzahl** (`unit=piece`), im `500g`-Zweig eine **Größe/Masse**
(`unit=g`, Anzahl implizit 1). Die Migration ist daher eine **Interpretation** der
Altzeilen, keine Umbenennung:

- `unit=piece` → `count = quantity`, `unit_size` leer/1
- Masse/Volumen (`g/kg/ml/l`) → `unit_size = quantity`, `count = 1`

**Andockpunkt-Warnung:** Diese Semantik-Änderung berührt
[`grams_for`](backend/app/services/nutrition_profile.py#L27-L39) und die
`factor = grams/100 * weight`-Rechnung, an der auch [Konsum.md](Konsum.md#L108-L122)
hängt — beide müssen mitgezogen werden, sonst driften die Docs/Berechnungen auseinander.

### 6.4 Regler zum Reduzieren — gestaffelt

| Stufe | Regler im Basket | Voraussetzung |
|---|---|---|
| **MVP** | binär: „ganze Position gegessen/entfernt" | nichts — funktioniert sofort |
| **Teil-Entnahme** | Feld/Regler in der Lot-Einheit (g/ml/Stück) → schreibt `pantry_removals.quantity` | zuverlässige Basis-`quantity` |
| **Einheitenweise** | „1 von 2 Einheiten weg" → `count` um 1 runter | getrennte `count`/`unit_size` (§6.3) |

Ohne die getrennte **Anzahl** lässt sich „1 von 2 Paketen" gar nicht anbieten — genau
der Fall aus den Beispielen (2× Butter, 3× Milch). Der Regler ist zudem nur so gut wie
die Basis-Menge: bei `quantity=1, unit=piece, uncertain=True` ist er faktisch wieder
binär. Das Datenmodell (`pantry_removals.quantity`, §3) trägt die Teil-Entnahme bereits;
die einheitenweise Reduktion setzt §6.3 voraus.

---

## 7. „gegessen" vs. „entfernt" — Anbindung an die Konsum-Logik

Der `reason` trennt zwei Bedeutungen, die [Konsum.md](Konsum.md#L28-L34) explizit
unterscheidet:
- `eaten` → zählt als **Konsum**
- `removed` → zählt als **Verderb/Verschwendung**, nicht als Konsum

Damit liefert die Vorrats-Funktion das **Verderb-Signal gratis mit**, das
[Konsum.md Stufe 3](Konsum.md#L64-L67) sonst über statische Koeffizienten schätzen
müsste. Ein einzelner „weg"-Button würde diese Information verschenken — daher zwei
`reason`-Werte von Anfang an.

---

## 8. Umsetzungsschritte (wenn gebaut wird)

1. **Migration** `supabase/migrations/0008_pantry.sql`: Tabelle `pantry_removals` +
   View `v_pantry` (§3, §4).
2. **Repo** ([backend/app/db/repo.py](backend/app/db/repo.py)):
   - `add_pantry_removal(receipt_item_id, reason, quantity=None)`
   - `remove_pantry_removal(...)` (Rückgängig-Machen)
   - `get_pantry(profile_id)` — Read-Query aus §4
3. **API** (neuer Router `backend/app/api/pantry.py`, Muster wie
   [profile.py](backend/app/api/profile.py) / X-Profile-Id via
   [`require_profile_id`](backend/app/core/auth.py)):
   - `GET  /pantry` — aktueller Vorrat
   - `POST /pantry/removals` — Item als gegessen/entfernt markieren
   - `DELETE /pantry/removals/{id}` — Entnahme rückgängig
4. **Frontend** — neue Page `Basket` (Route + NavBar-Eintrag), pro-Lot-Anzeige (§5),
   `api.ts`-Aufrufe. (Hinweis: `frontend/src/lib/` ist derzeit durch die zu breite
   `.gitignore`-Regel `lib/` nicht eingecheckt — vor Frontend-Arbeit lösen.)
5. **Tests:** Vorrat = Käufe − Entnahmen; Ownership (fremdes Profil kann nicht
   entnehmen); Non-Food/unbestätigte Bons erscheinen nie im Vorrat.

---

## 9. Offene Punkte / später

- **Anzahl × Einheitsgröße getrennt erfassen (§6.3):** Voraussetzung für den
  einheitenweisen Regler; eigener Schritt (Parser + Schema + Review-UI).
- **Teilverbrauch:** `pantry_removals.quantity` ist vorbereitet, MVP ist binär (ganze
  Position).
- **Aggregierte Anzeige (Stufe 2):** Gruppierungs-Schlüssel + FIFO, wenn die pro-Lot-
  Liste zu lang wird.
- **Konsum-Kopplung:** `reason='eaten'` als Eingang in
  [`compute_basket_composition`](backend/app/services/basket_composition.py) — erst
  angehen, wenn die Konsum-Stufen (Konsum.md) umgesetzt werden; sauber getrennt halten.
- **Abhängigkeit:** Frontend-Teil setzt die behobene `lib/`-`.gitignore`-Sache voraus.
