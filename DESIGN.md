---
name: CIRCUIT
description: A bright industrial authorization system for public proof and portfolio operations.
colors:
  chalk-white: "#f7f7f5"
  hero-stage: "#f2f2f0"
  sequence-field: "#ecece8"
  charcoal: "#111211"
  body-charcoal: "#353734"
  muted-charcoal: "#62645f"
  hairline: "#d9dad5"
  signal-amber-red: "#ee4a24"
  signal-amber-red-dark: "#bd3015"
  allow-green: "#2f6f4f"
  decision-surface: "#191a18"
  decision-rule: "#555751"
  decision-row-rule: "#3b3d39"
  decision-muted: "#8f918b"
  decision-copy: "#bfc0bb"
  block-bright: "#ff633f"
  allow-bright: "#72b58e"
  signal-hover: "#ff785a"
  gate-idle: "#c8c9c4"
  sequence-rule: "#cacbc5"
  pure-white: "#ffffff"
  app-paper: "#f0f0ec"
  app-ink-secondary: "#30322f"
  app-line: "#d2d3cd"
  app-line-dark: "#a8aaa2"
  app-signal: "#d63c1d"
  app-signal-deep: "#a92b14"
  warning-brown: "#8f4a17"
  rail-muted: "#9fa19a"
  rail-signal: "#ff5a37"
  accessible-meta: "#66675f"
  accessible-index: "#70726b"
  accessible-stage: "#85887f"
  alert-paper: "#fff0ec"
  violation-line: "#e2a695"
  control-well: "#dfe0da"
typography:
  display:
    fontFamily: "Archivo, Arial Narrow, sans-serif"
    fontSize: "clamp(48px, 6.6vw, 108px)"
    fontWeight: 700
    lineHeight: 0.91
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Archivo, Arial Narrow, sans-serif"
    fontSize: "clamp(44px, 5.5vw, 84px)"
    fontWeight: 650
    lineHeight: 1
    letterSpacing: "-0.04em"
  title:
    fontFamily: "Archivo, Arial Narrow, sans-serif"
    fontSize: "clamp(20px, 2vw, 30px)"
    fontWeight: 650
    lineHeight: 1
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Helvetica Neue, Inter, ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Helvetica Neue, Inter, ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "10px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.1em"
  micro-label:
    fontFamily: "Helvetica Neue, Inter, ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "9px"
    fontWeight: 750
    lineHeight: 1
    letterSpacing: "0.1em"
  navigation-label:
    fontFamily: "Helvetica Neue, Inter, ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "10px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.09em"
  rail-label:
    fontFamily: "Helvetica Neue, Inter, ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "11px"
    fontWeight: 800
    lineHeight: 1.45
    letterSpacing: "0.08em"
  record:
    fontFamily: "Helvetica Neue, Inter, ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.45
  supporting:
    fontFamily: "Helvetica Neue, Inter, ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.5
  compact-title:
    fontFamily: "Archivo, Arial Narrow, sans-serif"
    fontSize: "14px"
    fontWeight: 650
    lineHeight: 1.15
  app-body:
    fontFamily: "Helvetica Neue, Inter, ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "15px"
    fontWeight: 500
    lineHeight: 1.55
  code:
    fontFamily: "ui-monospace, SF Mono, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "10px"
    fontWeight: 400
    lineHeight: 1.45
rounded:
  square: "0px"
  control: "2px"
  pill: "999px"
  dot: "50%"
spacing:
  micro: "4px"
  compact: "8px"
  control-gap: "12px"
  content-gap: "20px"
  control-x: "24px"
  navigation-gutter: "clamp(20px, 3.2vw, 56px)"
  page-gutter: "clamp(20px, 6vw, 110px)"
  section-y: "clamp(90px, 10vw, 150px)"
  app-gutter: "clamp(20px, 4vw, 64px)"
  app-section-gap: "clamp(26px, 4vw, 70px)"
components:
  button-primary:
    backgroundColor: "{colors.signal-amber-red}"
    textColor: "{colors.pure-white}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 24px"
    height: "50px"
  button-primary-hover:
    backgroundColor: "{colors.signal-amber-red-dark}"
    textColor: "{colors.pure-white}"
  button-secondary:
    backgroundColor: "rgba(247,247,245,.64)"
    textColor: "{colors.charcoal}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 24px"
    height: "50px"
  button-secondary-hover:
    backgroundColor: "{colors.charcoal}"
    textColor: "{colors.pure-white}"
  button-light:
    backgroundColor: "{colors.pure-white}"
    textColor: "{colors.charcoal}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 24px"
    height: "50px"
  proof-badge:
    backgroundColor: "rgba(247,247,245,.75)"
    textColor: "{colors.charcoal}"
    rounded: "{rounded.square}"
    padding: "12px 14px"
    width: "260px"
  fixture-chip:
    backgroundColor: "transparent"
    textColor: "{colors.decision-copy}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "7px 10px"
  app-button-primary:
    backgroundColor: "{colors.app-signal}"
    textColor: "{colors.pure-white}"
    typography: "{typography.navigation-label}"
    rounded: "{rounded.control}"
    padding: "0 20px"
    height: "46px"
  app-button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.charcoal}"
    typography: "{typography.navigation-label}"
    rounded: "{rounded.control}"
    padding: "0 20px"
    height: "46px"
  status-chip:
    backgroundColor: "{colors.chalk-white}"
    textColor: "{colors.charcoal}"
    typography: "{typography.micro-label}"
    rounded: "{rounded.pill}"
    padding: "0 12px"
    height: "32px"
  evidence-row:
    backgroundColor: "{colors.chalk-white}"
    textColor: "{colors.charcoal}"
    typography: "{typography.record}"
    rounded: "{rounded.square}"
    padding: "15px 18px"
    height: "54px"
---

# Design System: CIRCUIT

## Overview

**Creative North Star: "The Physical Authorization Boundary"**

The CIRCUIT site turns an abstract mandate check into a physical authorization boundary. The landing page expresses this world through bright industrial product photography, large charcoal type, and amber-red proof signals. The operating pages continue the same world as a control-led shell built from chalk canvas, a black sticky rail, ruled evidence records, and explicit state bands.

The system favors inspectable structure over dashboard decoration. Archivo carries product identity and decisive values. The system sans stack carries navigation, controls, evidence, and dense operating text. Every page keeps live, synthetic, BLOCK, ALLOW, and failure states visually distinct.

**Key Characteristics:**

- Full-width product photography on the landing and a control-led operating shell inside.
- Self-hosted Archivo display type paired with a restrained system sans UI face.
- Chalk canvas, black rails, sparse orange-red signal, and green only for ALLOW or proven state.
- Thin technical rules, squared controls, zero resting card shadows, and compact evidence labels.
- Table-like records expose portfolio state, clauses, decisions, reports, audits, and receipts.

## Colors

The palette stays bright and controlled. Chalk and warm-gray surfaces carry the page. Charcoal supplies structure. Orange-red marks primary action, BLOCK state, focus, and proof emphasis. Green appears only for ALLOW or proven state.

### Primary

- **Signal Amber-Red:** Use for the main action, active gate state, refusal emphasis, focus outlines, and the proof band.
- **Deep Signal Amber-Red:** Use for primary-button hover, step numerals, logo detail, and the large proof-band surface.
- **Operating Signal:** Use for app actions, active stage rules, exposure warnings, and focus outlines.
- **Operating Signal Deep:** Use for app BLOCK states, failed evidence, and primary-action hover.
- **Rail Signal:** Use for the black navigation rail's logo mark and active route underline.

### Secondary

- **Allow Green:** Reserve for the live dot and accepted gate phase.
- **Bright Allow Green:** Use only for ALLOW values on the charcoal decision surface.
- **Warning Brown:** Reserve for warning state distinct from BLOCK.

### Neutral

- **Chalk White:** Main landing background and photographic wash.
- **Hero Stage:** Neutral base behind the hero image.
- **Sequence Field:** Warm gray field behind the six-step authorization path.
- **Charcoal:** Primary text, borders, and secondary-button hover fill.
- **Body Charcoal:** Long-form copy over light surfaces.
- **Muted Charcoal:** Supporting copy and labels over light surfaces.
- **Hairline:** Dividers between providers, sections, and structural cells.
- **Decision Surface:** Charcoal field behind the allocation comparison.
- **Decision Copy and Muted:** Supporting type over the decision surface.
- **App Paper and App Lines:** Build operating records, fields, report sheets, and evidence dividers over the warm-gray canvas.
- **Rail Muted:** Supports inactive navigation and secondary copy on black surfaces.
- **Accessible Meta:** The darker neutral (`#66675f`) used for report metadata and clause caps on chalk surfaces.
- **Accessible Index:** The darker neutral (`#70726b`) used for mandate clause numerals.
- **Accessible Stage:** The lighter neutral (`#85887f`) used for inactive agent stages on the black rail.
- **Alert Paper and Violation Line:** Form the warm refusal field without replacing the signal color.

**The Signal Rarity Rule.** Amber-red identifies action, refusal, or proof. Do not spread the signal color across neutral content.

**The State Color Rule.** Red means BLOCK or action. Green means live or ALLOW. Never swap these meanings.

## Typography

**Display Font:** Archivo, loaded from local 500, 600, 700, and 800 TrueType files, with Arial Narrow and sans-serif fallbacks.

**Body Font:** Helvetica Neue with Inter, platform sans, and system fallbacks.

**Character:** Archivo creates dense, direct headlines with compressed spacing. The body face stays plain and readable, while small uppercase labels carry technical metadata.

### Hierarchy

- **Display** (700, `clamp(48px, 6.6vw, 108px)`, 0.91): Hero statement with tight negative tracking.
- **Headline** (650, `clamp(44px, 5.5vw, 84px)`, 1): Section statements and the sequence title.
- **Title** (650, `clamp(20px, 2vw, 30px)`, 1): Authorization steps and compact display labels.
- **Body** (400, 16px, 1.6): Explanatory copy, usually limited to 410 to 570px.
- **Label** (800, 10px, 0.1em, uppercase): Navigation, controls, provider state, and evidence metadata.
- **Micro Label** (750, 9px, 1): Status chips, stage labels, table heads, report IDs, and control tabs.
- **Navigation Label** (700, 10px, 1): Sticky navigation, wallet state, row labels, and action text.
- **Rail Label** (800, 11px, 1.45): Sticky section labels and primary rail captions.
- **Record** (500, 12px, 1.45): Evidence rows, key-value records, clause copy, and notices.
- **Supporting** (500, 13px, 1.5): Activity descriptions, empty states, and compact mobile page copy.
- **Compact Title** (650, 14px, 1.15): Small report titles at narrow widths.
- **App Body** (500, 15px, 1.55): Operating page introductions and the agent objective.
- **Code** (400, 10px, 1.45): Hashes, addresses, and machine identifiers.

**The Two-Face Rule.** Use Archivo for display hierarchy. Use the system sans stack for copy, navigation, controls, and evidence labels.

## Layout

The landing page uses full-width horizontal bands with a fluid page gutter of `clamp(20px, 6vw, 110px)`. The hero fills up to the viewport height and places copy in the left 48 percent, protected by a left-to-right chalk-white image wash. The provider rail uses five equal columns. The statement and decision bands use asymmetric two-column grids. The authorization path uses six equal cells.

Operating pages sit inside a 1440px maximum container with gutters of `clamp(20px, 4vw, 64px)` and 120px bottom space. The sticky black rail spans the viewport. Page heads use a two-pixel charcoal rule. Content sections use a `minmax(170px, 220px)` label rail beside one flexible evidence column, separated by a fluid 26px to 70px gap. Four-column stat bands, report indexes, clause grids, stage rails, audit grids, and ledger rows behave as ruled records rather than cards.

At 1100px, the landing's six-step path becomes three columns and each scenario row becomes a two-column grid. At 980px, operating navigation wraps into a horizontally scrolling second row, section label rails become horizontal headers, market grids stack, and report records reduce their columns. At 760px, major landing splits stack and operating records move to compact two-column forms. At 430px, buttons, providers, stats, key-value records, audit rows, and report indexes stack into single columns.

Section spacing stays generous, from 70px to 180px according to the band's role. Structural density lives inside provider cells, scenario rows, navigation labels, and proof metadata.

**The Band Rhythm Rule.** Alternate photography, chalk-white space, charcoal decision space, warm gray process space, and the amber-red proof band. Keep each band visually complete.

## Elevation & Depth

The system stays flat. Thin rules, tonal fields, black control bands, image washes, and blur establish depth. The hero proof badge uses a translucent chalk-white fill, a 14px backdrop blur, and a faint one-pixel border. Wallet menus use ambient shadows, with `0 18px 50px rgba(17,18,17,.13)` on the landing and `0 20px 60px rgba(17,18,17,.24)` in the app. The live dot uses a four-pixel green status ring. Resting cards, records, stat bands, clauses, and audit rows receive no shadow.

**The Minimal Lift Rule.** Reserve visible elevation for wallet menus and live-status treatment. Content bands, records, scenario rows, clauses, steps, and provider cells stay flat.

## Shapes

The form language is squared and technical. Buttons and segmented control wells use a two-pixel radius. Proof badges, records, stat bands, reports, clauses, audit rows, and scenario rows use square corners. Hairline borders separate adjoining cells. Status and fixture labels use a full pill because they express metadata, and live indicators use circles. Avoid rounded cards across content sections.

**The Squared Control Rule.** Interactive controls use a two-pixel radius. Structural containers use square corners.

## Components

### Buttons

Buttons feel compact, firm, and technical.

- **Shape:** Two-pixel radius, one-pixel border, 50px minimum height, and 24px horizontal inset.
- **Primary:** Amber-red fill, matching border, white uppercase label.
- **Primary Hover:** Deep amber-red fill and border, with a two-pixel upward shift.
- **Secondary:** Translucent chalk-white fill, charcoal border and label, plus a 10px backdrop blur over hero photography.
- **Secondary Hover:** Charcoal fill and white label, with the same two-pixel upward shift.
- **Light:** White fill over the proof band. Hover removes the fill and keeps a white border and label.
- **Focus:** Three-pixel amber-red outline with a four-pixel offset.

### Chips

- **Style:** The Synthetic fixture label uses a transparent fill, one-pixel decision rule, full pill radius, compact padding, and uppercase muted copy.
- **State:** The fixture chip labels evidence provenance. It is not an action.

### Cards / Containers

- **Corner Style:** Square.
- **Background:** Use tonal bands instead of detached cards.
- **Shadow Strategy:** Keep content containers flat.
- **Border:** One-pixel hairlines or contextual dark rules.
- **Internal Padding:** Provider cells use 18px vertically and a fluid 12px to 30px horizontal inset. Scenario rows use 34px vertically.

### Navigation

Every route uses one 68px sticky black rail with an Archivo wordmark, muted route labels, white hover and active text, and a three-pixel orange active underline. The landing page uses the same rail without a light or transparent variant. At 980px the routes move to a 44px horizontally scrolling second row.

### Hero Proof Badge

The proof badge sits at the hero's upper right on desktop and spans the lower hero inset on mobile. It pairs a state-colored live dot, X Layer Testnet label, current proof-state summary, three manual state controls, a play or pause control, and a three-segment gate signal. Its translucent fill preserves the product photograph beneath.

### Console State Slideshow

The landing console cycles through three complete photographic frames in the order BLOCKED, ALLOW, and STALE. Each frame holds for 3.2 seconds. BLOCKED uses amber-red LEDs, ALLOW uses green LEDs, and STALE uses neutral gray LEDs. Swap one full frame at a time without crossfading, so dot-matrix letters stay crisp and never ghost. Preload the ALLOW and STALE frames before automatic playback. Manual state controls switch immediately. The slideshow pauses while its control group has pointer or keyboard focus, and the dedicated control pauses until the visitor selects PLAY. Reduced-motion mode keeps the initial BLOCKED frame static while preserving manual state selection.

### Provider Rail

The provider rail sits directly under the hero. Five equal cells expose AI, OKX, X Layer, Vault, and MCP status. Labels stay uppercase, muted, and left aligned. Current status stays darker and right aligned. Compact layouts move the cells from five columns to two, then one.

### Scenario Rows

BLOCK and ALLOW rows share the same four-column structure, spacing, and rules. Only the projected exposure and verdict color change. BLOCK uses bright signal red. ALLOW uses bright green. Keep the shared asset and mandate values visible so the amount-to-decision relationship stays inspectable.

### Three-Segment Gate Signal

Three narrow bars animate over 4.8 seconds with `cubic-bezier(.2,.8,.2,1)`. The bars stagger by 180ms. Each bar starts short and gray, rises green, then settles amber-red. Reduced-motion mode stops the sequence and presents all bars as static amber-red.

### Stat Bands

Four equal black cells present portfolio measures as one operating band. Archivo values use `clamp(30px, 3.3vw, 48px)`. Nine-pixel labels use the rail-muted color. Thin dark rules separate cells. The band becomes two columns at 760px and one column at 430px.

### Section Label Rail

Each operating section pairs a sticky 170px to 220px label rail with one flexible evidence column. The primary label uses an 11px uppercase system sans. Secondary context uses nine-pixel muted copy. At 980px the rail becomes a static horizontal header above the evidence.

### Evidence Records

Portfolio rows, key-value tables, activity entries, mandate compliance, and proof audits use chalk paper, one-pixel rules, tabular numerals, and 9px to 13px system sans text. Report evidence uses a 180px to 240px uppercase label column beside one flexible value column. Rows use no card radius or shadow. Hover changes only the paper tone. Long hashes and addresses wrap without forcing horizontal overflow. At 430px, report evidence stacks the label above the value.

### Report Records

The report index uses five aligned fields for record ID, title, state, metadata, and route. Hover inverts the full row to black and white while retaining orange state emphasis. Report bodies use chalk paper, a two-pixel charcoal top rule, a ruled header, a warm-gray metadata strip, and inset evidence rows.

### Mandate Clauses

Clauses use a three-column record with an Archivo index, clause description, and enforced value. The accessible index neutral keeps large numerals readable on chalk. At 760px, the value moves below the description while retaining the numbered rail.

### Agent Stage Rail

Nine stages share a black horizontal rail. Inactive stages use the accessible stage neutral. The active stage turns white with a four-pixel orange inset rule. Completed stages use white labels and green numerals. The rail scrolls horizontally at compact widths.

### Proof Audit

Audit rows use three columns for check, result, and evidence. The first proof table uses a black field with white labels and rail-muted supporting copy. At 760px the evidence moves below the first two fields, then all fields stack at 430px.

### Gate BLOCK / ALLOW Bands

Agent verdicts use black bands with a six-pixel left state rule, bright red BLOCK type, or bright green ALLOW type. The mandate gate uses full-width deep red BLOCK and green ALLOW headers above the corresponding evidence rows. Shared spacing and type keep state meaning stable across both surfaces.

## Do's and Don'ts

### Do:

- **Do** carry the same chalk, charcoal, orange signal, green proof, and Archivo identity across landing and operating pages.
- **Do** use original product imagery as the hero's full-width operating surface.
- **Do** label synthetic fixtures and testnet proof in visible interface copy.
- **Do** preserve exact BLOCK and ALLOW color semantics across scenario rows and gate motion.
- **Do** structure operating evidence as ruled records with tabular numerals and compact labels.
- **Do** retain the landing 1100px breakpoint and operating 980px, 760px, and 430px transitions.

### Don't:

- **Don't** add rounded cards, gradient decoration, or broad shadow stacks.
- **Don't** treat the provider rail as customer-logo proof.
- **Don't** invent custody, production, customer, or performance claims.
- **Don't** use green for neutral progress, decoration, or non-proven state.
- **Don't** replace the sticky black operating rail with generic light dashboard navigation.
- **Don't** remove the reduced-motion fallback or visible focus outline.
