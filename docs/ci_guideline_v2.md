# NutriWise – CI-Guideline (v3)

Corporate-Identity-Richtlinie für die Web-App. Alle Werte beschreiben den
„Grocery Shadow"-Look: ruhige, editoriale Neutraltöne (Canvas/Ink), **ein**
Marken-Akzent (Salbeigrün), eine klar getrennte **Funktions-/Signalebene**
(clay/amber/sage-ok), großzügige Rundungen.

**v3-Haltung – „Guideline folgt dem Code":** v3 gleicht das Dokument an den
**realen Frontend-Stand** an. Die diszipliniert gepflegte v2-Design-Substanz
bleibt (Elevation, Motion, Zustände, Barrierefreiheit, Voice & Tone). Zwei
Dinge ändern sich grundlegend: (1) Das Styling ist **kein Tailwind**, sondern
**CSS-Custom-Properties + semantische Klassen** – dieses Guideline benennt
daher Tokens/Klassen so, wie sie im Code existieren. (2) Marken-, Font- und
Dark-Mode-Aussagen sind auf die getroffenen Entscheidungen aktualisiert
(siehe Changelog).

> **Marke:** Das Produkt heißt **„NutriWise"** (Wortmarke, Titel, Login,
> Logo-Lockup). **„Nährbert"** ist der Name der **Coach-Persona** im Chat und
> in Voice & Tone (§14) – zwei bewusst getrennte, klar benannte Ebenen.

> **Sprache:** Dieses Guideline-Dokument ist die interne Arbeitsgrundlage und
> bleibt auf **Deutsch**. Die **Produkt-/UI-Sprache ist Englisch** – alle
> Beispiel-Texte, Button-Labels und Voice-&-Tone-Beispiele unten sind daher in
> der Produktsprache (Englisch) notiert.

> **Quelle der Wahrheit sind die CSS-Custom-Properties in
> `frontend/src/index.css`** (Farb-/Elevation-/Font-Tokens) und die
> semantischen Klassen in `frontend/src/App.css`. Werte **nie** als Hex hart in
> Komponenten kopieren – immer die Token benutzen (`var(--sage)`, `var(--text-h)`,
> `var(--border)`, `var(--warn-soft)` …). **Kein Tailwind** – es gibt keine
> Utility-Klassen; gestylt wird ausschließlich über die o. g. Tokens/Klassen.

> **Dark Mode:** in v3 **unterstützt** und live (`@media (prefers-color-scheme:
> dark)` in `index.css`, eigenes Token-Set). Die Dark-Signaltöne stammen
> vorläufig aus dem Mockup-Set; ein finaler **AA-Kontrast-Check** gegen die
> Dark-soft-Flächen steht noch aus (§17).

---

## 0. Token-Referenz & Namens-Mapping *(neu in v3)*

Der Code nutzt eigene Token-Namen. Wer ältere v2-Notizen oder das Mockup liest,
findet hier die Zuordnung. **Maßgeblich ist immer die rechte Spalte (Code).**

| Bedeutung | v2-/Mockup-Name | **Code-Token (maßgeblich)** | Wert (light) |
|---|---|---|---|
| Seitenhintergrund | `--canvas` | `--canvas` / `--bg` | `#fbfbfa` |
| Karten/Boxen | `--surface` | `--surface` | `#fff` |
| Primärtext, Überschriften | `--ink` | `--text-h` | `#201f24` |
| Sekundärtext | `--ink-soft` | `--text` | `#6b6b70` |
| Dunkler Vollton (Buttons/Nav aktiv) | `--ink` | **`--accent`** | `#1c1c1f` |
| Text auf dunklem Vollton | `--canvas` | `--accent-contrast` | `#fbfbfa` |
| Marken-Akzent (Salbeigrün) | `--accent` | **`--sage`** | `#7c9a6a` |
| Akzent-Fläche | `--accent-soft` | `--sage-soft` | `#eef2ea` |
| Text/Icon auf Akzent-Fläche | `--accent-ink` | `--sage-ink` | `#4f6b3c` |
| Feine Trennlinie/Rahmen | `ring-black/5` | `--border` | `rgba(0,0,0,.08)` |
| Ruhige Sekundärfläche | `bg-zinc-50` | `--code-bg` / `--accent-bg` | `#f4f4f5` |

> ⚠️ **Achtung, Namens-Falle:** `--accent` bedeutet im Code den **dunklen
> Ink-Vollton**, **nicht** Salbeigrün. Salbeigrün ist `--sage`. Diese Umkehr
> gegenüber v2 ist bewusst dokumentiert (`index.css`, Kopfkommentar) und wird
> **nicht** umbenannt (zu viele Fundstellen). Immer `--sage*` für die Marke.

---

## 1. Logo & Marke

**Wortmarke:** immer **„NutriWise"**, CamelCase, ein Wort (Markenname – **nicht**
übersetzen, auch in der englischen UI, und **nicht** klein/ohne Binnenversal
schreiben).

**Bildmarke:** ein stilisiertes Blatt (ein einzelner SVG-Pfad, geplant als
`components/Logo.tsx`). Es spiegelt den 🌱-Coach-Avatar aus dem Onboarding/Chat
– Produkt und „Coach Nährbert" lesen sich als **eine** Familie.

- Gezeichnet mit `stroke="currentColor"` → erbt automatisch die Textfarbe.
  Auf farbigem Grund einfach die Textfarbe setzen (`color: var(--sage)` bzw.
  `var(--accent-contrast)`), **kein** zweiter Hex-Wert.
- Keine Icon-Library, keine Füllung – nur Kontur (`stroke-width 1.8`,
  runde Enden).

**Lockup (Standard-Kopfzeile):** Blatt-Badge + Wortmarke nebeneinander.

```
[ 🍃 ]  NutriWise
 └ Badge: 34×34, border-radius:999px, background:var(--sage-soft),
    color:var(--sage-ink), Blatt-SVG ~16px
    Wortmarke: ~15px, font-weight:600, letter-spacing leicht negativ
```

> **Umsetzungsstand:** noch **offen** (Sprint). Aktuell zeigt die Nav ein
> Text-Badge „N" (`.nav-logo`) und der Login den Schriftzug „naehrbert" – beides
> wird auf Blatt-Lockup + „NutriWise" umgestellt (§17).

**Don'ts**
- Blatt nicht verzerren, drehen oder mit Farbverlauf füllen.
- Badge-Hintergrund nur `--sage-soft` (nicht Vollton-Salbeigrün).
- Keine Schlagschatten auf dem Logo.
- Markenname nie als „nutriwise", „Nutri Wise" oder „Nährbert" (≠ Produktname).

---

## 2. Farben (Tokens)

### 2.1 Marke & Neutraltöne

| Bedeutung | Token | Wert (light) | Wert (dark) | Verwendung |
|---|---|---|---|---|
| Seitenhintergrund | `--canvas` / `--bg` | `#fbfbfa` | `#17181f` | Seitenhintergrund |
| Karten / Boxen | `--surface` | `#fff` | `#1e202a` | Karten, Panels, Inputs |
| Primärtext | `--text-h` | `#201f24` | `#f2f2f0` | Überschriften, Werte, aktive Labels |
| Sekundärtext | `--text` | `#6b6b70` | `#9a9aa3` | Fließtext, Meta, Labels |
| Dunkler Vollton | `--accent` | `#1c1c1f` | `#f2f2f0` | Primär-Buttons, aktive Pills/Nav |
| Kontrast auf Vollton | `--accent-contrast` | `#fbfbfa` | `#1c1c1f` | Text/Icon auf `--accent` |
| Feine Trennung | `--border` | `rgba(0,0,0,.08)` | `rgba(255,255,255,.09)` | Rahmen, Hairlines |
| Ruhige Fläche | `--code-bg` | `#f4f4f5` | `#26262e` | eingebettete Boxen, Chips, Skeleton |
| **Marken-Akzent** | `--sage` | `#7c9a6a` | `#8fb079` | **einziger** Marken-Akzent (Salbeigrün) |
| Akzent-Fläche | `--sage-soft` | `#eef2ea` | `#232a20` | Badges, soft-Buttons, Avatar |
| Text auf Akzent-Fläche | `--sage-ink` | `#4f6b3c` | `#adc79a` | Text/Icon auf `--sage-soft` (AA-fest) |

### 2.2 Funktions- / Signalebene

Eigene Ebene für **Status**, bewusst getrennt vom Marken-Akzent. Salbeigrün
signalisiert „gut/frisch/ok" – daneben clay (Warnung) und amber (Achtung).

| Token | Wert (light) | Bedeutung |
|---|---|---|
| `--ok` (= `--sage-ink`) | `#4f6b3c` | ok · frisch · im Ziel |
| `--ok-soft` | `#eef2ea` | ok-Fläche/Badge |
| `--warn` | `#a8522e` | läuft ab · niedrig · unter Ziel |
| `--warn-soft` | `#f6e6de` | Warn-Fläche/Badge |
| `--warn-bright` | `#c2683f` | **nur non-textuell** (Balken/Punkte) |
| `--caution` | `#8a6a15` | Achtung · etwas hoch · über Ziel |
| `--caution-soft` | `#f6ecd6` | Achtung-Fläche/Badge |
| `--caution-bright` | `#cf9a34` | **nur non-textuell** (Balken/Punkte) |
| `--danger` | `#dc2626` | Fehler · destruktive Aktion · Notify-Punkt |
| `--danger-soft` | `#fbe8e8` | Fehler-Fläche |

> **Kontrast-Hinweis (Barrierefreiheit):** Die *Text*-Töne `--warn`/`--caution`
> sind gegenüber dem Mockup abgedunkelt, damit sie auf `--surface` **und** auf
> ihrer soft-Fläche WCAG AA erreichen. Die hellen Originaltöne stehen als
> `--warn-bright`/`--caution-bright` bereit – ausschließlich für
> **nicht-textuelle** Elemente (Balken, Punkte, Ring-Füllungen).

**Grundsätze**
- **Ein Marken-Akzent.** `--sage` ist der einzige Markenfarbton. Keine zweite
  „Marketing-Palette" – Landing, Onboarding & App teilen dieselbe Basis.
- **Signalfarben ≠ Deko.** clay/amber/danger dürfen **ausschließlich** Status
  transportieren (Frische, Ziel-Abweichung, Fehler), nie zur Zierde.
- **Nur Token, kein Roh-Hex.** Abstufungen über die vorhandenen Tokens bzw.
  `--border`/`--code-bg`. Keine ad-hoc-Hex in Komponenten (§16).
- **Eingebettete Flächen:** `--code-bg` (bzw. `--accent-bg`) statt neuer Grautöne.

> **Umsetzungsstand:** Mehrere Ansichten nutzen noch **rohe Status-Hex** statt
> der Signal-Token (z. B. `ResultsPage.tsx` 5-Stufen-Skala, Stat-Tiles,
> Ampel-Punkte, `#2f7d5b`-Fallbacks). Konsolidierung auf `--ok/--warn/--caution`
> bzw. deren `-bright`-Varianten ist Sprint-To-do (§17).

---

## 3. Elevation & Schatten

Fläche liegt flach; nur was *schwebt* oder *Aufmerksamkeit fordert*, bekommt
Höhe. Schatten ist ein **bewusstes Token**, kein Default.

| Stufe | Token | Wert (light) | Einsatz |
|---|---|---|---|
| **0 – flach** | `1px solid var(--border)` | (kein Schatten) | Standard: Karten, Zeilen, Inputs |
| **1 – angehoben** | `--shadow-raise` | `0 8px 22px -14px rgb(29 29 33/.25)` | aktive/fokussierte Karte, Highlight |
| **2 – schwebend** | `--shadow-float` | `0 1px 2px …, 0 10px 28px …` | Toast, Sheets, Dropdown-Overlays, Modals |

**Regeln**
- **Default bleibt flach** – feine Trennung über `--border` (als `1px solid`
  oder `box-shadow: inset 0 0 0 1px var(--border)`) + Flächenwechsel
  (`--surface` auf `--canvas`). Karten/Listenzeilen bekommen **keinen** Schatten.
- Schatten nur für Elemente, die real „über dem Layout" liegen (Toast, Overlay).
- Nie Rahmen **und** Schatten Stufe 2 als reine Deko stapeln.

> **Umsetzungsstand:** `--shadow-raise`/`--shadow-float` sind definiert, aber
> noch **kaum genutzt**; das Kategorie-Popover (`.cat-popover`) und der
> Dropzone-Icon nutzen noch ad-hoc-Schatten (`--shadow` / rohes rgba).
> Vereinheitlichung auf die Elevation-Token ist Sprint-To-do (§17).

---

## 4. Typografie

**Schrift:** **Instrument Sans**, **self-hosted** (Paket
`@fontsource-variable/instrument-sans`, in `main.tsx` importiert, von Vite
gebündelt) – **kein externes CDN** ✅ umgesetzt. Stack:
`--sans: 'Instrument Sans Variable', 'Instrument Sans', ui-sans-serif, system-ui, …`.
Instrument Sans steht unter der **SIL Open Font License** (frei bündelbar) und
rendert plattformübergreifend identisch – anders als ein reiner System-Stack.
Überschriften nutzen denselben Stack (`--heading`), Code `--mono`.

> **Warum self-hosted (Entscheidung v3):** Der Font bleibt (einheitliches
> Rendering, Marken-Charakter), aber der Google-Fonts-Load entfällt –
> **DSGVO** (keine IP-Übertragung an Google), **Performance** (kein
> render-blockierender Fremd-Request) und **Offline/PWA**-Tauglichkeit.

### 4.1 Heading-Hierarchie *(J2 – drei klare Ebenen)*

Genau **drei** Überschriften-Ebenen, jede mit **einer** konsistenten Behandlung.
Die Eyebrow ist eine **Label**-Utility, **keine** Heading-Ebene (nie `<h2 class="eyebrow">`).

| Rolle | Element | Größe (Desktop / mobil) | Gewicht | Einsatz |
|---|---|---|---|---|
| **H1** | `<h1>` | 36px / 28px | 500 | **Ein** Seitentitel pro Screen |
| **H2** | `<h2>` | 20px / 18px | 600 | Abschnittstitel – überall gleich (auch in Cards) |
| **H3** | `<h3>` | 15px | 600 | Unterabschnitt (z. B. Rezept „Ingredients") |
| **Lead / Subtitle** | `.page-lead` | 15px | 400 | Ein Orientierungssatz unter H1 (§4.2) |
| **Eyebrow / Label** | `.eyebrow` (span/label) | ~11px uppercase | 600 | Feld-/Kicker-**Label**, kein Heading |
| **Body** | `<p>` | 16–18px | 400 | Fließtext (`--text`) |
| **Micro / Hinweis** | — | 12–13px | 400 | Meta, Disclosure (`--text`) |

Überschriften erben `--text-h`; Card-Headings sitzen bündig
(`.card h2/h3 { margin-top: 0 }`). Vertikaler Rhythmus über die `--space-*`-Skala
(§6.1), nicht über Einzel-Margins.

### 4.2 Lead / Subtitle *(J6)*

Jeder Screen führt unter dem H1 mit **einem** kurzen Satz ein (`.page-lead`):
Sekundärton (`--text`), `max-width: 56ch`. Beispiel (Results):
*„How your recent shopping stacks up against your targets — trends, not exact values."*

**Zeilenlänge:** Lauftext auf `max-width: 56ch` begrenzen (`.page-lead`, `.profile-lead`).

**Zahlen:** Alle Mess-/Nährwerte mit `font-variant-numeric: tabular-nums`, damit
Mengen/Makros in Spalten sauber untereinander stehen (im Code durchgängig auf
`.stat-tile__value`, `.macro-*`, `.kv-list`, `.purchase-row__*` gesetzt).
**Zahlenformat folgt der aktiven Locale** – Produkt-Default Englisch (`en`):
Tausender-Komma, Dezimalpunkt (`2,431 kcal`, `1.5 l`). Einheiten mit schmalem
Leerzeichen vom Wert trennen.

---

## 5. Icons

Zwei bewusst getrennte Icon-Ebenen:

- **Struktur-/Steuer-Icons** (Navigation, Profil, Zurück, Aktionen): dünne
  **Inline-SVG-Line-Icons** im Stil der Bildmarke – `stroke="currentColor"`,
  `stroke-width 1.8–1.9`, runde Enden, keine Füllung (siehe Profil-Icon in
  `NavBar.tsx`, Pencil/Logout-SVGs). Keine externe Icon-Library.
- **Inhalts-Icons** (Lebensmittel, Bon, Coach-Sprech): **Emoji**, immer in einem
  `aria-hidden`-Span, rein dekorativ.

> **Warum die Trennung (Web-Kontext):** Emoji werden je Betriebssystem/Browser
> unterschiedlich gerendert. Für dekorative Lebensmittel-Icons ist das
> unkritisch und charmant; für **funktionale** Steuer-Elemente ist es ein Risiko
> – die sind daher SVG.

**Icon-Buttons** (Profil): rund (`border-radius:999px`), `1px solid var(--border)`,
inaktiv `--text`, aktiv `background:var(--accent)` + `color:var(--accent-contrast)`.

---

## 6. Layout & Navigation

- **Content-Spalte:** zentriert, `max-width: 720px; margin: 0 auto` (`.app-content`,
  `.nav-bar`). Nav & Main teilen dieselbe Breite.
- **Mobile-first, echte Web-App:** Layout für Touch entworfen, skaliert sauber
  auf Desktop. Kopf-/Fußbereiche dürfen die volle Fensterbreite nutzen, der
  Content bleibt in der Lesespalte.

### Navigationsmodell — **Top-Nav auf allen Breakpoints, geplant sticky**

Weil NutriWise eine **App im Webbrowser** ist (nicht nativ), liegt die
Navigation auf **jedem** Breakpoint in einer Kopfzeile:

```
Kopfzeile (ein Modell für Mobile & Desktop):
  Logo links · Tab-Pills (Upload / Basket / Results / Recipes) · Profil-Icon rechts
  Content darunter in max-width:720px
```

**Begründung**
- Kollidiert **nicht** mit mobiler Browser-Chrome (URL-Leiste, Home-Indicator,
  ein-/ausfahrende Toolbar), anders als eine fixe Bottom-Nav.
- **Ein** Nav-Modell für Mobile & Desktop → eine Komponente, weniger Wartung.
- Passt zum Web-Mentalmodell (Zurück-Button, URL, Teilen).

> **Umsetzungsstand:** Top-Nav ist als **vollbreiter, sticky** `<header
> class="nav-header">` umgesetzt (Hintergrund + Hairline voll­breit, Content in
> der 720px-Spalte) ✅. **Ausnahme** bleibt: Bottom-Nav + FAB nur, falls
> NutriWise gezielt als **installierbare PWA** positioniert wird (dann inkl.
> `env(safe-area-inset-bottom)`).

- **Abschnittstitel:** Bereiche mit **H2** (§4.1) einleiten. Die `.eyebrow`
  ist ein **Label** (Feld-/Kicker-Label), **kein** Section-Heading-Ersatz.
- **Vertikaler Rhythmus:** Gruppen über `flex`/`grid` + `gap` und die
  `--space-*`-Skala (§6.1) – keine gestapelten Einzel-Margins.
- **Touch-Ziele:** interaktive Elemente mind. **44 × 44 px** effektive Fläche
  (über Padding lösen).

### 6.1 Spacing-Skala *(J1)*

Eine 4px-basierte Skala als **einzige** Quelle für Gaps/Paddings/Section-Abstände.
Ad-hoc-px vermeiden.

| Token | Wert | typischer Einsatz |
|---|---|---|
| `--space-1` | 4px | Micro-Gaps |
| `--space-2` | 8px | Label→Control, Chip-Gaps |
| `--space-3` | 12px | Card-Margin, Gruppen-Gap |
| `--space-4` | 16px | Card-/Panel-Padding (Tiles) |
| `--space-5` | 20px | Card-Padding, H1→Content |
| `--space-6` | 24px | **Section-Abstand** (Standard) |
| `--space-8` | 32px | größere Blöcke, `.app-content`-Padding |
| `--space-10` | 40px | Hero-Abstände |

---

## 7. Boxen / Karten

**Standard-Karte** (`.card`):
```
padding: 20px; background: var(--surface); border-radius: 20px;
box-shadow: inset 0 0 0 1px var(--border);   /* flacher Ring statt harter Border */
```

- **Card-Primitive (J3):** `.card` ist die kanonische Basis; alle card-artigen
  Container teilen jetzt **zwei** Radien und **inset-Ring**-Trennung.
- **Rundung (zwei Stufen):** **Cards/Panels = 20px** (`.card`, `.upload-card`,
  `.chat-card`, `.recipe-card`); **Tiles/eingebettet = 16px** (`.stat-tile`,
  `.macro-ring-tile`, `.details-panel`, `.shelf-life-panel`, `.add-item-panel`,
  `.callout`). Buttons `14px`; Inputs `12–14px`; Pills/Chips/Icon-Buttons `999px`.
- **Trennung** durchgängig über den **inset-Ring**
  (`box-shadow: inset 0 0 0 1px var(--border)`) + Flächenwechsel (`--surface` auf
  `--canvas`) – **keine** harte `1px`-Border mehr für Container. Schatten nur nach §3.
- **Akzent-Box** (Hinweis/Highlight): `--sage-soft` mit `--sage-ink`
  (`.callout--success`).
- **Signal-Box** (Frische/Status): entsprechende soft-Fläche + Text-Ton, z. B.
  `--warn-soft` + `--warn` für „expiring soon".
- **Sekundär-Box** (eingebettet, ruhig): `--code-bg` + `--border`
  (`.callout--muted`).

> **Umsetzungsstand:** Alle card-artigen Container laufen jetzt über
> inset-Ring + die zwei Radien (J3) ✅. Segmentierte Controls/Dropdown-Trigger
> (z. B. `.basket-toggle`, `.filter-btn`) behalten bewusst kleinere Radien.

---

## 8. Buttons & Pills

**Primär-Button** (`.btn.btn-primary`) – Vollton **`--accent`** (Ink), als
Haupt-CTA prominent (J4):
```
padding: 14px var(--space-6); border-radius: 14px; font-size: 15px; font-weight: 600;
background: var(--accent); color: var(--accent-contrast);
```
In Formularen (`.form`, `.recipe-generate-form`) füllt der Primär-Button die
Spalte (**vollbreit**); sonst per `.btn--block`. Beispiel-Label: „Generate recipe".
**Hover:** einheitlicher `translateY(-1px)`-Lift über **alle** `.btn`-Varianten.

**Sekundär-Button** (`.btn.btn-secondary`): `--surface` + `--border`, rund.

**Soft-Button** (`.btn-soft`) – leichte, positive Inline-Aktionen (z. B. „Edit",
„My data"): `background: var(--sage-soft); color: var(--sage-ink);` rund, mit
inset-Ring. Gedämpfte Fläche, **nie** Vollton-Salbeigrün.

**Danger-Button** (`.btn-danger`): `--surface` + `border-color: var(--danger)` +
`color: var(--danger)`; im Hover Vollfläche `--danger` + `#fff`. (Nutzt das
`--danger`-Token – die frühere Hex-Abweichung `#d1495b` ist bereinigt.)

**Toggle-Chips** *(J5 – eine Spec)* – eigenständige Auswahl-Chips
(`.filter-chip`, `.filter-pill`, `.chat-choice`) teilen jetzt **ein** Muster:
```
padding: 7px 14px; border-radius: 999px; font-size: 13px; font-weight: 500;
border: 1px solid var(--border);
inaktiv:  background: var(--code-bg); color: var(--text);
aktiv:    background: var(--accent); color: var(--accent-contrast);
```
**Segmentierte Controls** (`.tab`, `.basket-toggle`) sind eine eigene Rolle
(Items in einem gerundeten Container, transparent, aktiv = `--accent`) und
bleiben davon getrennt.

**Tab-Pill / aktive Zustände:** aktiv `background: var(--accent)` +
`color: var(--accent-contrast)`; inaktiv `--text` → hover `--text-h`.

**Muster:** primärer/aktiver Zustand = `--accent` (dunkler Vollton). Der
**Vollton-Akzent Salbeigrün** (`--sage`) bleibt Marke/Highlights vorbehalten und
wird für Standard-Buttons **nicht** eingesetzt – nur die **soft**-Variante.

---

## 9. Formulare & Eingaben

**Input/Textarea/Select:** `--surface` (bzw. `--code-bg`) + `1px solid
var(--border)` (oder inset-Ring), abgerundet (`10–14px`), Text `--text-h`.

**Feld:** Label (`.eyebrow`/`.form-field label`) über dem Control, `gap`-basiert.

**Fokus:** immer sichtbar – `focus-visible` mit Ring in `--sage`
(`outline: 2px solid var(--sage)` bzw. `box-shadow: inset 0 0 0 2px var(--sage)`).
Nie `outline: none` ohne Ersatz-Fokus; auch per **Tastatur** klar erkennbar.

**Validierung:** Fehlerzustand über `--warn`/`--danger` + Klartext-Hinweis
darunter (`.form-error`), **nie nur Farbe** (Farbenblindheit) – immer Farbe
**und** Text/Icon.

---

## 10. Dropdown / Select & Accordion

**Select (Dropdown):** natives `<select>` im Input-Stil – keine
custom-gestylte Liste. Konsistent mit allen anderen Eingaben.

**Accordion / Ausklappen:** natives `<details>` / `<summary>`.
- **Klappbarer Abschnitt** (Pantry-Kategorien, Rezept-Karten): Karte in
  `--surface` + `--border`, `<summary>` mit `cursor: pointer`.
- **Inline-Disclosure** („Why?" / Details) dezent, in `--text`, kleiner.
- Per Default sinnvoll `open` setzen, wenn der Inhalt primär ist.

---

## 11. Motion & Animation

Bewegung ist funktional, nicht dekorativ – sie erklärt Zustandswechsel.

- **Dauer:** kurz (`120–280 ms`), `ease`/`ease-out`. Micro-Feedback (Button
  gedrückt) ~50 ms.
- **Erlaubt:** Ein-/Ausblenden von Toasts & Sheets, „pop" neuer Chat-Bubbles,
  sanftes Opacity-Fade beim Abhaken, Fortschrittsbalken, Skeleton-Puls.
- **Tabu:** Dauer-Loops, Parallaxe-Deko, alles, was vom Inhalt ablenkt.
- **`prefers-reduced-motion`: Pflicht.** Bei reduzierter Bewegung Transitions/
  Animationen abschalten (im Code für `.skeleton` umgesetzt; **bislang nur dort**
  – auf alle Animationen ausweiten ist To-do, §17).

---

## 12. Zustände: Laden · Leer · Fehler

Jede datengetriebene Ansicht braucht drei Zustände neben dem Normalfall.
Beispiel-Copy in Produktsprache (Englisch):

- **Laden:** Skeleton-Platzhalter in `--code-bg` mit dezentem Puls (respektiert
  `reduced-motion`, `.skeleton`). Kein blockierender Vollbild-Spinner.
- **Leer:** freundlich und handlungsleitend im Coach-Ton – Blatt/Emoji, ein Satz,
  **eine** klare Primäraktion. Beispiel (leerer Vorrat):
  *„No items yet — add your first receipt to get started."* → Button *„Add receipt"*.
  Nie nur „No data".
- **Fehler:** sagt, *was* schiefging und *wie weiter* (`--warn`/`--danger` +
  Wiederholen-Aktion, `.form-error` mit `role="alert"`). Beispiel: *„Couldn't read
  that receipt. Try another photo or add items manually."* Keine Roh-Fehlercodes.
- **On-device-Kontext:** OCR/Parsing kann fehlschlagen → immer manueller
  Korrektur-/Wiederholungsweg, nie Sackgasse.

---

## 13. Barrierefreiheit

- **Kontrast:** Text ≥ WCAG **AA** (4.5:1; große/fette Schrift 3:1). Signal-Töne
  daher abgedunkelt (§2.2). Helle `-bright`-Töne nur non-textuell.
- **Nie Farbe allein:** Status immer zusätzlich über Text/Icon/Position.
- **Tastatur:** alles bedienbar, sichtbarer `focus-visible`-Ring (`--sage`),
  logische Reihenfolge.
- **Semantik & Labels:** echte Buttons/Links, `aria-hidden` auf dekorativen
  Emoji, `aria-label` auf Icon-only-Buttons, `role="status"`/`aria-live` auf
  dynamischen Meldungen (im Code z. B. `AddItemPanel`, Basket-Callout).
- **Sprache:** `<html lang="en">` gesetzt (Produktsprache) – ✅ umgesetzt.
- **Touch-Ziele:** siehe §6 (≥ 44 px).

---

## 14. Voice & Tone *(Produktsprache Englisch)*

Der **Coach „Nährbert"** trägt die Identität – die Sprache trägt sie mit. Das
**Produkt** heißt „NutriWise"; der Coach spricht als „Nährbert" (z. B. Chat:
*„Hi, I'm Nährbert …"*). Produkttexte sind **Englisch**.

- **Warm, knapp, ermutigend.** Kleine Fortschritte feiern (*„Small steps
  count 🌱"*), nie moralisieren oder mit Kalorien drohen.
- **Direkte „you"-Ansprache**, aktiv, konkret: der Button sagt, was passiert
  (*„Generate recipe"*, danach *„Recipe ready"*).
- **Ehrlich über Schätzungen:** *„Trends, not exact values · not medical
  advice."* – Vertrauen vor Präzisions-Behauptung.
- **Sparsam mit Emoji** in Fließtext: 🌱 als Signatur, sonst zurückhaltend.
- **Fehlermeldungen** erklären *was* und *wie weiter*, ohne Entschuldigung/Vagheit.

---

## 15. Radien & Trennung – Übersicht

| Element | Rundung |
|---|---|
| Cards / Panels (`.card`, `.upload-card`, `.chat-card`, `.recipe-card`) | `20px` |
| Tiles / eingebettet (`.stat-tile`, `.details-panel`, `.callout` …) | `16px` |
| Primär-/Sekundär-Buttons | `14px` (Account-Buttons `16px`) |
| Inputs, Selects | `12–14px` |
| Segmentierte Controls (`.tab`, `.basket-toggle`), Dropdown-Trigger | `7–10px` |
| Toggle-Chips, Pills, Icon-Buttons, Badges | `999px` (voll) |

Container-Trennung durchgängig als `box-shadow: inset 0 0 0 1px var(--border)`
(**Standard**, keine harte `1px`-Border mehr); Fokus `--sage`; Höhe nach
Elevation (§3). Abstände nach der `--space-*`-Skala (§6.1).

---

## 16. Do's & Don'ts (Kurzfassung)

**Do**
- Nur Token nutzen (`var(--sage)`, `var(--text-h)`, `var(--border)`, `var(--warn-soft)`).
- Salbeigrün (`--sage`) als **einzigen Marken-Akzent**, sparsam.
- Funktionsfarben **nur** für Status (Frische, Ziel-Abweichung, Fehler).
- Trennung über `--border` (Default), Schatten bewusst nach §3.
- Top-Nav als **einziges** Nav-Modell (Mobile & Desktop), Ziel: sticky.
- Jede Ansicht mit Lade-/Leer-/Fehler-Zustand denken.
- Farbe immer mit Text/Icon doppeln (Barrierefreiheit).
- Produkt-UI konsequent auf **Englisch**.

**Don't**
- Keine hart kodierten Hex-Werte in Komponenten.
- **Kein Tailwind / keine Utility-Klassen** einführen – CSS-Vars + semantische Klassen.
- Keine zweite Palette für Marketing/Landing.
- Vollton-Salbeigrün (`--sage`) nicht für Standard-Buttons (nur soft-Variante).
- Funktionsfarben nicht als Deko missbrauchen.
- Schatten nicht als Standard-Trennung von Flächen.
- Keine Bottom-Nav/FAB (außer bewusster PWA-Ausnahme, §6).
- **Kein externes Font-/Icon-CDN** (Instrument Sans self-hosted, Icons inline-SVG).
- Status nie nur über Farbe kommunizieren.
- Produktnamen „NutriWise" nicht verändern; Coach „Nährbert" nicht als Produktname.

---

## 17. Offen / Nächste Schritte (Sprint-Backlog v3)

**✅ Umgesetzt (Sprint E–H + J1–J6):**
1. **Font self-hosten** – via `@fontsource-variable/instrument-sans`, Google-CDN raus.
2. **Marke/Logo** – `Logo.tsx` (Blatt), „NutriWise"-Lockup in Nav & Login, Titel.
3. **Sticky Top-Nav** – vollbreiter `.nav-header`, `position: sticky`.
4. **Signalfarben konsolidiert** – alle Status-Hex auf Signal-Token (§2.2).
5. **Toter Token** `--text-muted` → `--text`.
6. **Elevation-Token** – Overlay/Dropzone auf `--shadow-float`/`-raise`; Legacy `--shadow` entfernt.
7. **`reduced-motion` global** – app-weite Regel, nicht nur `.skeleton`.
9. **CI/CD** – `npm run format:check` im Frontend-Job.
- **J1** Spacing-Skala (`--space-*`) + Section-Rhythmus (§6.1).
- **J2** Heading-Hierarchie H1/H2/H3, Eyebrow = Label (§4.1).
- **J3** Card-Primitive: zwei Radien + inset-Ring (§7).
- **J4** CTA prominenter, vollbreit in Formularen, einheitlicher Hover (§8).
- **J5** Toggle-Chips auf eine Spec (§8).
- **J6** `.page-lead` unter H1 auf Kernseiten (§4.2).

**Offen:**
8. **Dark-Mode-Finalisierung:** AA-Kontrast-Check der Dark-Signaltöne gegen die
   Dark-soft-Flächen; ggf. als eigenes, sauber definiertes Token-Set.
- **Frontend-Tests** in der CI erwägen (aktuell nur Lint/Format/Build).
- **Weitere J-Härtung (optional):** verbleibende Einzel-Margins auf `--space-*`
  ziehen; `.btn`-Basis auf die 3 Buttons ohne `btn`-Klasse konsistent anwenden.

---

## Anhang · Changelog v2 → v3 (2026-07-27)

- **Grundsatz:** Guideline folgt dem realen Code – **CSS-Custom-Properties +
  semantische Klassen** statt Tailwind-Utility-Vokabular. Neue **Token-Referenz
  & Mapping-Tabelle** (§0), inkl. Warnung zur `--accent`-Namensumkehr (= Ink).
- **Marke (§1/§14):** Produktname **„NutriWise"** (Wortmarke/Logo/Titel/Login);
  **„Nährbert"** ist ab jetzt ausdrücklich die **Coach-Persona**, nicht der
  Produktname.
- **Font (§4):** Instrument Sans **erlaubt, aber self-hosted** (OFL) – externes
  Google-Fonts-CDN wird entfernt (DSGVO/Performance/Offline).
- **Dark Mode:** von „noch nicht" auf **unterstützt/live** hochgestuft; finaler
  AA-Check als offener Punkt (§17.8).
- **Navigation (§6):** Top-Nav real umgesetzt; **sticky** ist decided, aber noch
  ausstehend (§17.3).
- **Farben (§2):** Tabellen auf reale Token-Namen + Dark-Werte umgestellt;
  Roh-Hex-Bereinigung als Backlog (§17.4).
- **Elevation (§3) / Karten (§7) / Radien (§15):** an reale Werte angeglichen
  (px-Radien, `--border`-Trennung, inset-Ring als neuer Standard).
- **§17:** frühere „Bekannte Abweichung" `.btn-danger` als **erledigt** markiert;
  neues, priorisiertes Sprint-Backlog ergänzt.
- **UX-Optimierungen J1–J6 (Design-System):** Spacing-Skala `--space-*` (§6.1);
  klare Heading-Hierarchie H1/H2/H3 + Eyebrow-als-Label + `.page-lead` (§4.1/§4.2);
  Card-Primitive mit zwei Radien + inset-Ring (§7/§15); prominenterer CTA +
  einheitlicher Hover (§8); Toggle-Chips auf eine Spec (§8).
- **Sprint-Fortschritt:** E, A, B, C, D, F, G, H **live**; nur Dark-Mode-AA offen.
- **Doc-Sprache** bleibt Deutsch; **Produkt-/UI-Copy Englisch**.
