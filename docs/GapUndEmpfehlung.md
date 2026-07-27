# Gap-Analyse & Ernährungs-/Rezept-Empfehlung — Konzept & Plan

Zwei geplante Features und ihre Hindernisse:

1. **Gap-Analyse** zwischen IST-Lebensmitteln und Soll-Profil (kcal/Makros).
2. **Empfehlung** von Ernährung & Kochrezepten fürs Soll-Profil, die **Vorräte
   berücksichtigt** und den Einkauf optimiert („hast du Eier im Lager, sonst kaufen;
   was ist da — z. B. Buttermilch — und was dazukaufen").

> Status: **geplant, noch nicht gebaut.** Entscheidungs- und Umsetzungsgrundlage.
> Verwandt: [Konsum.md](Konsum.md) (Einkauf ≠ Konsum), [Vorrat.md](Vorrat.md) (Lager).

---

## 1. Bestandsaufnahme — was schon existiert

Feature 1 ist zu großen Teilen vorhanden; Feature 2 nur rudimentär.

| Baustein | Was er kann | Ort |
|---|---|---|
| `/target-comparison` | Ist- vs. Soll-**Makro-%**, Delta, Closeness-Score (0-100) | [analysis.py:105-134](backend/app/api/analysis.py#L105-L134) |
| `/composition` | kalorien-gewichteter Makro-Split aller Käufe | [basket_composition.py](backend/app/services/basket_composition.py) |
| `/buckets` | „mehr/weniger essen" **pro Item** aus Gap + Nährwertqualität | [analysis.py:137-147](backend/app/api/analysis.py#L137-L147), [bucketing.py](backend/app/services/bucketing.py) |
| `/diversity` | Quellen-Vielfalt je Makro + Klartext-Hinweise | [diversity.py](backend/app/services/diversity.py) |
| Rezept-Generierung | Gemini-Rezept aus Makro-Gap + Diät/Allergien | [recipe_engine.py](backend/app/services/recipe_engine.py) |
| Soll-Profil | Ziel-kcal/Makros/g pro Tag | [ideal_profile.py](backend/app/services/ideal_profile.py) |

**Fehlt** (= die neuen Wünsche): absolute Tagesmengen, Vorrats-Bewusstsein im Rezept,
„was dazukaufen" (Basket-Optimierung).

---

## 2. Feature 1 — Gap-Analyse: Hindernisse

### 2.1 „IST-Lebensmittel" ist dreideutig — zuerst klären

„Gap zwischen IST und Soll" kann **drei verschiedene Dinge** meinen, mit völlig
verschiedenen Ergebnissen:

| IST-Begriff | Bedeutung | Für welche Frage? | Quelle |
|---|---|---|---|
| **Gekauft** | Summe aller Bons | (heute genutzt, aber für beides falsch) | [`get_all_confirmed_receipt_items`](backend/app/db/repo.py#L108-L125) |
| **Konsumiert** | was tatsächlich gegessen wird | „Bin ich auf Kurs (Muskelaufbau)?" | [Konsum.md](Konsum.md) (Basis) + Vorrat-`removed` (Korrektur); `eaten` nur Opt-in — siehe §4 |
| **Bestand** | was gerade im Lager liegt | „Habe ich heute genug Protein da?" | [Vorrat.md](Vorrat.md) |

Der aktuelle Code nutzt **Gekauft** — für beide Zielfragen die falsche Größe.
**Empfehlung:** pro Feature explizit festlegen, welches IST gemeint ist, und die
Gap-Views trennen. Das ist eine reine Konzeptentscheidung und blockiert den Rest.

### 2.2 Der Code vergleicht *Verteilung*, nicht *Menge*

`/target-comparison` vergleicht **Prozent-Shapes** (Protein-% der Kalorien). Das Ziel
(„hohe Proteinzunahme für Muskeln") ist aber **absolut**: Gramm Protein/Tag gegen das
Soll aus [`compute_ideal_profile`](backend/app/services/ideal_profile.py). Man kann die
%-Verteilung perfekt treffen und trotzdem die Hälfte oder das Doppelte essen — der
`closeness_score` merkt das nicht (er ist skaleninvariant).

**Empfehlung:** eine **absolute Ebene** ergänzen — Käufe → Gramm/Tag über ein
Zeitfenster ([Konsum.md Stufe 1+2](Konsum.md#L52-L62)), verglichen mit Soll-Gramm/Tag.
Braucht zusätzlich die **Haushaltsgröße** (Portion pro Person,
[Konsum.md Stufe 4](Konsum.md#L69-L72)) — sonst sind absolute Werte systematisch zu hoch.

### 2.3 Datenqualitäts-Kaskade — der eigentliche Genauigkeits-Killer

Jede Gap-Zahl ist nur so gut wie die schwächste Vorstufe, und die Fehler
**multiplizieren** sich:

- **Mengen kollabiert** (Anzahl × Größe nicht getrennt, [Vorrat.md §6](Vorrat.md)) → falsche Gramm
- **`grams_for`**: Volumen als 1 g/ml, Stück-Default 100 g ([nutrition_profile.py:19-39](backend/app/services/nutrition_profile.py#L19-L39))
- **`or 0.0`**: unbekannter Makrowert wird als *null* gezählt ([basket_composition.py:65-67](backend/app/services/basket_composition.py#L65-L67)) → verzerrt die Verteilung
- **Fallback-Tier** liefert nur Protein/Fiber/Sugar/kcal, kein Fett/Carbs → `unaccounted_pct`
- **Match-Konfidenz** (OFF/BLS/Fallback) → falsche Nährwerte je 100 g

**Empfehlung:** Genauigkeit **nicht vortäuschen**. Ein **Coverage-/Konfidenz-Label** an
jede Gap-Aussage hängen (Anteil der kcal aus sicheren Matches). Bei niedriger Coverage
dominieren Annahmen — ehrlich labeln, wie [Konsum.md §6](Konsum.md#L126-L134) fordert.

---

## 3. Feature 2 — Rezept-/Ernährungsempfehlung mit Vorrats-Bezug

### 3.1 Die Rezept-Engine ist heute vorrats-*blind*

Der Prompt kennt nur den Makro-Gap + Diät/Allergien
([recipe_engine.py:65-130](backend/app/services/recipe_engine.py#L65-L130)) —
**nichts** über den Bestand. Der Kernwunsch („hast du Eier im Lager?") ist ein
**komplett neues** Feature und hängt an:
- dem **Vorrat-Feature** ([Vorrat.md](Vorrat.md), noch nicht gebaut), und
- idealerweise der **getrennten Mengenerfassung** ([Vorrat.md §6.3](Vorrat.md)), sonst
  ist unbekannt, *wie viel* vorhanden ist.

→ **Build-Reihenfolge zwingend:** Vorrat zuerst, dann vorrats-bewusste Rezepte.

### 3.2 Zutat ↔ Vorrat ist dasselbe Matching-Problem wie beim Bon

„Buttermilch" im Lager vs. „buttermilk" im Gemini-Rezept — erneut ein Identitäts-
Abgleich. **Empfehlung:** **keinen** zweiten Matcher bauen, sondern die vorhandene
Match-Identität (`bls_code`/`off_id` + [`verified_matches`](backend/app/services/verified_matches.py))
wiederverwenden. Am robustesten: Zutaten aus einer **kontrollierten Liste** (den
Vorrats-Items) wählen, statt Gemini frei erfinden zu lassen und danach zurückzumatchen.

### 3.3 Gemini-Nährwerte sind *geschätzt*, nicht verifiziert

Die Nährwerte im Rezept sind Geminis eigene Schätzung
([recipe_engine.py:9-11](backend/app/services/recipe_engine.py#L9-L11)). Damit lässt
sich **nicht garantieren**, dass ein Rezept den Gap wirklich schließt.

**Empfehlung — sauberer Schnitt (deterministisch vs. LLM):**
- **Deterministisch:** *welche* Zutaten den Gap schließen (aus den echten Nährwertdaten
  — im Kern schon [`/buckets`](backend/app/services/bucketing.py)) und was im Lager liegt.
- **LLM nur für die Prosa:** aus den *vorgegebenen* Zutaten ein kochbares Rezept bauen.

Hält die Zahlen prüfbar und nutzt Gemini nur, wofür es taugt.

### 3.4 „Basket optimieren" ist Optimierung — Gefahr Overbuild

„Was habe ich (Buttermilch) + was dazukaufen, um das Ziel zu erreichen" ist eine
**beschränkte Optimierung** (Zielmakros treffen, Vorrat bevorzugen, Zukäufe minimieren)
— nahe an einem Diät-/Rucksackproblem. Fallstricke: unrealistische Vorschläge, Kauf in
**realen Gebinden** (10er-Eierpackung, nicht „3 Eier"), Overbuild.

**Empfehlung:** **kein** vollständiger Solver zu Beginn. **Greedy, gedeckelt:** Vorrat
zuerst einrechnen, dann die 1–3 wirkungsvollsten Zukäufe für den größten Makro-Gap
vorschlagen, mit hartem Limit und ehrlichem „deckt ~X % des Ziels".

---

## 4. Begriffe & Effekt-Modell: Einkauf / gegessen / entfernt

Die drei Aktionen scharf definiert — und wie jede auf die drei Sichten wirkt.

- **Einkauf** — das unveränderliche Kauf-Faktum (`receipt_items`). **Basis der Gap:**
  über Zeitfenster/EWMA in eine Konsumrate umgerechnet ([Konsum.md](Konsum.md)), *nicht*
  die rohe Lebenszeit-Summe. Wird nie mutiert (Audit-Historie).
- **gegessen** (`reason='eaten'`) — „hat das Lager verlassen, weil konsumiert."
- **entfernt** (`reason='removed'`) — „hat das Lager verlassen, OHNE konsumiert zu
  werden" (verdorben, weggeworfen, verschenkt, Fehlscan).

### Warum die Asymmetrie korrekt ist

Die Gap nimmt per **Massenerhaltung** ([Konsum.md §45-48](Konsum.md#L45-L48)) an, dass
**alles Gekaufte irgendwann gegessen wird**. Daher:

- **`gegessen` bestätigt nur die Default-Annahme** → steckt bereits in der Gap → **kein**
  neuer Informationsgehalt → Gap unverändert (der *erwartete* Pfad).
- **`entfernt` widerlegt die Default-Annahme** → war doch kein Konsum → **muss aus der
  Gap raus** (der *Ausnahme*-Pfad, der eine Annahme durch Daten ersetzt).

Kurz: **Ausnahmen (`entfernt`) tragen Information, Bestätigungen (`gegessen`) nicht.**

### Effekt jeder Aktion

| Aktion | Lager/Bestand | Konsum-Gap | Einkauf-Historie |
|---|:---:|:---:|:---:|
| Kauf/Upload | **+** Item | **+** Item (als konsumiert *angenommen*) | **+** Item (Faktum) |
| **gegessen** | **−** Item | **unverändert** | unverändert |
| **entfernt** | **−** Item | **−** Item | unverändert |

`gegessen` und `entfernt` reduzieren **beide** das Lager — nur bei der Gap unterscheiden
sie sich. Die Einkaufs-Historie ändert sich nie.

### Empfohlene Behandlung

(Präzisierung — eine frühere Fassung framte `eaten` pauschal als „das bessere
Konsum-Signal"; das ist so nicht haltbar.)

- **Basis = Einkauf.** Immer an, null Aufwand → trägt die Gap dauerhaft.
- **Korrektur = `entfernt`.** Ersetzt Konsum.mds statische Verderb-Koeffizienten
  ([Stufe 3](Konsum.md#L64-L67)) durch echte Daten — wenig Aufwand (nur Ausnahmen),
  hoher Hebel.
- **`gegessen` = Opt-in-Präzision.** Nur im expliziten „ich logge alles"-Modus wird es
  zum *positiven* Gap-Signal und ersetzt die Rückrechnung fürs geloggte Fenster. **Nie
  Pflicht-Basis** — laufender Aufwand mit gerichtetem Unterschätzungs-Fehler bei
  lückenhaftem Loggen, genau das, was [Konsum.md §102-105](Konsum.md#L102-L105) vermeiden
  will.
- **Nie additiv mischen:** Basis ist der Einkauf; Vorrat-Events *korrigieren* ihn —
  sonst Doppelzählung.

### Feinheit: Zeitfenster

Liegt ein Item außerhalb des aktuellen Gap-Fensters, ist es ohnehin schon aus der Gap
gefallen — ein späteres `entfernt` wirkt dann nur noch aufs Lager, nicht mehr auf die
(aktuelle) Gap.

---

## 5. Empfohlene Reihenfolge & Abhängigkeiten

1. **IST-Begriff je Feature festlegen** (Gekauft / Konsum / Bestand, §2.1) — reine
   Konzeptentscheidung, blockiert alles andere.
2. **Datenfundament** (§2.3): mind. Coverage-/Konfidenz-Label; idealerweise `or 0.0`,
   `grams_for`, Mengenerfassung angehen. Ohne das führt jede Empfehlung in die Irre.
3. **Absolute Tagesebene** (Konsum Stufe 1+2 + Haushaltsgröße, §2.2) für „genug Protein?".
   Basis der Konsum-Gap = Einkauf (§4).
4. **Vorrat-Feature** bauen ([Vorrat.md](Vorrat.md)) — Voraussetzung für alles
   Vorrats-Bezogene; danach speist `entfernt` die Verderb-Korrektur der Gap (§4),
   `gegessen` bleibt Opt-in.
5. **Deterministische Zutatenauswahl** (Erweiterung von `/buckets` um Vorrats-Bewusstsein,
   §3.3), **dann** LLM-Rezept + gedeckelte Basket-Optimierung (§3.4).

---

## 6. Offene Punkte / später

- **Kontrollierte Zutatenliste** vs. freie Gemini-Zutaten (§3.2) — Entscheidung nötig.
- **Reale Gebinde** beim „dazukaufen" (§3.4) — braucht Packungs-/Mengeninfo aus
  [Vorrat.md §6.3](Vorrat.md).
- **Coverage-Schwelle**, ab der Empfehlungen als „unsicher" gelabelt werden.
- **Abhängigkeiten insgesamt:** Frontend-Teile setzen die behobene `lib/`-`.gitignore`-
  Sache voraus (siehe frühere Analyse); die zurückgestellte BLS-first-Umstellung ist
  davon unabhängig.
