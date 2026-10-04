// All tunables for Frost Type. Lengths ending in _EM are fractions of the current
// font size; _PX are css pixels; times are ms on each glyph's own clock (0 = its keypress).
// Canvas colours are literals because canvas can't read CSS tokens.

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
export const FILIGREE_STAGGER = 600 // tendril starts spread across this window
export const FILIGREE_DURATION_MIN = 1800 // per tendril, base to curl
export const FILIGREE_DURATION_MAX = 2600
export const LEAFLET_GROW_MS = 300
export const LEAFLET_LAG_EM = 0.03 // leaflets start once the tip is this far past them

// ---- Input / layout ---------------------------------------------------------
export const REGENERATE_KEY = "R" // Shift+R: plain "r" is a typed letter
export const TYPEABLE = /^[\p{L}\p{N}.,;:!?'"&@#%*+=/()\-]$/u
export const MAX_GLYPHS = 120

export const FONT_FAMILY = 'Georgia, "Times New Roman", serif'
export const FONT_WEIGHT = 700 // heavy strokes leave room for filigree inside
export const MAX_LETTERS_PER_ROW = 12
export const ROW_MAX_VW = 0.9 // wrap when a row would exceed this
export const BLOCK_MAX_VH = 0.86 // shrink the font if the rows don't fit vertically
export const FONT_MAX_VH = 0.32
export const FONT_MAX_VW = 0.3
export const FONT_MIN_PX = 26
export const SIZE_FULL_CHARS = 3 // text up to this length renders at max size
export const CELL_EM_ESTIMATE = 0.92 // average advance + gap, used to pick the size
export const LETTER_GAP_EM = 0.24 // extra space between glyphs (room for icicles/snow)
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
export const BODY_TOP = "#d6ecff"
export const BODY_BOTTOM = "#86b4e4"
export const BODY_CORE_ALPHA = 0.14
export const BODY_RIM_ALPHA = 0.5
export const BODY_RIM_EM = 0.03 // falloff of the bright rim inside the edge
export const BODY_HIGHLIGHT = 0.55 // extra whiteness on rims facing the light
export const BODY_GRAIN = 0.35 // per-pixel frost speckle
export const LIGHT_DIR = { x: -0.6, y: -0.8 } // from top-left
export const EDGE_COLOR = "#e8f5ff"
export const EDGE_ALPHA = 0.5
export const EDGE_WIDTH_PX = 1

// ---- Icicles ----------------------------------------------------------------
export const ICICLE_NORMAL_MIN = 0.75 // edge must face this much downward
export const ICICLE_MIN_RUN_EM = 0.06
export const ICICLE_SPACING_EM = 0.07
export const ICICLE_DENSITY = 0.75 // chance each slot gets an icicle
export const ICICLE_MAX = 9
export const ICICLE_LEN_MIN_EM = 0.08
export const ICICLE_LEN_MAX_EM = 0.36
export const ICICLE_MIN_PX = 4
export const ICICLE_WIDTH_MIN_EM = 0.025
export const ICICLE_WIDTH_MAX_EM = 0.05
export const ICICLE_LEAN_EM = 0.015
export const ICICLE_COLOR = "#d9eeff"
export const ICICLE_BASE_ALPHA = 0.75
export const ICICLE_TIP_ALPHA = 0.12
export const ICICLE_HIGHLIGHT = "#ffffff"
export const ICICLE_HIGHLIGHT_ALPHA = 0.55

// ---- Snow caps --------------------------------------------------------------
export const SNOW_NORMAL_MIN = 0.7 // edge must face this much upward
export const SNOW_MIN_RUN_EM = 0.08
export const SNOW_HEIGHT_MIN_EM = 0.03
export const SNOW_HEIGHT_MAX_EM = 0.07
export const SNOW_MAX_ASPECT = 0.3 // cap height ≤ this × run length
export const SNOW_PROFILE_POWER = 0.55 // <1 = flatter, fuller mound
export const SNOW_BUMPINESS = 0.18
export const SNOW_OVERLAP_PX = 1.5 // tuck the cap into the edge
export const SNOW_COLOR = "#f7fbff"
export const SNOW_SHADE = "#bcd6f0"
export const SNOW_ALPHA = 0.95

// ---- Filigree ---------------------------------------------------------------
export const TENDRILS_PER_EM2 = 14 // tendril count scales with glyph ink area
export const TENDRIL_COUNT_MIN = 3
export const TENDRIL_COUNT_MAX = 6
export const SMALL_GLYPH_AREA_EM2 = 0.03 // punctuation: below this, 1–2 tendrils
export const TENDRIL_LENGTH_MIN_EM = 0.7
export const TENDRIL_LENGTH_MAX_EM = 1.1
export const TENDRIL_REF_AREA_EM2 = 0.2 // smaller glyphs get proportionally shorter tendrils
export const TENDRIL_MIN_LENGTH_SCALE = 0.35
export const TENDRIL_ATTEMPTS = 6 // walks tried per tendril; the one that stays inside best wins
export const START_MIN_EDGE_EM = 0.02 // start points sit at least this deep inside
export const START_SPACING_EM = 0.18 // between tendril start points

export const STEP_EM = 0.01 // walk step
export const NOISE_SCALE = 3 // steering noise cycles per em of path
export const STEER_STRENGTH = 14 // rad per em at full noise
export const EDGE_MARGIN = 3 // px; steer back before coming this close to the edge
export const LOOKAHEAD_EM = 0.05
export const AVOID_GAIN = 2.5
export const MAX_TURN_EM = 25 // rad per em, how hard avoidance can turn

export const CURL_FRACTION = 0.22 // final part of the tendril that winds into a spiral
export const CURL_TURNS = 1.5 // total extra turning in the curl
export const CURL_POWER = 1 // curvature ramp: 1 = linear (Euler spiral)
export const CURL_MIN_RADIUS_PX = 1.6

export const LEAFLET_SECTION = [0.16, 0.74] as const // fraction of tendril length
export const LEAFLET_SPACING_EM = 0.045
export const LEAFLET_ANGLE = Math.PI / 3 // 60° toward the tip
export const LEAFLET_LENGTH_EM = 0.045
export const LEAFLET_CURVE = 0.12
export const LEAFLET_MIN_PX = 1.8
export const ENVELOPE_PEAK = 0.35 // where along the section leaflets are longest
export const ENVELOPE_BASE = 0.35 // relative length at the start of the section
export const ENVELOPE_TIP_POWER = 1.3

export const STROKE_REF_FONT_PX = 150 // widths below are at this font size
export const STROKE_MIN_SCALE = 0.5
export const STROKE_MAX_SCALE = 1.5
export const TENDRIL_WIDTH_BASE = 1.8
export const TENDRIL_WIDTH_TIP = 0.35
export const LEAFLET_WIDTH_BASE = 0.9
export const LEAFLET_WIDTH_TIP = 0.25

export const FILIGREE_COLOR = "#eaf6ff"
export const FILIGREE_ALPHA = 0.85
export const FILIGREE_SHADOW = "#2f6bb8"
export const FILIGREE_SHADOW_ALPHA = 0.35
export const FILIGREE_SHADOW_OFFSET = 1 // px down-right
export const FILIGREE_OVERFLOW_PX = 1 // clip allowance past the glyph edge
