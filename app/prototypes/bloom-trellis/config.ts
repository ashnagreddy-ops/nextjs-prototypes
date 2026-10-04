// All tunables for Bloom Trellis. Lengths ending in _EM are fractions of the glyph's font size;
// _PX are css pixels at REF_FONT_PX and scale with the font; times are ms on each glyph's own
// clock (0 = its keypress). Canvas colours are literals because canvas can't read CSS tokens.

// ---- Palette (flat fills only: no gradients, glows or shadows) --------------
export const BACKGROUND = "#12281d"
export const LETTER = "#f6efe0"
export const LATTICE_LINE = BACKGROUND
export const LATTICE_LINE_ALPHA = 0.18
export const VINE = "#c9a27a" // woody tan: stems, stalks and thorns
export const LEAF = "#4f9a5b"
export const LEAF_DARK = "#357a45"
export const LEAF_DARK_CHANCE = 0.45 // each leaf picks one of the two greens
export const LEAF_VEIN = BACKGROUND
export const LEAF_VEIN_ALPHA = 0.5
export const FLOWER_CENTER = "#fff6e0"

// Bract varieties: each word rolls one, and its letters share it.
export type Variety = { weight: number; main: string; vein: string }
export const VARIETIES = {
  MAGENTA: { weight: 1, main: "#d81b78", vein: "#a8115a" },
  CORAL: { weight: 1, main: "#ff6a4d", vein: "#c94330" },
  BLUSH: { weight: 1, main: "#f59ac2", vein: "#c9618f" },
  VIOLET: { weight: 1, main: "#8e3fc9", vein: "#6527a0" },
} as const satisfies Record<string, Variety>
export type VarietyName = keyof typeof VARIETIES
// Mix within a word: 85% of bracts use the main colour, 15% a lighter tint of it.
export const BRACT_TINT_CHANCE = 0.15
export const BRACT_TINT_MIX = 0.32 // tint = main mixed this far toward LETTER
export const SECOND_VARIETY_CHANCE = 0 // chance a word also gets a second, different variety (0: one colour per word)...
export const SECOND_VARIETY_SHARE = 0.4 // ...used by this share of its clusters (each bunch stays one colour)

// ---- Font -------------------------------------------------------------------
export const FONT_FAMILY: "Playfair Display" | "Fraunces" = "Playfair Display"
export const FORCE_UPPERCASE = false
// Weight per family. The other family is the fallback.
export const FONT_WEIGHTS = { "Playfair Display": 600, Fraunces: 600 } as const

// ---- Input / layout ---------------------------------------------------------
export const REGENERATE_KEY = "R" // Shift+R: plain "r" is a typed letter
export const LATTICE_PANEL_KEY = "T" // Shift+T: plain "t" is a typed letter
export const LATTICE_PANEL_DEFAULT = false
export const DEBUG_KEY = "V" // Shift+V: vine skeletons by hierarchy + rejection counts in the console
export const BACKSPACE_DEBUG_KEY = "K" // Shift+K: log backspace latency and slow frames
export const BACKSPACE_WATCH_MS = 1000 // watch this long after each backspace
export const BACKSPACE_SLOW_FRAME_MS = 20
export const TYPEABLE = /^[ \p{L}\p{N}.,;:!?'"&@#%*+=/()\-]$/u // space separates words
export const MAX_GLYPHS = 80

// One line for as long as possible: the font shrinks to keep the line at LINE_VW until it would
// drop below ONE_LINE_MIN_VW, then the text wraps at spaces.
export const LINE_VW = 0.85 // the line spans this much of the viewport width
export const ONE_LINE_MIN_VW = 0.084 // smallest font size (x viewport width) before wrapping, measured from the reference screenshot
export const ROW_MAX_VW = 0.92 // once at the minimum size, a row may fill up to this before wrapping
export const BLOCK_MAX_VH = 0.9 // shrink the font if the rows don't fit vertically
export const FONT_MAX_VH = 0.4 // short words stop growing at this height
export const FONT_MIN_PX = 28
export const TRACKING_EM = -0.01 // letter spacing, x font size
export const WORD_SPACE_EM = 0.12 // extra width added to each space
export const LINE_HEIGHT_EM = 2.1 // room for the arch above and hanging bracts below
export const BASELINE_IN_LINE = 0.6 // baseline position within a line box

// Every size-dependent pixel value is authored at this font size and scaled by fs / REF_FONT_PX.
// Plants are built in word coordinates at this size (origin: the word's first pen, baseline y = 0).
export const REF_FONT_PX = 200

// ---- Caret ------------------------------------------------------------------
export const CARET_WIDTH_PX = 3
export const CARET_TOP_EM = 0.74 // above the baseline
export const CARET_BOTTOM_EM = 0.06 // below the baseline
export const CARET_GAP_EM = 0.08 // after the last glyph's advance
export const CARET_BLINK_MS = 530 // on / off half period
export const CARET_SOLID_MS = 500 // stays solid this long after a key
export const CARET_ALPHA = 0.85

// ---- Trellis lattice --------------------------------------------------------
// Diamond lattice clipped to each glyph, in screen space so it lines up with the panel. Static.
export const LATTICE_SPACING_EM = 0.1 // x layout font size
export const LATTICE_WIDTH_PX = 1.5 // css px, not scaled
export const LATTICE_PANEL_COLOR = LETTER // LATTICE_LINE is the background colour, so the panel uses the letter colour
export const LATTICE_PANEL_ALPHA = 0.07

// ---- Timeline -----------------------------------------------------------------
// A letter appears instantly; its stems start after VINE_DELAY and grow at a steady pace (ease-out).
// Children start when their parent's tip passes the branch point. The arch waits for the word to settle.
export const VINE_DELAY = 300
export const VINE_STAGGER = 250 // a letter's trunks / hugs / bridges start spread across this window
export const GROW_MS_PER_EM = 1500 // stem growth time per font-size of length
export const GROW_MS_MIN = 450
export const CLUSTER_GAP_MS = 60 // after its stem tip passes the attachment

// ---- Springs ----------------------------------------------------------------
// Damped spring: frequency is the natural angular frequency (rad/s), damping the velocity
// damping coefficient (1/s). Ratio = damping / (2 x frequency); lower = bouncier.
export type Spring = { frequency: number; damping: number }
export const LEAF_SPRING: Spring = { frequency: 18, damping: 13 } // pop-in of leaves and thorns
export const BLOOM_SPRING: Spring = { frequency: 16, damping: 11 } // bracts opening
export const FLOWER_SPRING: Spring = { frequency: 22, damping: 14 } // centre flowers popping in
export const BRACT_OPEN_STAGGER_MS = 85 // the 3 bracts open this far apart
export const BRACT_OPEN_ROTATE_DEG = 28 // bracts turn into place; the spring overshoots slightly
export const FLOWER_DELAY_MS = 90 // after the last bract starts opening

// ---- Sway, lean and boil ----------------------------------------------------
// Each stem is a damped spring (angle about its root) chasing the wind. Hanging clusters are a
// second, heavier spring that follows their stem's angle a little late.
export const STEM_SWAY: Spring = { frequency: 11, damping: 4.4 }
export const CLUSTER_SWAY: Spring = { frequency: 8, damping: 2.6 } // heavier, slower
export const CLUSTER_SWING_DELAY_MS = 80 // follows its stem's angle this late
export const CLUSTER_FOLLOW = 1.6 // x stem angle (delayed)
export const CLUSTER_WIND = 0.8 // x wind angle
export const SWAY_BEND_POWER = 1.6 // bend weight along a stem: (s / length)^power; the root stays put
export const LEAN_DEG = 2.2 // steady wind lean (positive = toward screen right)
export const GUST_DEG = 3.2 // plus a slow gust on top
export const GUST_RATE = 0.22 // gust noise cells per second
export const GUST_WAVE = 0.004 // gusts travel across the screen: noise offset per css px
export const TYPE_KICK_DEG_S = 26 // angular velocity kick to a word's stems on each keypress
export const RECOIL_KICK_DEG_S = -55 // and on backspace (they flinch the other way)
export const SWAY_MAX_DT = 1 / 30
// Boil: hand-drawn line jitter, a smooth displacement field re-rolled at BOIL_FPS.
export const BOIL_FPS = 8
export const BOIL_PX = 0.9 // amplitude
export const BOIL_WAVELENGTH_EM = 0.35
export const BOIL_ROTATE_DEG = 1.6 // per-shape rotation jitter on leaves and bracts
export const BOIL_BRACT = 0.5 // bracts boil at this x amplitude so they read as soft paper

// ---- Backspace, wither and layout easing --------------------------------------
// Backspace marks the last live glyph dead on the keypress frame; that is the whole deletion.
// Its letterform vanishes at once, and everything its plant owns (stems, leaves, thorns, blooms)
// retracts toward the roots by kk = 1 - easeOutCubic(t / WITHER_MS).
export const WITHER_MS = 260
export const REMOVE_MS = 300 // a dead glyph is dropped this long after its death
export const WITHER_MAX = 30 // withering glyphs at once; the oldest beyond this are fast-forwarded
export const WITHER_SHRINK_EM = 0.05 // thorns, buds and blooms shrink as the retracting tip comes within this
export const WITHER_BURST_MAX = 8 // bracts that fall from a deleted glyph's open clusters...
export const WITHER_BURST_DELAY_MS = 120 // ...each after its own random delay up to this
export const WITHER_BURST_LIFE_MS = 450 // ...and fade out as they fall instead of coming to rest
export const PETAL_FADE_MS = 250 // petals lying on a deleted letter fade out this fast
export const WITHER_REST_PAD_EM = 0.05 // a neighbour's stem whose tip or blooms hang over a deleted letter (+ this) goes with it
export const LAYOUT_EASE_MS = 80 // live glyphs and the caret ease toward their targets, k = 1 - exp(-dt / this)
export const EASE_DT_MAX_MS = 64 // frame dt is clamped to this for the easing

// ---- Word personalities -----------------------------------------------------
// Each word (a run of letters between spaces) rolls one personality; its letters share it.
export type WordStyle = {
  weight: number // relative chance of rolling this personality
  lengthMul: number // x every stem length
  gravity: number // x every gesture's gravity
  twigs: readonly [number, number] // twigs per trunk / drape
  thorns: readonly [number, number] // per trunk / branch (capped at THORN_MAX_PER_STEM)
  tendrilChance: number // per twig, while the word's TENDRIL_MAX lasts
  pairChance: number // a twig's bloom is a pair rather than a single
  blooms: readonly [number, number] // bloom sites per word: hero + medium bunches + small singles/pairs
  bunch: readonly [number, number] // clusters in a drape-end (medium) bunch
  heroBunch: readonly [number, number] // clusters in the arch's hero bunch
  leafPairs: readonly [number, number] // leaf pairs gathered behind each twig bloom
  leafSize: number // x leaf length
}
export const STYLES = {
  LUSH: { weight: 1, lengthMul: 1, gravity: 1, twigs: [1, 2], thorns: [0, 1], tendrilChance: 0.2, pairChance: 0.5, blooms: [5, 6], bunch: [4, 5], heroBunch: [5, 6], leafPairs: [2, 3], leafSize: 0.85 },
  CLIMBING: { weight: 1, lengthMul: 1.25, gravity: 0.7, twigs: [1, 2], thorns: [1, 2], tendrilChance: 0.65, pairChance: 0.2, blooms: [3, 4], bunch: [4, 4], heroBunch: [4, 5], leafPairs: [1, 2], leafSize: 1 },
  SPILLING: { weight: 1, lengthMul: 1.1, gravity: 1.5, twigs: [0, 1], thorns: [0, 1], tendrilChance: 0.15, pairChance: 0.3, blooms: [3, 5], bunch: [5, 7], heroBunch: [6, 7], leafPairs: [0, 1], leafSize: 1 },
} as const satisfies Record<string, WordStyle>
export type StyleName = keyof typeof STYLES
export const WORD_SETTLE_MS = 900 // a word with no new letters for this long (or followed by a space) gets its arch

// ---- Stems: curvature-driven walk ---------------------------------------------
// Every stem is a WALK_STEPS walk over u in [0, 1]. Heading changes by k(u) du, with k linear in
// u (at most one inflection), plus a pull toward straight down of g * u^2 * GRAVITY_K per radian
// off vertical. Curvatures below are total turns in radians over the whole stem, so shapes don't
// depend on length. The walk is then smoothed with Catmull-Rom cubics.
export const WALK_STEPS = 60
export const BEZIER_SAMPLES = 6 // flattening samples per walk step
export const GRAVITY_K = 10
export const INFLECT_CHANCE = 0.2 // most stems curve one way; this many change sign once
export type Tier = "trunk" | "branch" | "twig"
export const BASE_WIDTH_EM = 0.022
export const TIER_WIDTH: Record<Tier, number> = { trunk: 1, branch: 0.65, twig: 0.4 }
export const TAPER_TIP = 0.6 // width at the tip, x width at the root
export const STEM_MIN_PX = 1 // css px, so thin twigs stay visible at small sizes
export const KNOT_WIDTH = 1.3 // bump at each branching point, x the parent's width there
export const CHILD_ANGLE_MIN_DEG = 30 // children leave on the outer side of the parent's curve
export const CHILD_ANGLE_MAX_DEG = 45
export const CHILD_GAP_MIN_EM = 0.07 // irregular spacing between children on one parent
export const CHILD_GAP_MAX_EM = 0.2

// Growth points: 2-3 per word on ink near the baseline, spread across the word.
export const GROWTH_MAX = 3 // per word, up to GROWTH_LETTERS_PER letters x 3; beyond that one per GROWTH_LETTERS_PER letters
export const GROWTH_LETTERS_PER = 2.5
export const DRAPE_EXTRA_LETTERS = 4 // one more drape per this many letters
export const BLOOM_EXTRA_LETTERS = 3 // one more bloom site per this many letters
export const COVER_PAD_EM = 0.02 // a letter counts as decorated if a leaf, bloom or front stem is over it (+ this)
// Sprinkles: small clusters on stretches of stem with no bloom within SPRINKLE_GAP_EM (at settle).
export const SPRINKLE_GAP_EM = 0.22
export const SPRINKLE_MAX_PER_STEM = 3
export const SPRINKLE_LENGTH_EM: readonly [number, number] = [0.045, 0.065] // bract length: between the twig singles and the drape bunches
export const SPRINKLE_FROM = 0.3 // fraction of the stem (trunks use TRUNK_BARE)
export const SPRINKLE_MIN_LENGTH_EM = 0.25 // stems shorter than this get none
export const GROWTH_MIN = 2 // topped up at settle for words of GROWTH_MIN_LETTERS or more
export const GROWTH_MIN_LETTERS = 2
export const GROWTH_EVERY: readonly [number, number] = [2, 3] // letters between growth points
export const GROWTH_BAND_EM = 0.1 // ink within this of the baseline

// Trunk: a short climber from each growth point; drapes and twigs leave it.
export const TRUNK_GRAVITY = 0.2
export const TRUNK_LEAN_MAX_RAD = 0.5 // off vertical
export const TRUNK_LENGTH_EM: readonly [number, number] = [0.5, 0.85]
export const TRUNK_CURVE: readonly [number, number] = [0.15, 0.6] // total turn, either way
export const TRUNK_BARE = 0.35 // no leaves, blooms or children on the first part of a trunk

// ARCH: one per word, one continuous vine in three phases on a SUPPORT glyph (an ascender
// nearest the word's centre, else the tallest letter):
// CLIMB hugs the support's outline up from its baseline ink, in front; CREST rises at most
// ARCH_CREST_CAP_EM above the support's top and bends over once; SPILL heads down the far side so
// the bunch rests against a neighbouring letter. Crest and spill are behind the type.
export const ARCH_ASCENDERS = "bdfhklt"
export const ARCH_ROOT_INSET_PX = 2 // the root sits this far inside the baseline ink
export const ARCH_CLIMB_TOP_EM = 0.03 // the climb hands over to the crest this far below the support's top
export const ARCH_NEIGHBOUR_CLEAR_PX = 2 // the climb stops before it comes this close to a neighbour's ink...
export const ARCH_CLIMB_MIN_EM = 0.06 // ...but must still climb at least this far
export const ARCH_CREST_CAP_EM = 0.25 // hard cap: nothing rises more than this above the support's top
export const ARCH_TOP_MARGIN_VH = 0.08 // nothing of the arch within this of the viewport top (lowers the cap)
export const ARCH_SPAN_MAX_EM = 1.6 // total horizontal span, bunch included
export const ARCH_TURN: readonly [number, number] = [0.88, 1] // x the turn from the climb's heading to straight down
export const ARCH_CREST_PEAK = 0.3 // where the bend is sharpest along crest+spill (< 0.5: steeper on the climb side)
export const ARCH_CURVE_NOISE = 0.15 // +/- low-frequency noise on the curvature
export const ARCH_NOISE_CELLS = 2.5 // noise features along crest+spill
export const ARCH_LENGTH_EM: readonly [number, number] = [0.7, 1.2] // the bend (up, over, turning down), before the cap
export const ARCH_SPILL_EXTRA_EM: readonly [number, number] = [0.3, 0.7] // then the spill drops on, before trimming
export const ARCH_SHORTEN = 0.2 // each retry pair shortens the spill by this fraction
export const ARCH_SPILL_MIN_EM = 0.12 // the spill runs at least this far past the crest
export const ARCH_LAND_X_EM = 0.2 // the main bunch's centre must be within this (horizontal)...
export const ARCH_LAND_Y_EM = 0.3 // ...and this (vertical) of some ink; ideally the neighbour's top
export const ARCH_TRIES = 6 // alternating sides, then shorter; then fall back to a drape
export const ARCH_ROOT_WIDTH = 1 // x BASE_WIDTH at the root...
export const ARCH_TIP_WIDTH = 0.55 // ...tapering to this at the bunch
// Leaves: from ARCH_LEAF_FROM of the length, alternating sides (outward only on the climb),
// larger near the crest, gathered in pairs near the bunch.
export const ARCH_LEAF_FROM = 0.2
export const ARCH_LEAF_SPACING_EM = 0.12
export const ARCH_LEAF_JITTER = 0.25 // +/- fraction of the spacing
export const ARCH_LEAF_CREST_BOOST = 0.45 // up to this much larger at the crest
export const ARCH_LEAF_CREST_RANGE_EM = 0.25
export const ARCH_LEAF_BUNCH_EM = 0.15 // pairs within this of the bunch...
export const ARCH_LEAF_BUNCH_SPACING_EM = 0.05 // ...this close together
// Side twigs on the crest / spill, one always on the spill.
export const ARCH_TWIGS: readonly [number, number] = [2, 3]
export const ARCH_TWIG_LENGTH_EM: readonly [number, number] = [0.1, 0.2]
export const ARCH_TWIG_BLOOM_CHANCE = 0.5 // ends in a small cluster (while the budget lasts), else a leaf pair
export const ARCH_TWIG_GAP_EM = 0.1 // between twigs and from the second bunch
// Main bunch at the spill's tip, and a smaller one partway down the spill.
export const ARCH_BUNCH: readonly [number, number] = [4, 6]
export const ARCH_BUNCH_STEM_EM: readonly [number, number] = [0.08, 0.14] // short drooping stalk
export const ARCH_BUNCH_MAX_ACROSS_EM = 0.5
export const ARCH_SECOND_AT = 0.4 // fraction of the way down the spill
export const ARCH_SECOND_BUNCH: readonly [number, number] = [2, 3]
export const ARCH_SECOND_STEM_EM: readonly [number, number] = [0.04, 0.08]
export const ARCH_SECOND_STALK_EM = 0.035

// DRAPE: a branch that leaves a trunk outward and falls, ending in a bunch or a twig.
export const DRAPES: readonly [number, number] = [2, 3] // per word
export const DRAPE_GRAVITY = 0.8
export const DRAPE_LENGTH_EM: readonly [number, number] = [0.4, 0.75]
export const DRAPE_CURVE: readonly [number, number] = [0, 0.35]
export const DRAPE_AT: readonly [number, number] = [0.45, 0.9] // on the trunk
export const MEDIUM_BUNCHES = 2 // drape-end bunches per word; other drapes end in a twig

// TWIG: short end stems that carry the blooms, buds and leaves.
export const TWIG_GRAVITY = 0.5
export const TWIG_LENGTH_EM: readonly [number, number] = [0.16, 0.3]
export const TWIG_CURVE: readonly [number, number] = [0.3, 0.9]
export const TWIG_FROM = 0.25 // on a drape (trunks use TRUNK_BARE)

// TENDRIL: a terminal spiral at the end of a twig.
export const TENDRIL_MAX = 2 // per word
export const TENDRIL_TURNS: readonly [number, number] = [1.25, 1.75]
export const TENDRIL_SIZE_EM: readonly [number, number] = [0.04, 0.07] // starting radius
export const TENDRIL_TIGHTEN = 0.7 // radius shrinks by this fraction toward the end
export const TENDRIL_LEAD_EM = 0.12 // the stretch before a spiral may come close to it

// HUG: follows a glyph's outline upward from the baseline, just outside the ink, in front.
export const HUG_EVERY = 2 // about one per this many letters
export const HUG_OFFSET_EM = 0.03 // outside the ink
export const HUG_MAX_STROKE_COVER = 0.25 // a hug may cover at most this much of a stroke's width
export const HUG_START_EM = 0.03 // starts this far above the baseline
export const HUG_LENGTH_EM: readonly [number, number] = [0.3, 0.8]
export const HUG_TOP_EM = 0.08 // stops this far below the glyph's ink top
export const HUG_STEP_PX = 1.5
export const HUG_MIN_EM = 0.22

// Bridges: sagging rope between neighbouring glyphs, both ends on ink, behind the type.
export const BRIDGE_MAX_GAP_EM = 0.6
export const BRIDGE_MIN_GAP_EM = 0.02
export const BRIDGE_SAG_EM = 0.15
export const BRIDGE_EVERY: readonly [number, number] = [2, 3] // at most one per this many letters
export const BRIDGE_Y_EM: readonly [number, number] = [0.12, 0.4] // above the baseline
export const BRIDGE_INSET_EM = 0.015 // ends sit this far inside the ink

// ---- Clearance ----------------------------------------------------------------
export const VINE_TRIES = 8 // retry a rejected stem with a new seed, then skip it
export const GAP_EM = 0.04 // stems closer than this are "together"
export const PARALLEL_MAX = 0.2 // reject a stem that runs alongside others for more than this fraction of its length
export const PARALLEL_DEG = 35 // ...where "alongside" means within this angle
export const ROOT_EXEMPT_EM = 0.1 // stems may start close to their parent / growth point
export const SELF_GAP = 3 // x GAP_EM along the stem before coming back close counts as crossing itself
export const FRONT_MAX_INK_EM = 0.4 // a stem in front of the type may cross ink for at most this long, on one glyph
export const CALM_FREE = 0.4 // keep this fraction of a word's ink free of anything drawn in front
export const CALM_CELL_EM = 0.05
export const REACH_X_EM = 0.35 // stems stay within the word's box grown by these
export const REACH_UP_EM = 1.65 // above the baseline
export const REACH_DOWN_EM = 0.75 // below the baseline

// ---- Sway flex (x the stem spring's target) ------------------------------------
export const FLEX: Record<"trunk" | "climb" | "arch" | "drape" | "twig" | "hug" | "bridge" | "bunch", number> = {
  trunk: 0.8,
  climb: 0.15,
  arch: 0.45,
  drape: 1.2,
  twig: 1.3,
  hug: 0.3,
  bridge: 0.5,
  bunch: 1.4,
}

// ---- Bunches ------------------------------------------------------------------
// Drooping sub-stem with 4-7 clusters on fanned stalks: medium ones at drape ends, and the hero on a fallback drape.
export const HERO_STEM_EM: readonly [number, number] = [0.24, 0.34]
export const MEDIUM_STEM_EM: readonly [number, number] = [0.14, 0.22]
export const BUNCH_FROM = 0.15 // clusters spread from this fraction of the sub-stem to its tip
export const BUNCH_STALK_EM = 0.07 // hero
export const MEDIUM_STALK = 0.7 // x BUNCH_STALK_EM for medium bunches
export const BUNCH_STALK_DEG_MIN = 45 // off straight down, alternating sides
export const BUNCH_STALK_DEG_MAX = 80
export const BUNCH_STAGGER_MS = 110 // clusters open top to bottom

// ---- Leaves -----------------------------------------------------------------
// Only on twigs, in pairs, gathered just behind a bloom. Ovate with a pointed tip.
export const LEAF_LENGTH_EM: readonly [number, number] = [0.09, 0.165] // then x style leafSize
export const LEAF_WIDTH_RATIO = 0.55 // x leaf length
export const LEAF_WIDEST_AT = 0.36 // fraction of the length
export const LEAF_ANGLE_MIN_DEG = 35 // off the stem, leaning toward the tip
export const LEAF_ANGLE_MAX_DEG = 55
export const LEAF_NEAR_BLOOM_EM = 0.15 // leaves only within this (arc length) behind a bloom
export const LEAF_PAIR_GAP_EM: readonly [number, number] = [0.04, 0.07]
export const LEAF_TIP_PAIR_DEG = 32 // a hug that ends in leaves: two leaves this far either side of the tip
export const LEAF_VEIN_WIDTH_PX = 1.4
export const LEAF_VEIN_FROM = 0.1 // vein runs along this span of the leaf
export const LEAF_VEIN_TO = 0.8

// ---- Thorns -----------------------------------------------------------------
// Small curved hooks angled back toward the root, on trunks and branches.
export const THORN_MAX_PER_STEM = 2
export const THORN_LENGTH_EM = 0.025 // past the stem edge
export const THORN_LENGTH_JITTER = 0.25 // +/- fraction
export const THORN_BASE = 1.5 // x stem width
export const THORN_ANGLE_MIN_DEG = 120 // off the stem's forward tangent (>90 = backward)
export const THORN_ANGLE_MAX_DEG = 145
export const THORN_FROM = 0.15 // fraction of the stem
export const THORN_TO = 0.85
export const THORN_GAP_EM = 0.08 // from each other and from branch points

// ---- Debug --------------------------------------------------------------------
export const DEBUG_COLORS: Record<Tier, string> = { trunk: "#ff3b30", branch: "#ff9500", twig: "#ffd60a" }
export const DEBUG_LINE_PX = 1.5
export const DEBUG_DOT_PX = 4
export const DEBUG_ARCH_COLOR = "#5ac8fa" // support box, crest cap, bunch-to-ink line

// ---- Bract clusters ---------------------------------------------------------
export const BRACT_POINTS = 20 // outline samples
export const BRACT_WIDTH_RATIO = 0.78 // full width / length
export const BRACT_WIDEST_AT = 0.33 // widest in the lower third
export const BRACT_ROUNDNESS = 0.8 // < 1 = fuller shoulders
export const BRACT_ASYMMETRY = 0.07 // +/- per side
export const BRACT_BASE_OFFSET = 0.1 // bracts start this far (x length) out from the centre
export const BRACT_ANGLE_JITTER_DEG = 10
export const BRACT_VEIN_WIDTH_PX = 1.1
export const BRACT_VEIN_FROM = 0.08
export const BRACT_VEIN_TO = 0.84
export const BRACT_SIDE_VEIN_MIN_EM = 0.055 // side veins only on bracts at least this long
export const BRACT_SIDE_VEIN_AT = 0.36
export const BRACT_SIDE_VEIN_LENGTH = 0.24 // x bract length
export const BRACT_SIDE_VEIN_DEG = 38
export const BUD_LENGTH_MIN_EM = 0.025 // tiny buds: 1 bract, on the last part of twigs
export const BUD_LENGTH_MAX_EM = 0.04
export const CLUSTER_LENGTH_MIN_EM = 0.05 // medium (drape-end bunches)
export const CLUSTER_LENGTH_MAX_EM = 0.09
export const HERO_LENGTH_MIN_EM = 0.11 // hero bunch
export const HERO_LENGTH_MAX_EM = 0.14
export const STALK_EM = 0.02 // clusters hang from a short stalk and orient with gravity
export const STALK_WIDTH = 0.55 // x the stem's width
export const SMALL_LENGTH_MIN_EM = 0.035 // singles and pairs on twigs
export const SMALL_LENGTH_MAX_EM = 0.05
export const BUD_ZONE = 0.15 // buds only on the last part of a twig
export const BUDS_PER_TWIG: readonly [number, number] = [0, 2]
// Centre flowers: three tiny cream tubes between the bracts.
export const FLOWER_COUNT = 3
export const FLOWER_LENGTH = 0.32 // x bract length
export const FLOWER_LENGTH_MAX_EM = 0.03
export const FLOWER_WIDTH_PX = 2.6
export const FLOWER_WIDTH_MIN_PX = 1.6
export const FLOWER_TIP = 0.75 // dot at the tube's mouth, x tube width

// ---- Falling bracts ---------------------------------------------------------
export const FALL_EVERY_MIN_MS = 1500
export const FALL_EVERY_MAX_MS = 4000
export const FALL_MAX = 40 // active falling + resting bracts
export const FALL_SPEED_EM = 0.3 // per second
export const FALL_SWAY_EM = 0.03 // sideways flutter amplitude
export const FALL_FLUTTER_MS = 1300 // flutter period
export const FALL_SPIN_DEG_S = 35 // slow rotation, random direction
export const FALL_WOBBLE_DEG = 18 // plus a rocking swing in time with the flutter
export const FALL_REST_MS = 4000 // rests at the baseline this long
export const FALL_FADE_MS = 1000
export const FALL_LAND_ABOVE = 0.3 // rests with its centre this x its length above the baseline
export const BRACT_REGROW_MS = 9000 // a dropped bract springs back after this (Infinity = never)
