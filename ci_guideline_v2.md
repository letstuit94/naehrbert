# Nährbert – CI-Guideline (v2)

Corporate-Identity-Richtlinie für die Web-App. Alle Werte beschreiben den
„Grocery Shadow"-Look: ruhige, editoriale Neutraltöne (Canvas/Ink), **ein**
Marken-Akzent (Salbeigrün), eine klar getrennte **Funktions-/Signalebene**
(clay/amber/sage-ok), großzügige Rundungen, System-Schrift.

**v2-Haltung – „Hybrid":** Die disziplinierte Token-Basis aus v1 bleibt. Neu
dosiert eingebaut wird die *Wärme* aus dem UI-Mockup — aber nur dort, wo sie
**Funktion** trägt: schwebende Elemente heben sich per Elevation-Token ab,
Frische-/Status-Signale werden farbig lesbar. Die *Ruhe* bleibt dort, wo sie
zählt: Ink-Buttons, Ringe als Default, keine Hex-Werte in Komponenten.

> **Sprache:** Dieses Guideline-Dokument ist die interne Arbeitsgrundlage und
> bleibt auf **Deutsch**. Die **Produkt-/UI-Sprache ist Englisch** – alle
> Beispiel-Texte, Button-Labels und Voice-&-Tone-Beispiele unten sind daher in
> der Produktsprache (Englisch) notiert.

> Quelle der Wahrheit sind die Design-Tokens in `index.css`. Werte hier nie
> als Hex hart in Komponenten kopieren – immer die Token-Klassen benutzen
> (`bg-accent`, `text-ink`, `ring-black/5`, `bg-warn-soft` …).

> **Dark Mode:** in v2 bewusst **noch nicht** ausdefiniert (eigenes Thema).
> Alle Tokens sind aber semantisch benannt (`--surface`, `--ink`, `--warn` …),
> damit Dark Mode später rein additiv über ein zweites Token-Set eingezogen
> werden kann – ohne Komponenten anzufassen.

---

## 1. Logo

**Bildmarke:** ein stilisiertes Blatt (ein einzelner SVG-Pfad,
`components/Logo.tsx`). Es spiegelt den 🌱-Coach-Avatar aus dem Onboarding/Chat
– Marke und „Coach" lesen sich als **eine** Identität.

- Gezeichnet mit `stroke="currentColor"` → erbt automatisch die Textfarbe.
  Auf farbigem Grund also einfach `text-accent` bzw. `text-canvas` setzen,
  kein zweiter Hex-Wert.
- Keine Icon-Library, keine Füllung – nur Kontur (`strokeWidth 1.8`,
  runde Enden).

**Lockup (Standard-Kopfzeile):** Blatt-Badge + Wortmarke nebeneinander.

```
[ 🍃 ]  Nährbert
 └ Badge: size-6, rounded-full, bg-accent-soft, text-accent, Logo size-3.5
    Wortmarke: text-sm, font-medium, tracking-tight
```

**Wortmarke:** immer „Nährbert", CamelCase, ein Wort (Markenname – **nicht**
übersetzen, auch in der englischen UI).

**Don'ts**
- Blatt nicht verzerren, drehen oder mit Farbverlauf füllen.
- Badge-Hintergrund nur `accent-soft` (nicht Vollton-Akzent).
- Keine Schlagschatten auf dem Logo.


---

## 2. Farben (Tokens)

### 2.1 Marke & Neutraltöne

| Token | Klasse | Wert (Quelle) | ≈ Hex | Verwendung |
|---|---|---|---|---|
| `--canvas` | `bg-canvas` | `oklch(0.985 0 0)` | `#FBFBFB` | Seitenhintergrund |
| `--surface` | `bg-surface` | `oklch(1 0 0)` | `#FFFFFF` | Karten / Boxen |
| `--ink` | `text-ink` | `oklch(0.18 0.005 270)` | `#1B1B1F` | Primärtext, dunkle Buttons |
| `--ink-soft` | `text-ink-soft` | `oklch(0.45 0.005 270)` | `#6B6B71` | Sekundärtext |
| `--accent` | `bg-accent` / `text-accent` | `#7C9A6A` | `#7C9A6A` | **einziger** Marken-Akzent (Salbeigrün) |
| `--accent-soft` | `bg-accent-soft` | `#EEF2EA` | `#EEF2EA` | Akzent-Flächen, Badges, soft-Buttons |
| `--accent-ink` | `text-accent-ink` | `#4F6B3C` | `#4F6B3C` | Text/Icon **auf** `accent-soft` (AA-fest) |

### 2.2 Funktions- / Signalebene *(neu in v2)*

Eigene Ebene für **Status**, bewusst getrennt vom Marken-Akzent. Salbeigrün
signalisiert „gut/frisch/ok" – rechts daneben clay (Warnung) und amber (Achtung).

| Token | Klasse | ≈ Hex | Bedeutung |
|---|---|---|---|
| `--ok` (= accent-ink) | `text-ok` | `#4F6B3C` | ok · frisch · im Ziel |
| `--ok-soft` (= accent-soft) | `bg-ok-soft` | `#EEF2EA` | ok-Fläche/Badge |
| `--warn` | `text-warn` | `#A8522E` | läuft ab · niedrig · unter Ziel |
| `--warn-soft` | `bg-warn-soft` | `#F6E6DE` | Warn-Fläche/Badge |
| `--caution` | `text-caution` | `#8A6A15` | Achtung · etwas hoch · über Ziel |
| `--caution-soft` | `bg-caution-soft` | `#F6ECD6` | Achtung-Fläche/Badge |
| `--danger` | `text-danger` / `bg-red-500` | `#DC2626` | Fehler · destruktive Aktion · Benachrichtigungs-Punkt |

> **Kontrast-Hinweis (Barrierefreiheit, freigegeben):** Die *Text*-Töne
> `warn`/`caution` sind gegenüber dem Mockup abgedunkelt (clay `#C2683F` →
> `#A8522E`, amber `#CF9A34` → `#8A6A15`), damit sie auf `surface` **und** auf
> ihrer soft-Fläche WCAG AA erreichen. Die *hellen* Originaltöne (`#C2683F`,
> `#CF9A34`) nur für **nicht-textuelle** Elemente verwenden – Balken, Punkte,
> Ring-Füllungen.

**Grundsätze**
- **Ein Marke-Akzent.** Salbeigrün ist der einzige Markenfarbton. Keine zweite
  „Marketing-Palette" – Landing, Onboarding & App teilen dieselbe Basis.
- **Signalfarben ≠ Deko.** clay/amber/danger dürfen **ausschließlich** Status
  transportieren (Frische, Ziel-Abweichung, Fehler), nie zur Zierde.
- **Ink-Transparenzen statt neuer Grautöne.** Abstufungen über Deckkraft:
  `text-ink/40` (Labels), `/50`–`/60` (Sekundärtext), `/70` (kräftiger).
- **Ränder** als feiner Ring: `ring-1 ring-black/5` – nie harte 1px-Border.
- **Eingabe-Flächen:** `bg-zinc-50` (`#FAFAFA`) für Inputs/Selects.

---

## 3. Elevation & Schatten *(neu in v2 – Kern der Hybrid-Entscheidung)*

In v1 waren Schatten verboten. In v2 ist Schatten ein **bewusstes
Elevation-Token** – kein Default. Fläche liegt flach; nur was *schwebt* oder
*Aufmerksamkeit fordert*, bekommt Höhe.

| Stufe | Token | Wert | Einsatz |
|---|---|---|---|
| **0 – flach** | `ring-1 ring-black/5` | (kein Schatten) | Standard: Karten, Zeilen, Inputs |
| **1 – angehoben** | `shadow-raise` | `0 8px 22px -14px rgb(29 29 33/.25)` | aktive/fokussierte Karte, Rezept-Highlight |
| **2 – schwebend** | `shadow-float` | `0 1px 2px rgb(29 29 33/.05), 0 10px 28px rgb(29 29 33/.08)` | Toast, Sheets, Dropdown-Overlays, Modals |

**Regeln**
- **Default bleibt flach** (Ring + Flächenwechsel). Karten und Listenzeilen
  bekommen **keinen** Schatten.
- Schatten signalisiert „liegt über dem Layout" – daher nur für Elemente, die
  das auch tun (Toast, Overlay) oder für einen einzelnen hervorgehobenen Block.
- Nie Ring **und** Schatten der Stufe 2 zusammen als reine Deko stapeln.

---

## 4. Typografie

**Schrift:** System-Sans-Stack, kein Webfont geladen.
`ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`
(`--font-sans`). Bewusst gewählt – kein externer Font-Load.

Durchgängig: `font-medium` als Standardgewicht, `tracking-tight` bei
Überschriften, `text-balance`/`text-pretty` für sauberen Umbruch.

| Rolle | Klassen | Einsatz |
|---|---|---|
| **H1** | `text-4xl font-medium leading-none tracking-tight text-balance` | Seiten-/Screen-Titel (kleiner: `text-3xl`) |
| **H2** | `text-sm font-semibold tracking-tight text-ink` | Abschnittstitel **innerhalb** von Karten |
| **H3** | `text-sm font-medium tracking-tight text-ink` | Untergeordnete Blöcke |
| **Eyebrow / Label** | `text-xs font-medium uppercase tracking-widest text-ink/40` | Über-Titel-Label (`<SectionLabel>`), Feld-Labels |
| **Lead / Subtitle** | `text-base text-ink/60 max-w-[56ch] text-pretty` | Einleitungssatz unter H1 |
| **Body** | `text-sm text-ink/70` bzw. `/60` | Fließtext |
| **Micro / Hinweis** | `text-xs text-ink/50` | Meta, Disclosure-Zeilen |

**Zeilenlänge:** Lauftext auf `max-w-[56ch]` begrenzen.

**Zahlen *(neu in v2)*:** Alle Mess-/Nährwerte mit `tabular-nums`
(`font-variant-numeric`), damit Mengen und Makros in Spalten sauber
untereinander stehen. **Zahlenformat folgt der aktiven Locale** – Produkt-Default
ist aktuell Englisch (`en`): Tausender-Komma, Dezimalpunkt (`2,431 kcal`,
`1.5 l`). Einheiten mit schmalem Leerzeichen vom Wert trennen.

---

## 5. Icons

Zwei bewusst getrennte Icon-Ebenen:

- **Struktur-/Steuer-Icons** (Navigation, Profil, Zurück, Aktionen): dünne
  **SVG-Line-Icons** im Stil der Bildmarke – `stroke="currentColor"`,
  `strokeWidth 1.8–1.9`, runde Enden, keine Füllung. So bleiben Nav & Marke
  konsistent und plattformunabhängig gerendert.
- **Inhalts-Icons** (Lebensmittel, Bon, Coach-Sprech): **Emoji**, immer in einem
  `aria-hidden`-Span, rein dekorativ.

> **Warum die Trennung (Web-Kontext):** Emoji werden je Betriebssystem/Browser
> unterschiedlich gerendert (Apple ≠ Windows ≠ Android). Für dekorative
> Lebensmittel-Icons ist das unkritisch und sogar charmant; für **funktionale**
> Steuer-Elemente (Nav, Buttons) ist es ein Risiko – die sind daher SVG.
> Keine externe Icon-Library.

**Icon-Buttons** (Bell/Profil): `size-8 rounded-full ring-1 ring-black/5`,
inaktiv `bg-surface text-ink/55`, aktiv `bg-ink text-canvas`.

---

## 6. Layout & Navigation *(erweitert & entschieden in v2)*

- **Content-Spalte:** zentriert, `mx-auto max-w-3xl`. Nav & Main teilen dieselbe
  Breite.
- **Mobile-first, echte Web-App:** Layout wird für Touch entworfen, skaliert
  aber auf Desktop sauber hoch. Die zentrierte Spalte darf am Desktop **nicht**
  wie ein „Handy im Browser" wirken – Kopf-/Fußbereiche dürfen die volle
  Fensterbreite nutzen, der Content bleibt in der Lesespalte.

### Navigationsmodell — **entschieden: Sticky Top-Nav auf allen Breakpoints**

Weil Nährbert eine **App im Webbrowser** ist (nicht nativ), liegt die Navigation
auf **jedem** Breakpoint in einer klebrigen Kopfzeile:

```
Kopfzeile (sticky top, ein Modell für Mobile & Desktop):
  Logo links · Tab-Pills (Basket / Tipp / Insights) · „+ Bon“ · Profil-Icon rechts
  Content darunter in mx-auto max-w-3xl
```

**Begründung**
- Kollidiert **nicht** mit der mobilen Browser-Chrome (URL-Leiste,
  Home-Indicator, ein-/ausfahrende Safari-Toolbar), anders als eine fixe
  Bottom-Nav.
- **Ein** Nav-Modell für Mobile & Desktop → eine Komponente, weniger Wartung.
- Passt zum Web-Mentalmodell (Zurück-Button, URL, Teilen).

**Ausnahme:** Bottom-Nav + FAB nur, falls Nährbert später gezielt als
**installierbare PWA** mit App-Feel positioniert wird – dann als bewusste
Entscheidung inkl. `env(safe-area-inset-bottom)`-Handling.

- **Abschnittslabel:** Bereiche mit `<SectionLabel>` (Eyebrow) einleiten statt
  mit großen Zwischenüberschriften.
- **Vertikaler Rhythmus:** Gruppen über `flex`/`grid` + `gap` bzw. `space-y-*`
  – keine gestapelten Einzel-Margins.
- **Touch-Ziele:** interaktive Elemente mind. **44 × 44 px** effektive Fläche
  (auch wenn das Icon kleiner ist – über Padding lösen).

---

## 7. Boxen / Karten

**Standard-Karte** (`<Card>`, AppShell):
```
rounded-2xl bg-surface p-5 ring-1 ring-black/5
```

- **Rundung:** Karten & Buttons `rounded-2xl`; Inputs/Pills `rounded-xl`;
  Toggles/Badges `rounded-full`; große Flächen `rounded-3xl`.
- **Trennung** primär durch Ring (`ring-1 ring-black/5`) + Flächenwechsel
  (`surface` auf `canvas`). Schatten nur nach dem Elevation-Modell (§3), nicht
  als Standard-Trennung.
- **Akzent-Box** (Hinweis/Highlight): `bg-accent-soft` mit `text-accent-ink`.
- **Signal-Box** (Frische/Status): entsprechende soft-Fläche + Text-Ton, z. B.
  `bg-warn-soft text-warn` für „expiring soon“.
- **Sekundär-Box** (eingebettet, ruhig): `bg-zinc-50 ring-1 ring-black/5`.

---

## 8. Buttons & Pills

**Primär-Button** (`<PrimaryButton>`) – Vollton **Ink**:
```
w-full rounded-2xl bg-ink px-6 py-4 text-sm font-medium tracking-tight
text-canvas transition-opacity disabled:opacity-40
```
Beispiel-Label (Produktsprache Englisch): „Generate recipe“.

**Akzent-Soft-Button** *(neu in v2)* – für leichte, positive Inline-Aktionen
(Produkt-Labels z. B. „Eaten“, „Save“):
```
rounded-full bg-accent-soft px-3 py-1.5 text-xs font-medium
text-accent-ink ring-1 ring-black/5 transition
```

**Tab-Pill (Navigation):** Gruppe in `rounded-full bg-surface p-1 ring-1 ring-black/5`.
```
rounded-full px-3 py-1.5 text-xs font-medium tracking-tight
aktiv:  bg-ink text-canvas
inaktiv: text-ink/55 hover:text-ink
```

**PillToggle** (Auswahl-Chips, `<PillToggle>`):
```
rounded-xl px-4 py-2.5 text-sm font-medium tracking-tight ring-1
aktiv:  bg-ink text-canvas ring-ink
inaktiv: bg-zinc-50 text-ink/60 ring-black/5 hover:text-ink
```

**Muster:** primärer/aktiver Zustand = `bg-ink text-canvas` (dunkler Vollton).
Der **Vollton-Akzent** (`bg-accent`) bleibt der Marke/Highlights vorbehalten und
wird für Standard-Buttons **nicht** eingesetzt. Erlaubt ist nur die
**soft**-Akzent-Variante oben (gedämpfte Fläche, kein Vollton).

---

## 9. Formulare & Eingaben

**Input/Textarea/Select** (`inputCls`, AppShell):
```
w-full rounded-xl bg-zinc-50 px-4 py-3 text-sm text-ink
ring-1 ring-black/5 outline-none focus:ring-ink/30
```

**Feld** (`<Field>`): Label (`<SectionLabel>`, Eyebrow-Stil) über dem Control,
`space-y-2`.

**Fokus:** immer sichtbar via `focus:ring-ink/30` – nie `outline-none` ohne
Ersatz-Fokus. Fokus muss auch per **Tastatur** klar erkennbar sein
(`focus-visible`).

**Validierung *(neu in v2)*:** Fehlerzustand über `--warn`/`--danger` +
Klartext-Hinweis darunter (`text-xs text-warn`), nie nur Farbe allein
(Farbenblindheit) – immer Farbe **und** Text/Icon.

---

## 10. Dropdown / Select & Accordion

**Select (Dropdown):** natives `<select>` mit `inputCls` – keine
custom-gestylte Liste. Konsistent mit allen anderen Eingaben.

**Accordion / Ausklappen:** natives `<details>` / `<summary>`.
- **Klappbarer Abschnitt** (z. B. Pantry-Kategorien):
  ```
  <details open className="overflow-hidden rounded-2xl bg-surface ring-1 ring-black/5">
  ```
- **Inline-Disclosure** („Why?“ / Details) dezent:
  ```
  <details className="text-xs text-ink/50">
    <summary className="cursor-pointer"> … </summary>
  ```
- `<summary>` immer `cursor-pointer`; per Default sinnvoll `open` setzen, wenn
  der Inhalt primär ist.

---

## 11. Motion & Animation *(neu in v2)*

Bewegung ist funktional, nicht dekorativ – sie erklärt Zustandswechsel.

- **Dauer:** kurz (`120–280 ms`), `ease`/`ease-out`. Micro-Feedback (Button
  gedrückt) `~50 ms scale(.97)`.
- **Erlaubt:** Ein-/Ausblenden von Toasts & Sheets, „pop" neuer Chat-Bubbles,
  sanftes Opacity-Fade beim Abhaken („Eaten“), Fortschrittsbalken.
- **Tabu:** Dauer-Loops, parallaxe Deko, alles, was vom Inhalt ablenkt.
- **`prefers-reduced-motion`: Pflicht.** Bei reduzierter Bewegung Transitions
  abschalten (`* { transition: none }`) und Animationen durch einfaches
  Einblenden ersetzen.

---

## 12. Zustände: Laden · Leer · Fehler *(neu in v2)*

Jede datengetriebene Ansicht braucht drei Zustände neben dem Normalfall –
in einer Vorrats-/Bon-App sind sie kein Sonderfall, sondern Alltag.
Beispiel-Copy in Produktsprache (Englisch):

- **Laden:** Skeleton-Platzhalter in `bg-zinc-50` mit dezentem Puls (respektiert
  `reduced-motion`). Kein blockierender Vollbild-Spinner.
- **Leer:** freundlich und handlungsleitend im Nährbert-Ton – Blatt/Emoji,
  ein Satz, **eine** klare Primäraktion. Beispiel (leerer Vorrat):
  *„No items yet — add your first receipt to get started.“* → Button *„Add receipt“*.
  Nie nur „No data".
- **Fehler:** sagt, *was* schiefging und *wie weiter* (`text-warn`/`text-danger`
  + Wiederholen-Aktion). Beispiel: *„Couldn't read that receipt. Try another
  photo or add items manually.“* Keine Roh-Fehlercodes, keine Floskeln.
- **On-device-Kontext:** OCR/Parsing kann fehlschlagen → immer manueller
  Korrektur-/Wiederholungsweg, nie Sackgasse.

---

## 13. Barrierefreiheit *(neu in v2)*

- **Kontrast:** Text ≥ WCAG **AA** (4.5:1; große/fette Schrift 3:1). Signal-Töne
  daher abgedunkelt (§2.2). Helle clay/amber nur non-textuell.
- **Nie Farbe allein:** Status immer zusätzlich über Text/Icon/Position
  (Frische-Badge trägt Label, nicht nur Farbe).
- **Tastatur:** alles bedienbar, sichtbarer `focus-visible`-Ring, logische
  Reihenfolge.
- **Semantik & Labels:** echte Buttons/Links, `aria-hidden` auf dekorativen
  Emoji, `aria-label` auf Icon-only-Buttons, `aria-live="polite"` auf Toasts.
- **Sprache:** `<html lang="en">` setzen (Produktsprache), damit Screenreader
  korrekt aussprechen.
- **Touch-Ziele:** siehe §6 (≥ 44 px).

---

## 14. Voice & Tone *(neu in v2 · Produktsprache Englisch)*

Die Marke **ist** der Coach „Nährbert" – die Sprache trägt die Identität mit.
Produkttexte sind **Englisch**.

- **Warm, knapp, ermutigend.** Kleine Fortschritte feiern (*„Small steps
  count 🌱“*), nie moralisieren oder mit Kalorien drohen.
- **Direkte „you"-Ansprache**, aktiv, konkret: der Button sagt, was passiert
  (*„Generate recipe“*, danach Toast *„Recipe ready“*).
- **Ehrlich über Schätzungen:** *„Trends, not exact values · not medical
  advice.“* – Vertrauen vor Präzisions-Behauptung.
- **Sparsam mit Emoji** in Fließtext: 🌱 als Signatur, sonst zurückhaltend.
- **Fehlermeldungen** erklären *was* und *wie weiter*, ohne Entschuldigung
  oder Vagheit.

---

## 15. Radien & Ringe – Übersicht

| Element | Rundung |
|---|---|
| Karten, Primär-Buttons, klappbare Sektionen | `rounded-2xl` |
| Inputs, Selects, PillToggle | `rounded-xl` |
| Tab-Pills, Badges, Icon-Buttons, Sprach-Toggle, soft-Buttons | `rounded-full` |
| Große Hero-Flächen | `rounded-3xl` |

Ränder als `ring-1 ring-black/5`; Fokus `ring-ink/30`; Höhe nach
Elevation-Modell (§3).

---

## 16. Do's & Don'ts (Kurzfassung)

**Do**
- Nur Token-Klassen nutzen (`bg-accent`, `text-ink`, `bg-surface`, `bg-warn-soft`).
- Salbeigrün als **einzigen Marken-Akzent**, sparsam.
- Funktionsfarben **nur** für Status (Frische, Ziel-Abweichung, Fehler).
- Abstufungen über `text-ink/NN`-Deckkraft.
- Ringe als Default, Schatten bewusst nach Elevation-Modell.
- Sticky Top-Nav als **einziges** Nav-Modell (Mobile & Desktop).
- Jede Ansicht mit Lade-/Leer-/Fehler-Zustand denken.
- Farbe immer mit Text/Icon doppeln (Barrierefreiheit).
- Produkt-UI konsequent auf **Englisch**.

**Don't**
- Keine hart kodierten Hex-Werte in Komponenten (`#7c9a6a`/`#c2683f` etc.).
- Keine zweite Palette für Marketing/Landing.
- Vollton-Akzentfarbe nicht für Standard-Buttons (nur soft-Variante).
- Funktionsfarben nicht als Deko missbrauchen.
- Schatten nicht als Standard-Trennung von Flächen.
- Keine Bottom-Nav/FAB (außer bewusster PWA-Ausnahme, §6).
- Keine externen Fonts/Icon-Libraries einführen.
- Status nie nur über Farbe kommunizieren.
- Markennamen „Nährbert" nicht übersetzen.

---

## 17. Offen / Nächste Schritte

- **Dark Mode** als eigenes Token-Set nachziehen (v2 hält die Struktur bereit).
- Signal-Töne vor Umsetzung einmal mit echtem Kontrast-Check (AA) gegen die
  finalen soft-Flächen prüfen.

---

## Anhang · Changelog v1 → v2

- **Neu:** Funktions-/Signalebene (§2.2) – clay/amber/sage-ok, abgedunkelt für AA (freigegeben).
- **Neu:** Elevation & Schatten (§3) – Schatten ist Token, nicht mehr verboten.
- **Neu:** Motion (§11), Zustände Laden/Leer/Fehler (§12), Barrierefreiheit (§13),
  Voice & Tone (§14).
- **Entschieden:** Navigationsmodell (§6) – **Sticky Top-Nav** auf allen Breakpoints,
  Bottom-Nav nur als PWA-Ausnahme.
- **Geändert:** Icons (§5) – SVG für Struktur/Nav, Emoji für Inhalt, Web-Rendering-Begründung.
- **Geändert:** Layout → „Layout & Navigation" (§6) – Web-App, Touch-Ziele.
- **Geändert:** Buttons (§8) – neue Akzent-soft-Variante; Vollton-Akzent weiter tabu.
- **Geändert:** Karten (§7) & Farben (§2.1) – `accent-ink`-Token, Signal-Box, Elevation-Sprache.
- **Ergänzt:** Typografie (§4) – Zahlen/`tabular-nums`, Locale-Zahlenformat (en-Default).
- **Sprache:** Doc bleibt Deutsch; **Produkt-/UI-Copy Englisch** (Beispiele durchgängig angepasst).
