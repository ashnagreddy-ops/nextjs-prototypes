// All tunables for Frost Type. Lengths ending in _EM are fractions of the current
// font size; _PX are css pixels; times are ms on each glyph's own clock (0 = its keypress).
// Canvas colours are literals because canvas can't read CSS tokens.

// ---- Palette ----------------------------------------------------------------
export const BACKGROUND = "#070b1c"
export const ICE_LIGHT = "#a9d3f7"
export const ICE_MID = "#4f8fd8"
export const ICE_DEEP = "#1f4f9e"
export const ICE_HIGHLIGHT = "#f2faff"
export const OUTLINE = "#17408a"
export const SNOW = "#f7fbff"
export const SNOW_SHADOW = "#bcd9f5"

// ---- Font -------------------------------------------------------------------
export const FONT_FAMILY: "Abril Fatface" | "Playfair Display" = "Abril Fatface"
export const FORCE_UPPERCASE = false
// Weight per family (Abril Fatface only ships 400). The other family is the fallback.
export const FONT_WEIGHTS = { "Abril Fatface": 400, "Playfair Display": 900 } as const

// ---- Timeline (per glyph) ---------------------------------------------------
export const BODY_DELAY = 0
export const BODY_FREEZE_MS = 250 // expanding reveal of the ice body
export const FREEZE_POINTS = 2 // interior points the reveal expands from

export const ICICLE_DELAY = 200
export const ICICLE_STAGGER = 450 // icicles start at random times within this window
export const ICICLE_DURATION_MIN = 700
export const ICICLE_DURATION_MAX = 1100

export const SNOW_DELAY = 350
export const SNOW_STAGGER = 300
export const SNOW_DURATION_MIN = 600
export const SNOW_DURATION_MAX = 900

export const FILIGREE_DELAY = 500
export const FILIGREE_STAGGER = 400 // spine starts spread across this window
export const FILIGREE_DURATION_MIN = 1200 // per spine, base to tip
export const FILIGREE_DURATION_MAX = 1600
export const SCROLL_STEM_MS = 250 // stem extends first (ease-out)...
export const SCROLL_SPIRAL_MS = 500 // ...then the spiral winds in (ease-in-out)
export const TERMINAL_SPIRAL_MS = 500
export const LEAF_GROW_MS = 250 // leaves scale in after their neighbouring scrolls
export const BEAD_POP_MS = 220 // ease-out-back, tiny overshoot

// ---- Input / layout ---------------------------------------------------------
export const REGENERATE_KEY = "R" // Shift+R: plain "r" is a typed letter
export const TYPEABLE = /^[\p{L}\p{N}.,;:!?'"&@#%*+=/()\-]$/u
export const MAX_GLYPHS = 120

export const MAX_LETTERS_PER_ROW = 12
export const ROW_MAX_VW = 0.9 // wrap when a row would exceed this
export const BLOCK_MAX_VH = 0.86 // shrink the font if the rows don't fit vertically
export const FONT_MAX_VH = 0.32
export const FONT_MAX_VW = 0.3
export const FONT_MIN_PX = 26
export const SIZE_FULL_CHARS = 3 // text up to this length renders at max size
export const CELL_EM_ESTIMATE = 0.74 // average advance + gap, used to pick the size
export const LETTER_GAP_EM = 0.03 // extra space between glyphs (room for icicles/snow)
export const LINE_HEIGHT_EM = 1.75 // room for snow above and icicles below
export const BASELINE_IN_LINE = 0.62 // baseline position within a line box

export const GLYPH_PAD_EM = 0.1 // local canvas padding: sides
export const SNOW_PAD_EM = 0.12 // top
export const ICICLE_PAD_EM = 0.42 // bottom

// Cached glyphs are drawn scaled while text length changes; rebuild when the scale drifts this far.
export const REBUILD_MIN_SCALE = 0.8
export const REBUILD_MAX_SCALE = 1.08
export const REBUILDS_PER_FRAME = 2
export const MAX_ACTIVE_ELEMENTS = 2000 // oldest glyphs fast-forward past this

// ---- Ice body ---------------------------------------------------------------
export const BODY_ALPHA = 0.85 // vertical gradient ICE_LIGHT -> ICE_MID -> ICE_DEEP
export const BODY_BOTTOM_LIGHTEN = 0.3 // mix ICE_DEEP toward ICE_MID so the bottom isn't a navy block
export const INNER_GLOW_ALPHA = 0.35 // ICE_LIGHT radial glow, lit from within
export const INNER_GLOW_OFFSET_EM = -0.05 // centre sits this far above the centroid
export const INNER_GLOW_RADIUS_RATIO = 0.8 // x sqrt(ink area)
export const INNER_SHADE_WIDTH_EM = 0.12 // outline stroke width; half of it lands inside the glyph
export const INNER_SHADE_BLUR_EM = 0.03
export const INNER_SHADE_ALPHA = 0.5
export const RIM_EM = 0.012 // thin rims: ICE_HIGHLIGHT upper-left, OUTLINE lower-right
export const RIM_MIN_PX = 1.2
export const RIM_HIGHLIGHT_ALPHA = 0.9
export const RIM_OUTLINE_ALPHA = 0.85
export const FACET_MIN = 4 // faint curved facet lines following the stroke direction
export const FACET_MAX = 6
export const FACET_ALPHA_MIN = 0.1
export const FACET_ALPHA_MAX = 0.18
export const FACET_WIDTH_PX = 1
export const FACET_OFFSET_MIN = 0.25 // distance from the spine, x local half-thickness
export const FACET_OFFSET_MAX = 0.6
export const FACET_LENGTH_MIN_PX = 40
export const FACET_LENGTH_MAX_PX = 120
export const BUBBLE_MIN = 6 // tiny trapped bubbles
export const BUBBLE_MAX = 10
export const BUBBLE_R_MIN_PX = 1
export const BUBBLE_R_MAX_PX = 3
export const BUBBLE_ALPHA = 0.25
export const BUBBLE_EDGE_PX = 4 // keep bubbles this far from the edge
export const STREAK_COUNT = 12
export const STREAK_ALPHA_MIN = 0.08
export const STREAK_ALPHA_MAX = 0.15
export const STREAK_WIDTH_MIN_EM = 0.015
export const STREAK_WIDTH_MAX_EM = 0.06
export const STREAK_BLUR_EM = 0.008
export const STREAK_LEAN = 0.35 // horizontal drift over the glyph height, fraction of height
export const STREAK_WARP_EM = 0.05 // noise warp amplitude
export const STREAK_LENGTH_MIN = 0.4 // fraction of glyph height
export const STREAK_LENGTH_MAX = 0.9

// ---- Icicles ----------------------------------------------------------------
export const ICICLE_NORMAL_MIN = 0.35 // edge must face this much downward (arches, counter ceilings)
export const ICICLE_MIN_RUN_PX = 5
export const ICICLE_SPACING_MIN_PX = 5
export const ICICLE_SPACING_MAX_PX = 9
export const ICICLE_NOISE_WAVELEN_EM = 0.3 // low-frequency gate: bare patches and dense clusters
export const ICICLE_GATE_LOW = 0.25 // gate noise at/below this: never; at/above HIGH: always
export const ICICLE_GATE_HIGH = 0.55
export const ICICLE_MAX = 70
export const ICICLE_MIN_LEN_PX = 8
export const ICICLE_MAX_LEN_RATIO = 0.28 // of glyph ink height
export const ICICLE_LEN_POWER = 3 // len = MIN + (MAX-MIN) * r^POWER, so most are short
export const ICICLE_CLEARANCE_PX = 2 // keep this far above ink below
export const ICICLE_MIN_FIT_PX = 5 // drop icicles squeezed shorter than this
export const ICICLE_WIDTH_RATIO_MIN = 0.16 // width / length
export const ICICLE_WIDTH_RATIO_MAX = 0.26
export const ICICLE_WIDTH_MIN_PX = 2.2
export const ICICLE_WIDTH_MAX_EM = 0.055
export const ICICLE_LEAN_RATIO = 0.18 // tip offset, fraction of length
export const ICICLE_LEAN_MAX_EM = 0.02
export const ICICLE_BEND_RATIO = 0.1 // sideways bow of the spike
export const ICICLE_BASE_ALPHA = 0.85
export const ICICLE_TIP_ALPHA = 0.15
export const ICICLE_HIGHLIGHT_ALPHA = 0.9 // thin ICE_HIGHLIGHT line, left edge
export const ICICLE_OUTLINE_ALPHA = 0.5 // thin OUTLINE line, right edge
export const ICICLE_BEAD_CHANCE = 0.2
export const ICICLE_BEAD_MIN_LEN_PX = 10
export const ICICLE_BEAD_RADIUS_RATIO = 0.6 // of icicle base width
export const ICICLE_DURATION_FAST = 450 // shortest icicles
export const ICICLE_DURATION_SLOW = 1300 // longest icicles

// ---- Snow caps --------------------------------------------------------------
export const SNOW_NORMAL_MIN = 0.7 // edge must face up: normal.y < -0.7
export const SNOW_MIN_RUN_EM = 0.06
export const SNOW_MIN_PX = 3
export const SNOW_MAX_PX = 10
export const SNOW_NOISE_WAVELEN_EM = 0.12 // thickness variation along a run
export const SNOW_MAX_ASPECT = 0.3 // cap height <= this x run length
export const SNOW_PROFILE_POWER = 0.55 // <1 = flatter, fuller mound
export const SNOW_OVERLAP_PX = 1.5 // tuck the cap into the edge
export const SNOW_SHADOW_OFFSET_PX = 2.5 // SNOW_SHADOW layer sits this far below the drift
export const SNOW_SPARKLES_PER_PX = 1 / 45 // sparkle dots per px of run, 1-2px each
export const SNOW_SPARKLE_MAX = 4

// ---- Filigree: a rinceau of spines and alternating spiral scrolls ----------
export const STROKE_REF_FONT_PX = 150 // reference size for snow thickness scaling

// Skeleton / spines
export const BRANCH_MIN_PX = 12 // skeleton spurs shorter than this are pruned...
export const BRANCH_THICK_RATIO = 1.2 // ...or, if they run out to the glyph edge, shorter than this x the stroke thickness
export const BRANCH_TIP_DEPTH = 0.6 // "runs out to the edge": tip depth below this fraction of the junction depth
export const SPINE_MIN_PX = 8 // isolated spines shorter than this are dropped
export const SIMPLIFY_EPS_PX = 1 // Ramer-Douglas-Peucker tolerance before smoothing
export const SPLINE_STEP_PX = 2 // Catmull-Rom resample step
export const SPINE_WIDTH_RATIO = 0.12 // x local thickness
export const SPINE_WIDTH_MIN_PX = 3
export const SPINE_WIDTH_MAX_PX = 9
export const SPINE_TAPER_LEN_PX = 22 // taper length at free ends
export const SPINE_TAPER_END = 0.6 // width fraction at the very end

// Scrolls
export const SCROLL_SPACING_RATIO = 1.1 // x local thickness, along the spine
export const SCROLL_START_RATIO = 0.7 // first scroll this x thickness from the spine start
export const SCROLL_SIZE_RATIO = 0.42 // base outer spiral radius at rhythm 1, x local thickness (retries shrink it to fit)
export const SCROLL_RHYTHM = [1, 0.55, 0.8, 0.55] // large, small, medium, small
export const SCROLL_JITTER = 0.1
export const SCROLL_TURNS_MIN = 1.5
export const SCROLL_TURNS_MAX = 2.25
export const STEM_ANGLE = (50 * Math.PI) / 180 // stem leaves the spine at this angle
export const STEM_BEND = (20 * Math.PI) / 180 // extra outward curve along the stem
export const STEM_LENGTH_RATIO = 1.5 // x outer spiral radius
export const SPIRAL_END_RATIO = 0.08 // inner radius / outer radius
export const SCROLL_WIDTH_RATIO = 0.75 // x spine width, at the stem
export const SCROLL_WIDTH_MIN_PX = 2
export const SCROLL_END_WIDTH = 0.35 // width fraction at the spiral centre
export const SCROLL_MIN_RADIUS_PX = 1.8 // smaller scrolls are skipped
export const EDGE_MARGIN = 3 // px of clearance between a stroke edge and the glyph edge...
export const EDGE_MARGIN_RATIO = 0.12 // ...capped at this x local thickness, so thin strokes still fit scrolls
export const FIT_SHRINK = 0.85 // shrink factor per retry
export const FIT_RETRIES = 6 // 0.85^6 ~ 0.38: shrink to ~40% before skipping
export const OCC_MARK_PAD_PX = 1 // occupancy marks the drawn stroke width + this
export const ATTACH_EXCLUDE_PX = 2 // extra zone at a scroll's attachment that ignores its own spine
export const TARGET_COVERAGE = 0.6 // stop filling at this covered fraction
export const FILL_PASSES = [
  { offset: 0, size: 1 },
  { offset: 0.5, size: 0.75 },
] as const // offset: fraction of spacing; the second pass tucks smaller scrolls between the first

// Pocket pass: after the scrolls, a smaller scroll in the largest remaining empty circle, repeatedly
export const POCKET_MIN_RADIUS_PX = 3 // stop when the biggest empty circle is smaller than this
export const POCKET_MAX = 40
export const POCKET_BATCH = 6 // empty circles taken from one clearance field before recomputing it
export const POCKET_RADIUS_RATIO = 0.9 // scroll radius / empty-circle radius
export const POCKET_STROKE_WIDTH_PX = 2
export const POCKET_DELAY_MS = 300 // after the stroke it grows out of

// Terminal spirals
export const TERMINAL_RADIUS_RATIO = 0.22 // x local thickness at the end
export const TERMINAL_TURNS = 1.75
export const SPILL_CHANCE = 0.15 // of terminals on edge-adjacent spines
export const SPILL_DISTANCE_PX = 14 // max spill past the silhouette
export const SPILL_EDGE_EM = 0.06 // "edge-adjacent": spine end this close to the glyph edge

// Breaking the silhouette (drawn on the unclipped layer)
export const BREAK_CHANCE = 0.25 // of free spine tips and scroll stems that run on past the edge
export const BREAK_MIN_PX = 10 // how far past the edge before curling back
export const BREAK_MAX_PX = 24
export const BREAK_MARCH_MAX_PX = 70 // give up if the edge is further than this
export const BREAK_CURL_TURNS = 1.25
export const BREAK_CURL_RADIUS_RATIO = 0.45 // x overshoot distance
export const INCOMING_MIN = 2 // tendrils that start outside and curve in over a serif or shoulder
export const INCOMING_MAX = 3
export const INCOMING_START_MIN_PX = 12
export const INCOMING_START_MAX_PX = 24
export const INCOMING_ANGLE = (40 * Math.PI) / 180 // sideways entry angle, +/-
export const INCOMING_CURL_RADIUS_PX = 4
export const INCOMING_WIDTH_PX = 2.4
export const INCOMING_DELAY_MS = 200
export const INCOMING_STAGGER_MS = 500

// Snowflakes at sharp convex corners, overlapping the silhouette
export const FLAKE_MIN = 2
export const FLAKE_MAX = 4
export const FLAKE_R_MIN_PX = 12
export const FLAKE_R_MAX_PX = 28
export const FLAKE_MAX_EM = 0.16 // radius cap, x font size
export const FLAKE_R_FLOOR_PX = 7 // ...but never below this
export const FLAKE_DELAY_MS = 900 // after FILIGREE_DELAY
export const FLAKE_STAGGER_MS = 250
export const FLAKE_BLOOM_MS = 450 // arms grow with ease-out-back (slight overshoot)
export const FLAKE_OVERSHOOT = 1.09 // arm length / nominal radius at the peak of the bloom
export const FLAKE_CORNER_RADIUS_PX = 5 // corner test: solid fraction of this disk...
export const FLAKE_CORNER_FRACTION = 0.45 // ...below this means a sharp convex corner
export const FLAKE_SPACING_PX = 40
export const FLAKE_ARM_WIDTH_RATIO = 0.09 // x radius
export const FLAKE_ARM_WIDTH_MIN_PX = 1.4
export const FLAKE_BRANCHES = [
  { at: 0.42, length: 0.3 },
  { at: 0.7, length: 0.2 },
] as const // side branches: position along the arm, length (x radius)
export const FLAKE_BRANCH_ANGLE = (60 * Math.PI) / 180

// Secondary detail
export const CURL_MIN_RHYTHM = 0.75 // only larger scrolls get a C-curl
export const CURL_RADIUS_RATIO = 0.3 // x outer spiral radius
export const CURL_TURNS = 0.75
export const CURL_ANGLE = (55 * Math.PI) / 180 // off the stem, away from the spiral
export const CURL_WIDTH_RATIO = 0.6 // x scroll width
export const LEAF_GAP_CHANCE = 0.25 // teardrop leaf in about 1 of 4 gaps
export const LEAF_LENGTH_RATIO = 0.3 // x local thickness
export const LEAF_LENGTH_MIN_PX = 6
export const LEAF_LENGTH_MAX_PX = 18
export const LEAF_WIDTH_RATIO = 0.4 // x length
export const LEAF_ANGLE = (55 * Math.PI) / 180 // off the spine, toward the tip
export const BEAD_RADIUS_MIN_PX = 1 // 2-3px dots
export const BEAD_RADIUS_MAX_PX = 1.5
export const BEAD_CENTER_CHANCE = 0.5 // chance a spiral centre gets a bead

// Carved relief rendering (four stacked passes)
export const RELIEF_GLOW_ALPHA = 0.25 // ICE_HIGHLIGHT, blurred
export const RELIEF_GLOW_BLUR_PX = 3
export const RELIEF_GLOW_EXTRA_PX = 4 // width + 4
export const RELIEF_SHADOW = "#1b3f8a"
export const RELIEF_SHADOW_ALPHA = 0.7
export const RELIEF_SHADOW_OFFSET_PX = 1.5 // down-right
export const RELIEF_SHADOW_EXTRA_PX = 2 // width + 2
export const RELIEF_BODY_FROM = "#cfe8ff" // along the stroke, base to tip
export const RELIEF_BODY_TO = "#8fc0ef"
export const RELIEF_HIGHLIGHT = "#ffffff"
export const RELIEF_HIGHLIGHT_ALPHA = 0.9
export const RELIEF_HIGHLIGHT_OFFSET_PX = -0.8 // up-left
export const RELIEF_HIGHLIGHT_WIDTH = 0.3 // x stroke width
export const DEBUG_FILIGREE = false // log per-glyph scroll placement stats (spines, candidates, rejects, coverage)
export const RELIEF_CLIP_OVERFLOW_PX = 1 // clip allowance past the glyph edge
