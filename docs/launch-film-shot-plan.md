# Citerate — launch film shot plan

**Status:** ready to generate. Higgsfield MCP not yet attached; no credits spent.
**Format:** 24 seconds, 16:9 master, silent-first (autoplays muted on the homepage).
**Use:** homepage hero loop, launch post on LinkedIn/X, top of the demo.

---

## Before generating

```
claude mcp add --transport http higgsfield https://mcp.higgsfield.ai/mcp
```

Authenticate with the Higgsfield account — existing subscription credits carry over, no API
key. Restart Claude Code so the tools load.

**Generate shot 3 first, alone, and approve it before the rest.** It is the hardest shot and
the one the film fails on if it lands wrong. Everything else is cheap by comparison.

---

## The idea

The film argues the product's own thesis in the order a customer actually experiences it:
the number that looked fine, the traffic that didn't, the answer that replaced the click,
and the name that wasn't yours. No product UI until the last four seconds — the UI is the
resolution, not the pitch.

**Tone:** an instrument, not an ad. Cold, precise, unhurried. Closer to a Bloomberg terminal
or a seismograph than to SaaS marketing. Nothing bounces, nothing glows, nothing swooshes.

**Restraint that matters:** no faces, no offices, no laptops on desks, no stock-founder
gestures. The film is about a measurement, so the film should look like measurement.

---

## Palette and type (locked to `citerate/src/styles/01-settings/_tokens.scss`)

| Role | Hex | Where |
|---|---|---|
| Ground | `#F4F5F7` | every shot background |
| Ink | `#141B26` | type, the flat rank line |
| Cited (accent) | `#0E7C66` | resolution only, shots 6–7 |
| Gap | `#C43D3D` | the falling traffic line, shot 2 |
| Warn | `#D98324` | cause split only |
| Tech | `#3E5C8A` | cause split only |
| Hairline | `#E2E5EA` | grids, rules |

Type: Source Serif 4 for statements, JetBrains Mono for all numerals and labels. Numerals
are always monospace and tabular — this is the single most important visual rule in the film.

---

## Shot list

### 1 — The flat line · 4s · Kling 3.0
**Prompt:** Extreme close-up of a thin near-black horizontal line on a pale warm-grey field,
drawn like a scientific chart trace. The line holds perfectly flat and steady, travelling
left to right. Faint hairline grid behind it. Shallow depth, very slow lateral camera drift.
Clinical, still, restrained. No text, no UI, no glow, no color other than near-black on pale
grey.

**On screen:** `Your rank held.` — Source Serif 4, lower third, fades in at 2s.

**Note:** Kling for its steadiness on slow linear motion. Any camera shake kills this shot.

---

### 2 — The divergence · 5s · Veo 3.1
**Prompt:** The same pale warm-grey chart field. The steady near-black horizontal line
continues flat. A second line in deep desaturated red enters and descends steadily away from
it, opening a widening gap between the two. Slow, inevitable, unhurried motion. Thin hairline
grid. No labels, no UI, no glow, no dramatic zoom. Cold scientific chart aesthetic.

**On screen:** `Your traffic didn't.` — enters as the red line crosses the midpoint.

**Note:** Veo for controlled multi-element motion. The gap opening *is* the shot — the red
line should never accelerate or spike.

---

### 3 — The answer above the link · 6s · Sora 2 · **generate and approve first**
**Prompt:** A pale warm-grey page. A block of soft grey placeholder text expands downward
from the top of the frame, pushing a single small near-black link row toward the bottom edge
until it is nearly out of view. The expanding block is abstract — suggested paragraph shapes,
not readable words. Slow, steady, mechanical displacement. Cold clinical lighting, no glow,
no motion blur, no UI chrome, no logos.

**On screen:** `An answer appeared above it.` — enters at 3s as the link nears the edge.

**Note:** This is the film's thesis in one image and the hardest thing to get from a text
prompt. Expect 2–3 attempts. Failure modes: the block reading as literal text, the link
sliding rather than being *pushed*, or the whole thing feeling like a UI animation.
If Sora fights it, storyboard it as a 2D motion graphic instead — this shot is worth
hand-building.

---

### 4 — The citation · 3s · Kling 3.0
**Prompt:** Extreme macro on a pale warm-grey surface. A single small superscript citation
marker sits in isolation. It resolves into a short domain-name shape rendered in monospace
characters — abstract, not legible as a real brand. Very shallow depth of field, slow push
in. Cold, precise, still. No glow, no color accent, no UI.

**On screen:** `It cited someone else.`

---

### 5 — The cause split · 3s · Kling 3.0
**Prompt:** A single horizontal bar on a pale warm-grey field divides cleanly into four
labelled segments: deep red, amber, slate blue, and a grey segment filled with fine diagonal
stripes. The segments separate with a crisp mechanical motion, left to right. Thin hairline
rules. Flat, diagrammatic, no depth, no gradient, no glow.

**On screen:** `Four causes. One of them is "we don't know".`

**Note:** The striped grey segment is non-negotiable — it is the honesty claim, rendered.
Keep it visibly present, roughly a fifth of the bar.

---

### 6 — Resolution · 2s · Veo 3.1
**Prompt:** Pale warm-grey field. A deep teal horizontal confidence band draws in cleanly
from left to right, with a thin near-black tick mark settling at its centre. Precise,
mechanical, final. No bounce, no easing overshoot, no glow.

**On screen:** `Now you know which one.`

---

### 7 — Endcard · 1s · static
Wordmark on `#F4F5F7`, single teal hairline rule beneath.

`citerate.com` — monospace
`Free scan. No account. 90 seconds.` — sans, `--ink-soft`

---

## Caption track (silent playback)

Burned in, Source Serif 4, lower third, no animation beyond a 200ms fade:

1. Your rank held.
2. Your traffic didn't.
3. An answer appeared above it.
4. It cited someone else.
5. Four causes. One of them is "we don't know".
6. Now you know which one.

Six lines, 24 seconds. Reads without sound, which is how it will actually be watched.

## Optional voiceover

Only if it stays under-delivered — flat, unhurried, no rise at the end of lines. The copy is
already the argument; performance would cheapen it. **Recommendation: ship silent.** The
product's whole brand is refusing to oversell, and a voiceover is the first place that slips.

---

## Cutdowns from the same masters

- **6s** — shots 1, 2, 7. The whole argument is the divergence.
- **10s** — shots 1, 2, 3, 7. Adds the displacement mechanic.
- **Stills** — frame grabs from shots 3 and 5 are the strongest static assets in the set and
  should feed back into the Canva graphics.

---

## One caveat

Shot 5 shows a four-way cause split. `technical_decay` currently cannot fire in production
(`techPass` is hardcoded `true` in `workers/scanner/index.ts`), so the slate-blue segment
depicts something the product does not yet detect. Either fix the check before this film
goes public, or cut shot 5 to three segments. Shipping a film that shows a fourth cause the
product cannot produce is the one thing in this plan that would undercut the honesty
positioning it is built on.
