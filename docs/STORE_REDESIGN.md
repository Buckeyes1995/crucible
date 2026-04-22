# Crucible — Store Redesign (Mock)

**Status:** design draft, no code yet.
**Inspiration:** Apple App Store (iOS 16+), PlayStation Store, GOG, Spotify Home.
**Goal:** make `/store` *fun to browse* — a place you open because you're curious, not only when you need something specific.

## What's wrong with the current store

Today's store is a competent **app picker**: tabs across the top (Featured / Models / Prompts / Workflows / System Prompts / MCPs / Installed) + a grid of plain cards with a title, short description, and Install button. Functional but flat. Problems:

1. **Every item looks the same** — Qwen3-35B reads visually identical to a two-line system prompt. A 63 GB coder model should *feel different* from "You are a helpful assistant."
2. **No sense of "what's new" or "what matters"** — Featured tab exists, but it's another grid, no hierarchy.
3. **No personalization** — we already know the user's hardware (96 GB), their favorite models, what they've benchmarked, what they've arena'd. None of it feeds the store.
4. **No motion, no hero moments** — every pixel is the same flat zinc card.

## North star

Opening `/store` should feel like opening Apple Music's Home tab:

1. Big **hero slot** at the top with rotating featured content (models, prompts, MCPs) — full-bleed background, big type, one-click install.
2. Below it, a **vertical stack of horizontal rails** — each rail is a theme, each card in a rail is swipeable on trackpad / scrollable by arrow buttons.
3. Rails feel alive: personalized ("Because you use Qwen"), contextual ("Fits your 96 GB"), curated ("z-lab this week"), and trending ("Most benchmarked").
4. Clicking a card opens a **rich detail view** — hero image, spec chips, benchmark sparkline if we've run it, sample outputs, and a big Install button that *animates* into a progress bar.

## Visual structure

```
┌────────────────────────────────────────────────────────────────┐
│  HERO CAROUSEL  (auto-rotating, 3–5 slots, dot pager)          │
│  full-bleed 240px tall, gradient art, model name big type,     │
│  "Install" or "Open" CTA                                        │
└────────────────────────────────────────────────────────────────┘

Category tabs (sticky):  [ All ] [ Models ] [ Prompts ] [ Workflows ] [ MCPs ] [ Installed ]

┌── Featured this week ────────────────────────────── see all → ┐
│  [card]  [card]  [card]  [card]  [card]  [card]  [card]       │  ← horizontal scroll
└──────────────────────────────────────────────────────────────┘

┌── New from z-lab ────────────────────────────────── see all → ┐
│  [card]  [card]  [card]  [card]  [card]                       │
└──────────────────────────────────────────────────────────────┘

┌── Fits your 96 GB ───────────────────────────────── see all → ┐
│  [card]  [card]  [card]  [card]  [card]  [card]               │
└──────────────────────────────────────────────────────────────┘

┌── Because you benchmarked Qwen3.6-35B ───────────── see all → ┐
│  [card]  [card]  [card]                                       │
└──────────────────────────────────────────────────────────────┘

┌── Top 10 by tokens served (last 30 days) ────────── see all → ┐
│   1 [card]   2 [card]   3 [card]   4 [card] …                 │
└──────────────────────────────────────────────────────────────┘

┌── Staff picks ──────────────────────────────────── see all → ┐
│  [wide card with editorial copy]   [wide card]   [wide card]  │
└──────────────────────────────────────────────────────────────┘

┌── Under 10 GB · Perfect for mobile ─────────────── see all → ┐
│  [card]  [card]  [card]  [card]                               │
└──────────────────────────────────────────────────────────────┘
```

### Card anatomy

A card is a 180 × 220 tile (variants for wide/editorial). Inside:

```
┌──────────────────┐
│ [BADGE]  [BADGE] │   ← top-left: NEW / UPDATED · top-right: size
│                  │
│   auto-gen art   │   ← 160×90 thumbnail area
│   (gradient +    │
│    glyph)        │
│                  │
├──────────────────┤
│  Model Name      │   ← 14px semibold
│  tagline / desc  │   ← 11px muted, one line
│  ○ install ◯◯    │   ← tiny install button (icon only) + chips
└──────────────────┘
```

Cards **lift** on hover (translate-y-[-4px], soft shadow), the art subtly animates (gradient shifts), and the install button reveals a hint label.

### Hero slot

Full-bleed, 240 px tall. Background = the item's generated art scaled up with a vignette + gradient. Left side: Eyebrow ("FEATURED · MODEL"), big model name (36px semibold tracking-tight), one-paragraph pitch, CTA button group (Install / Learn more). Right side: metric chips (size · context · quant · tok/s baseline if known). Auto-rotate every ~8 s with a progress dot pager at the bottom-right.

### Detail page

Clicking a card animates it into a modal/sheet (Framer Motion layout animation). Content:

- Big hero art again (same art as the card, scaled)
- Breadcrumb: Store / Models / Qwen3.6-35B
- Title + subtitle + author (z-lab, mlx-community, etc.)
- **Install progress bar** — button morphs into a progress bar on click, 40% / 80% / Installed state, all inline on the same button
- Metric chips (size, context, quant, # of tokens seen, tokens served last 30 d, last-benchmarked tok/s)
- Mini bench sparkline (if we've benchmarked it)
- "Sample output" panel — run a canned prompt against the model after install, cache the output on disk so others see it too
- Related section: "You might also like" (same family, same size tier, same capability tag)
- "Installed where" widget for MCPs (which projects have it enabled)

## Rail content (data model)

Rails are just named lists of items. Item = `{kind, id}`. Rails are assembled by the backend so personalization logic stays in one place.

| Rail                                | Source                                                                                 |
|-------------------------------------|----------------------------------------------------------------------------------------|
| Featured this week                  | hand-curated in `~/.config/crucible/store_curated.json` (checked into repo default)   |
| New from z-lab                      | `zlab.py` cached list, filter to last 14 days                                          |
| Fits your ⟨N⟩ GB                    | model size_bytes ≤ RAM × 0.75                                                          |
| Because you benchmarked ⟨model⟩     | same family + similar size to the model with most benchmark runs                       |
| Top 10 by tokens served (30d)       | `model-usage-stats` endpoint sorted by `tokens_24h` × 30 rollup                        |
| Staff picks                         | hand-curated editorial                                                                 |
| Under 10 GB                         | size filter                                                                            |
| Capabilities: vision / coding / …   | capability tag filter                                                                  |
| Recently updated (HF)               | `hf_updates.py` — upstream lastModified > local downloaded_at                          |
| Most arena wins                     | `arena_battles` WHERE winner=? GROUP BY model                                          |
| New prompts / system prompts / MCPs | per-kind `created_at` sort                                                             |

Backend exposes `GET /api/store/rails` returning an ordered list of `{title, subtitle, items[]}`. Frontend renders whatever it gets — no hard-coded rail set.

## Auto-generated art

Every item needs a thumbnail. Rather than depending on HF having banner images, generate a distinctive SVG/gradient per item:

1. **Palette from hash** — sha256 the item id, take 3 bytes → hue anchor. Use a curated LAB-space palette so similar ids get similar-but-distinguishable colors.
2. **Glyph from kind** — model = stylized chip/die; prompt = quill; workflow = graph; MCP = plug; system prompt = shield.
3. **Secondary pattern from size tier** — small (<5 GB) = tight hex lattice; medium (5–30) = wider bokeh; large (>30) = long diagonal gradient.
4. **Accent text** — the quant tag (4bit/6bit/8bit) or capability pill overlaid bottom-right in mono.

Stored as inline SVG in the card's React output, so we pay ~2 KB per card and zero network. Curated hero slots can override with a hand-designed key-art asset under `frontend/public/store-art/<item-id>.{png,webp,avif}`.

## Motion + polish

Low-cost wins, all via Tailwind utilities + a couple of CSS keyframes — no Framer Motion unless we already pull it in.

- Card hover: `translate-y-[-4px] shadow-2xl shadow-black/40` with `transition duration-200 ease-out`.
- Rail arrow buttons fade in on rail hover (scroll-snap native on the rail itself).
- Hero slot cross-fade every 8 s; user-hover pauses the timer.
- Install button: three discrete states (idle → progress → installed). A CSS `width` transition on an inner `::after` progress fill gives the "install bar" animation.
- Reduced-motion respected (`prefers-reduced-motion: reduce` kills hero rotation + hover lifts).

## Phasing

Landing this in one drop would be a week of work. Suggested order:

### Phase 1 — foundation (1 session)
- `GET /api/store/rails` endpoint returning current tabs re-shaped as rails (no new data)
- New `StoreShelf` horizontal-scroll component with arrow buttons
- Replace current `/store` grid with stacked shelves; identical content, new layout

### Phase 2 — art + hero (1 session)
- Auto-gen SVG thumbnail component
- Hero carousel above the shelves
- Install button state machine (idle / progress / installed)

### Phase 3 — personalization (1 session)
- "Fits your N GB", "Because you benchmarked X", "Top 10 by tokens served"
- "Recently updated" rail fed by `hf_updates.py`
- Persist dismissed hero slots in localStorage

### Phase 4 — detail page (1 session)
- Modal/sheet detail view with layout-animated card → hero transition
- Sample-output caching (run + store on install)
- "You might also like" rail on detail page

### Phase 5 — editorial (ongoing, not code)
- Curated `store_curated.json` with weekly Featured slots
- Hand-designed key-art for the top 3–6 models at any given time (stored in `frontend/public/store-art/`)

## Open questions

1. **Editorial workflow.** Curated content goes stale fast. Either (a) hand-edit JSON and commit (works for one person), (b) add an admin UI to set Featured (more code but sustainable), or (c) hack around auto-curation rules forever. Pick now.
2. **Arena-derived rails — fair or biased?** "Most arena wins" encourages running more arena battles but also anchors on older, heavily-voted models. Do we time-decay?
3. **Detail page: full-route vs. modal?** Modal feels slicker (origin card → hero animation) but back-button is weird. Full route is cleaner but loses the "stay in flow" vibe.
4. **MCP installs with config** still need a dialog mid-install. Does the install-button-morph metaphor break when we pause for user input? Probably — need a separate "configure" state before the progress fill.
5. **Should the store also surface *uninstall*?** Today the Installed tab is where you manage what's on your system. If every card on a shelf shows "Installed ✓" without an easy remove path, it's half-baked. Keep Installed as a destination or merge into detail pages?
6. **Offline / no-network state.** z-lab rail and HF-update rail depend on upstream HTTP. On a flight we should degrade gracefully with a cached snapshot + a "last refreshed" line.

## Not in scope (deliberately)

- Ratings / reviews — we don't have a user base, so this would just show 0 stars forever.
- Paid content / store credit — Crucible is personal. No.
- Cross-device sync — one-user, one-machine for now.

## Screenshots / references to steal from

- **Apple App Store iOS**: hero Today tab, "In-App Events" rail, app-detail pinch-to-zoom animation
- **PlayStation Store (PS5)**: animated key art on hover, "Because you played" personalized rail, charts with rank numbers
- **Spotify Home**: "Made for you" + "New releases" + "Jump back in" structure
- **GOG**: editorial card layouts, hand-written copy feel
- **Linear's changelog page**: for the feel of a hero slot with a featured item

## Proposed next step

If this direction feels right, I'd start with **Phase 1** — pure structural: shelves replace grid, same content, no art changes. Low risk, immediately more browseable, and it unblocks the fun stuff. Want me to proceed, or iterate on this doc first?
