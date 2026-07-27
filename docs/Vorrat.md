# Vorratsübersicht (Basket) — Konzept & Plan

Wie aus allen hochgeladenen Kassenbons ein **aktueller Vorrat** pro User entsteht,
den eine neue Frontend-Page **„Basket"** anzeigt — und warum das Datenmodell ein
**Entnahme-Ledger** ist und keine Statusspalte auf `receipt_items`.

> Status: **umgesetzt (MVP + Teil-Entnahme)** auf Branch `basket` (Stand 2026-07-23).
> Migrationen `0008_pantry.sql` + `0009_pantry_partial.sql`, Router
> [`pantry.py`](backend/app/api/pantry.py), Page
> [`BasketPage.tsx`](frontend/src/pages/BasketPage.tsx). Diese Datei bleibt die
> Entscheidungsgrundlage; **konkrete Abweichungen** vom ursprünglichen Plan sind unten
> je Abschnitt markiert. Zurückgestellt: Aggregation pro Produkt (§5 Stufe 2) und die
> volle `count`/`unit_size`-Trennung (§6.3).

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

> **Umgesetzt (abweichend):** Der Vorrat ist eine **View `v_pantry`** (kein `not exists`
> mehr, seit Teil-Entnahme). Sie berechnet `remaining_quantity = coalesce(quantity,1) −
> Σ coalesce(pr.quantity, …)` und filtert `remaining_quantity > 0`; `profile_id`, `store`
> und `purchased_at` werden als Spalten aus dem Bon hochgezogen, damit das Repo per
> `.eq("profile_id", …)` filtern kann (der Supabase-Client setzt keine parametrisierte
> SQL ab). Siehe [`0009_pantry_partial.sql`](supabase/migrations/0009_pantry_partial.sql).

---

## 5. Anzeige: pro Lot (MVP) vs. pro Produkt (Ausbau)

**„Lot" = eine einzelne Kauf-Position auf einem einzelnen Bon = eine `receipt_items`-Zeile.**
Dasselbe Produkt auf zwei Bons sind zwei Lots.

### Speicherung: immer pro Lot, nie summiert

Jedes Lot behält eigene Nährwerte, Menge, Einheit, Kaufdatum, Preis, Match-Herkunft.
Summieren beim Speichern würde Herkunft *und* die eindeutige Entnahme-Zuordnung
zerstören.

### Anzeige-Stufe 1 — MVP: pro Lot ✅ gebaut

Die Basket-Page zeigt jede Kauf-Position als eigene, einzeln abhakbare Zeile:

```
Dein Vorrat
─────────────────────────────
Gurke        1 Stück · 3 Tage     🍴  🗑️
Salatgurke   3 Stück · 10 Tage    🍴  🗑️
Tomaten      500 g   · 10 Tage    🍴  🗑️
```

> **Umgesetzt (abweichend vom obigen Skizzen-Layout):** Anzeigename ist der **verifizierte
> Match** (nicht der Bon-Rohtext), Nährwerte stehen als **Subtitel** unter dem Namen,
> statt Kaufdatum die **Tage im Basket**, kein Store (steht auf der — inzwischen
> ausgeblendeten — Purchases-Seite). Aktionen sind **Icon-Buttons** 🍴 (gegessen) /
> 🗑️ (entfernt), je mit Mengen-Regler (Teil-Entnahme, §6.4). Name-✎ öffnet die
> Fix-Match-Suche, Mengen-✎ ein Zahlenfeld.

Entnahme = `pantry_removals`-Zeile auf genau dieses Lot. Vorteile:
- **kein Gruppierungs-Schlüssel** nötig („Gurke" vs. „Salatgurke"?),
- **keine Einheiten-Umrechnung** (nie „1 Stück + 500 g"),
- **keine FIFO-Regel** — der Nutzer klickt das konkrete Lot an.

Nachteil: Bei häufigen Wiederkäufen wird die Liste lang/repetitiv. Reine
Anzeige-Kosmetik.

### Anzeige-Stufe 2 — Ausbau: pro Produkt aggregiert ⏸️ zurückgestellt (späterer Sprint)

„Gurke: 4 Stück" statt vier Zeilen. **Präzisierung aus der Umsetzungs-Diskussion:** nicht
„rein Read-Logik" — Regel 3 (FIFO-Entnahme) ist **Schreib**-Logik (eine Gruppen-Entnahme
verteilt sich auf mehrere Lots → mehrere `pantry_removals`-Zeilen + Mehrfach-Undo), und sie
kollidiert mit dem pro-Lot-Inline-Edit. Empfohlene Gruppierung dann nach **Identität +
Einheit** (statt Gramm-Normalisierung), um gemischte Einheiten zu vermeiden. Keine
Schemaänderung. Erfordert drei Regeln:
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

### 6.3 Plan: Anzahl × Einheitsgröße getrennt erfassen ⏸️ zurückgestellt

> **Stattdessen umgesetzt (Parser-Multiply, commit c547be6):** Für Multipacks mit
> *gemessener* Größe rechnet der Parser jetzt „N × Größe" zu **einer Gesamtmenge**
> zusammen (Joghurt 4×150 g → 600 g, Milch 3×1 l → 3 l) — kein Schema-Umbau, deckt die
> häufigen Fälle. Die **volle getrennte Erfassung** unten bleibt zurückgestellt; sie wird
> erst nötig, wenn aggregierte Multipacks **becherweise** abgehakt werden sollen (dann
> braucht der Regler die „150 g je Becher"-Info). Rein-Stück-Multipacks ohne Maß bleiben
> Anzahl.

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

| Stufe | Regler im Basket | Status |
|---|---|---|
| **MVP** | binär: „ganze Position gegessen/entfernt" | ✅ gebaut |
| **Teil-Entnahme** | Regler in der Lot-Einheit → schreibt `pantry_removals.quantity` | ✅ gebaut |
| **Einheitenweise** | „1 von 2 Einheiten weg" → `count` um 1 runter | ⏸️ braucht §6.3 |

> **Umgesetzt:** Klick auf 🍴/🗑️ öffnet ein Panel, **vorbelegt mit dem vollen Rest**
> (ein Bestätigen = ganze Position, das alte binäre Tempo). Für Teilmengen: **Zahlenfeld**
> bei Masse/Volumen (g/ml/kg/l, z. B. 0,2 l von 3 l), **Viertel-Schieberegler** bei Stück
> (¼ ½ ¾ + ganze). Server **clampt** eine Über-Entnahme auf den Rest (kein 409, außer der
> Rest ist 0) und meldet `applied`/`remaining_after`/`clamped`; Makros skalieren auf den
> Rest. Undo = Ledger-Zeile löschen.

Ohne die getrennte **Anzahl** lässt sich „1 von 2 Paketen" (à 500 g) nicht als
**einheitenweiser** Schritt mit korrekten Rest-Makros anbieten — dafür §6.3. Der Regler ist
zudem nur so gut wie die Basis-Menge: bei `quantity=1, unit=piece, uncertain=True` ist er
faktisch binär.

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

## 8. Umsetzungsschritte — ✅ gebaut

1. ✅ **Migration** [`0008_pantry.sql`](supabase/migrations/0008_pantry.sql) (Tabelle +
   View) und [`0009_pantry_partial.sql`](supabase/migrations/0009_pantry_partial.sql)
   (`remaining_quantity` für Teil-Entnahme). *Beide im Dev-Supabase angewendet; in anderen
   Umgebungen einmalig, in Reihenfolge ausführen.*
2. ✅ **Repo** ([repo.py](backend/app/db/repo.py)): `add_pantry_removal`,
   `remove_pantry_removal`, `get_pantry`, plus `get_lot_remaining` (Clamp) und
   `get_receipt_item_owner` (Ownership).
3. ✅ **API** ([pantry.py](backend/app/api/pantry.py)): `GET /pantry`,
   `POST /pantry/removals` (mit `quantity` + Clamp), `DELETE /pantry/removals/{id}`.
4. ✅ **Frontend** — Page [`BasketPage.tsx`](frontend/src/pages/BasketPage.tsx) (Route +
   NavBar), pro-Lot, `api.ts`-Aufrufe. Der `lib/`-`.gitignore`-Blocker war vorab behoben
   (commit e524c8d).
5. ✅ **Tests:** in [`test_api_smoke.py`](backend/tests/test_api_smoke.py) (Vorrat =
   Käufe − Entnahmen, remaining-Skalierung, Clamp, Ownership-404) und
   [`test_receipt_text_parser.py`](backend/tests/test_receipt_text_parser.py)
   (Multipack-Multiply).

---

## 9. Offene Punkte / später

- ✅ **Teilverbrauch:** gebaut (§6.4) — `pantry_removals.quantity` + `remaining_quantity`.
- ⏸️ **Aggregierte Anzeige (Stufe 2):** Gruppierung (Identität + Einheit) + FIFO — in einen
  späteren Sprint verschoben (§5).
- ⏸️ **Anzahl × Einheitsgröße getrennt erfassen (§6.3):** nur für den *einheitenweisen*
  Regler auf aggregierten Multipacks nötig; für den MVP durch die Parser-Multiplikation
  umgangen.
- ⏳ **Konsum-Kopplung:** `reason='eaten'`/`'removed'` als Eingang in
  [`compute_basket_composition`](backend/app/services/basket_composition.py) — erst mit
  Phase 4 (Gap, [GapUndEmpfehlung.md](GapUndEmpfehlung.md)); sauber getrennt halten. Beide
  `reason`-Werte werden bereits getrennt gespeichert.
- ⚠️ **Deploy:** Migrationen 0008 + 0009 + **0010** (`pantry_shelf_life`) müssen in
  Nicht-Dev-Umgebungen angewendet werden.
- ⏳ **IA-Feinschliff:** Purchases ist ausgeblendet; Bottom-Nav / Basket-als-Landing stehen aus.

---

## 10. Bestandsliste: Dringlichkeit (Schätzung vs. Tatsache)

> Status: **umgesetzt** auf Branch `basket`. Migration
> [`0010_pantry_shelf_life.sql`](supabase/migrations/0010_pantry_shelf_life.sql), Service
> [`shelf_life.py`](backend/app/services/shelf_life.py).
>
> **Config-Ebene:** je grober **Food-Group** (13 Gruppen), nicht je Einzel-Artikel
> (Entscheidung #1) und nicht je Blatt-Kategorie. Ein Override gilt also z. B. für „Meat"
> gesamt, nicht nur für Hackfleisch. Editierbar pro Profil über `GET`/`PUT
> /pantry/shelf-life`.
>
> **Bewusst nicht ausgespielt:** Das Edit-Panel
> [`ShelfLifePanel.tsx`](frontend/src/components/ShelfLifePanel.tsx) ist gebaut, aber im
> Frontend **nicht sichtbar** — Endnutzer sehen nur Ampel + Sortierung, nie eine Zahl. Die
> Config bleibt serverseitig editierbar; das Panel kann fürs spätere **MHD-Feature** (echtes
> Best-before-Datum als *Feld am Artikel*, das dann die Kategorie-Schätzung schlägt) wieder
> eingeblendet werden.

Artikel haben **kein** Haltbarkeitsdatum — nur ein echtes **Kaufdatum** und eine
**Kategorie**. Die Dringlichkeit wird daraus **geschätzt** und ist deshalb strikt von den
echten Werten getrennt:

| Wert | Art | Sichtbar im UI? |
|------|-----|-----------------|
| Kaufdatum / Alter im Basket | **Tatsache** (Nutzer-/Boneingabe) | **Ja** |
| Menge, Einheit, Kategorie | **Tatsache** | Ja |
| Haltbarkeitstage je Kategorie | **Config-Schätzung** (Default + pro-Nutzer-Override) | Ja — aber nur im Config-Panel als Eingabewert |
| Geschätztes Ablaufdatum = Kaufdatum + Haltbarkeitstage | **Schätzung** | **Nein — nie** |
| Ampelfarbe / weiches Label (`urgency`) | abgeleitete **Unschärfe** | Ja |

**Warum das geschätzte Datum nie als Datum/Zahl erscheint:** Es ist eine Kategorie-Faustregel,
keine Messung — eine konkrete Zahl („noch 2 Tage", „läuft am 26.07. ab") würde eine Genauigkeit
vortäuschen, die die Datenlage nicht hergibt. Deshalb bleibt das Schätzdatum **serverseitig**
(nur Sortier-Schlüssel in `sort_key` und Eingang für `urgency_for`) und **verlässt die API nie**;
nach außen geht ausschließlich der unscharfe Bucket `expired|soon|week|long|unknown`, der Ampel +
Label treibt. Der „nächste 3 Tage"-Filter nutzt `expired|soon` — also ebenfalls **ohne** dass eine
Tageszahl übertragen wird. „Other / Miscellaneous" hat **keinen** Schätzwert (`null`) und sortiert
ans Listenende, statt eine falsche Dringlichkeit zu erzeugen.
