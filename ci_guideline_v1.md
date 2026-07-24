# NutriWise – CI-Guideline (v1)

Corporate-Identity-Richtlinie für die App. Alle Werte beschreiben den
„Grocery Shadow"-Look: ruhige, editoriale Neutraltöne (Canvas/Ink), **ein**
Akzent (Salbeigrün), großzügige Rundungen, System-Schrift.

> Quelle der Wahrheit sind die Design-Tokens in `index.css`. Werte hier nie
> als Hex hart in Komponenten kopieren – immer die Token-Klassen benutzen
> (`bg-accent`, `text-ink`, `ring-black/5` …).

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

**Wortmarke:** immer Nährbert", CamelCase, ein Wort.

**Don'ts**
- Blatt nicht verzerren, drehen oder mit Farbverlauf füllen.
- Badge-Hintergrund nur `accent-soft` (nicht Vollton-Akzent).
- Keine Schlagschatten.


---

## 2. Farben (Tokens)

| Token | Klasse | Wert (Quelle) | ≈ Hex | Verwendung |
|---|---|---|---|---|
| `--canvas` | `bg-canvas` | `oklch(0.985 0 0)` | `#FBFBFB` | Seitenhintergrund |
| `--surface` | `bg-surface` | `oklch(1 0 0)` | `#FFFFFF` | Karten / Boxen |
| `--ink` | `text-ink` | `oklch(0.18 0.005 270)` | `#1B1B1F` | Primärtext, dunkle Buttons |
| `--ink-soft` | `text-ink-soft` | `oklch(0.45 0.005 270)` | `#6B6B71` | Sekundärtext |
| `--accent` | `bg-accent` / `text-accent` | `#7C9A6A` | `#7C9A6A` | **einziger** Akzent (Salbeigrün) |
| `--accent-soft` | `bg-accent-soft` | `#EEF2EA` | `#EEF2EA` | Akzent-Flächen, Badges |

**Grundsätze**
- **Ein Akzent.** Salbeigrün ist der einzige Markenfarbton. Keine zweite
  „Marketing-Palette" – Landing, Onboarding & App teilen dieselbe Basis.
- **Ink-Transparenzen statt neuer Grautöne.** Abstufungen über Deckkraft:
  `text-ink/40` (Labels), `/50`–`/60` (Sekundärtext), `/70` (kräftiger).
- **Ränder** immer als feiner Ring: `ring-1 ring-black/5` – nie harte 1px-Border.
- **Eingabe-Flächen:** `bg-zinc-50` (`#FAFAFA`) für Inputs/Selects.

**Signalfarben** (nicht Teil des Akzents, sparsam):
- Rot `bg-red-500` – Benachrichtigungs-Punkt / Fehler.

---

## 3. Typografie

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

---

## 4. Icons

Icon-System ist **Emoji-basiert** (keine Icon-Library). Immer in einem
`aria-hidden`-Span, da rein dekorativ. Einzige Ausnahme: die Blatt-Bildmarke
als custom SVG.

**Icon-Buttons** (Bell/Profil): `size-8 rounded-full ring-1 ring-black/5`,
inaktiv `bg-surface text-ink/55`, aktiv `bg-ink text-canvas`.

---

## 5. Abschnitte & Layout

- **Content-Spalte:** zentriert, `mx-auto max-w-3xl`. Nav & Main teilen dieselbe Breite.
- **Kopfzeile (Nav):** `flex items-center gap-3 px-6 py-6` – Logo links,
  Tab-Pills + Icon-Buttons + Sprach-Toggle rechts.
- **Abschnittslabel:** Bereiche mit `<SectionLabel>` (Eyebrow, s. Typo)
  einleiten statt mit großen Zwischenüberschriften.
- **Vertikaler Rhythmus:** Gruppen über `flex`/`grid` + `gap` bzw.
  `space-y-*` – keine gestapelten Einzel-Margins.

---

## 6. Boxen / Karten

**Standard-Karte** (`<Card>`, AppShell):
```
rounded-2xl bg-surface p-5 ring-1 ring-black/5
```

- **Rundung:** Karten & Buttons `rounded-2xl`; Inputs/Pills `rounded-xl`;
  Toggles/Badges `rounded-full`; große Flächen `rounded-3xl`.
- **Trennung** durch Ring (`ring-1 ring-black/5`) + Flächenwechsel
  (`surface` auf `canvas`), nicht durch Schatten.
- **Akzent-Box** (Hinweis/Highlight): `bg-accent-soft` mit `text-accent`.
- **Sekundär-Box** (eingebettet, ruhig): `bg-zinc-50 ring-1 ring-black/5`.

---

## 7. Buttons & Pills

**Primär-Button** (`<PrimaryButton>`):
```
w-full rounded-2xl bg-ink px-6 py-4 text-sm font-medium tracking-tight
text-canvas transition-opacity disabled:opacity-40
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

**Muster:** aktiver Zustand = `bg-ink text-canvas` (dunkler Vollton),
inaktiv = transparent/leicht mit gedämpftem Ink. Der Akzent wird für
Buttons **nicht** eingesetzt – er bleibt der Marke/Highlights vorbehalten.

---

## 8. Formulare & Eingaben

**Input/Textarea/Select** (`inputCls`, AppShell):
```
w-full rounded-xl bg-zinc-50 px-4 py-3 text-sm text-ink
ring-1 ring-black/5 outline-none focus:ring-ink/30
```

**Feld** (`<Field>`): Label (`<SectionLabel>`, Eyebrow-Stil) über dem
Control, `space-y-2`.

**Fokus:** immer sichtbar via `focus:ring-ink/30` – nie `outline-none`
ohne Ersatz-Fokus.

---

## 9. Dropdown / Select & Accordion

**Select (Dropdown):** natives `<select>` mit `inputCls` (s. o.) – keine
custom-gestylte Liste. Konsistent mit allen anderen Eingaben.

**Accordion / Ausklappen:** natives `<details>` / `<summary>`.
- **Klappbarer Abschnitt** (z. B. Pantry-Kategorien):
  ```
  <details open className="overflow-hidden rounded-2xl bg-surface ring-1 ring-black/5">
  ```
- **Inline-Disclosure** („Warum?" / Details) dezent:
  ```
  <details className="text-xs text-ink/50">
    <summary className="cursor-pointer"> … </summary>
  ```
- `<summary>` immer `cursor-pointer`; per Default sinnvoll `open` setzen,
  wenn der Inhalt primär ist.

---

## 10. Radien & Ringe – Übersicht

| Element | Rundung |
|---|---|
| Karten, Primär-Buttons, klappbare Sektionen | `rounded-2xl` |
| Inputs, Selects, PillToggle | `rounded-xl` |
| Tab-Pills, Badges, Icon-Buttons, Sprach-Toggle | `rounded-full` |
| Große Hero-Flächen | `rounded-3xl` |

Alle Ränder als `ring-1 ring-black/5`; Fokus `ring-ink/30`.

---

## 11. Do's & Don'ts (Kurzfassung)

**Do**
- Nur die Token-Klassen nutzen (`bg-accent`, `text-ink`, `bg-surface`).
- Salbeigrün als **einzigen** Akzent, sparsam.
- Abstufungen über `text-ink/NN`-Deckkraft.
- Ringe statt Borders, Flächenwechsel statt Schatten.

**Don't**
- Keine hart kodierten Hex-Werte in Komponenten (`#7c9a6a`/`#8fa97d` etc.).
- Keine zweite Palette für Marketing/Landing.
- Akzentfarbe nicht für Standard-Buttons verwenden.
- Keine externen Fonts/Icon-Libraries einführen.
