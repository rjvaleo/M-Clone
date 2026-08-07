// ─── SCALE LIBRARY ───────────────────────────────────────────────────────────
// Each scale defined as cent values per degree from root
// These are TRUE intervals — not approximated to 12-TET

const SCALES = [
  // WESTERN DIATONIC MODES (12-TET)
  {
    cat: "WESTERN DIATONIC — 12-TET",
    name: "Ionian (Major)",
    info: "Western · 7 notes",
    cents: [0, 200, 400, 500, 700, 900, 1100],
  },
  {
    cat: "WESTERN DIATONIC — 12-TET",
    name: "Dorian",
    info: "Western/Medieval · 7 notes",
    cents: [0, 200, 300, 500, 700, 900, 1000],
  },
  {
    cat: "WESTERN DIATONIC — 12-TET",
    name: "Phrygian",
    info: "Western/Medieval · 7 notes",
    cents: [0, 100, 300, 500, 700, 800, 1000],
  },
  {
    cat: "WESTERN DIATONIC — 12-TET",
    name: "Lydian",
    info: "Western/Medieval · 7 notes",
    cents: [0, 200, 400, 600, 700, 900, 1100],
  },
  {
    cat: "WESTERN DIATONIC — 12-TET",
    name: "Mixolydian",
    info: "Western/Medieval · 7 notes",
    cents: [0, 200, 400, 500, 700, 900, 1000],
  },
  {
    cat: "WESTERN DIATONIC — 12-TET",
    name: "Aeolian (Natural Minor)",
    info: "Western · 7 notes",
    cents: [0, 200, 300, 500, 700, 800, 1000],
  },
  {
    cat: "WESTERN DIATONIC — 12-TET",
    name: "Locrian",
    info: "Western/Medieval · 7 notes",
    cents: [0, 100, 300, 500, 600, 800, 1000],
  },

  // WESTERN EXTENDED (12-TET)
  {
    cat: "WESTERN EXTENDED — 12-TET",
    name: "Harmonic Minor",
    info: "Western · 7 notes",
    cents: [0, 200, 300, 500, 700, 800, 1100],
  },
  {
    cat: "WESTERN EXTENDED — 12-TET",
    name: "Melodic Minor (ascending)",
    info: "Western · 7 notes",
    cents: [0, 200, 300, 500, 700, 900, 1100],
  },
  {
    cat: "WESTERN EXTENDED — 12-TET",
    name: "Major Pentatonic",
    info: "Global · 5 notes",
    cents: [0, 200, 400, 700, 900],
  },
  {
    cat: "WESTERN EXTENDED — 12-TET",
    name: "Minor Pentatonic",
    info: "Global · 5 notes",
    cents: [0, 300, 500, 700, 1000],
  },
  {
    cat: "WESTERN EXTENDED — 12-TET",
    name: "Blues Scale",
    info: "American · 6 notes",
    cents: [0, 300, 500, 600, 700, 1000],
  },
  {
    cat: "WESTERN EXTENDED — 12-TET",
    name: "Whole Tone",
    info: "French Impressionist · 6 notes",
    cents: [0, 200, 400, 600, 800, 1000],
  },
  {
    cat: "WESTERN EXTENDED — 12-TET",
    name: "Diminished (Half-Whole)",
    info: "Jazz · 8 notes",
    cents: [0, 100, 300, 400, 600, 700, 900, 1000],
  },
  {
    cat: "WESTERN EXTENDED — 12-TET",
    name: "Diminished (Whole-Half)",
    info: "Jazz · 8 notes",
    cents: [0, 200, 300, 500, 600, 800, 900, 1100],
  },
  {
    cat: "WESTERN EXTENDED — 12-TET",
    name: "Double Harmonic (Byzantine)",
    info: "Eastern/Western · 7 notes",
    cents: [0, 100, 400, 500, 700, 800, 1100],
  },
  {
    cat: "WESTERN EXTENDED — 12-TET",
    name: "Hungarian Minor",
    info: "Eastern European · 7 notes",
    cents: [0, 200, 300, 600, 700, 800, 1100],
  },
  {
    cat: "WESTERN EXTENDED — 12-TET",
    name: "Spanish Phrygian Dominant",
    info: "Flamenco/Middle Eastern · 7 notes",
    cents: [0, 100, 400, 500, 700, 800, 1000],
  },
  {
    cat: "WESTERN EXTENDED — 12-TET",
    name: "Persian",
    info: "Middle Eastern · 7 notes",
    cents: [0, 100, 400, 500, 600, 800, 1100],
  },
  {
    cat: "WESTERN EXTENDED — 12-TET",
    name: "Prometheus (Scriabin)",
    info: "Western · 6 notes",
    cents: [0, 200, 400, 600, 900, 1000],
  },
  {
    cat: "WESTERN EXTENDED — 12-TET",
    name: "Augmented Scale",
    info: "Western · 6 notes",
    cents: [0, 300, 400, 700, 800, 1100],
  },
  {
    cat: "WESTERN EXTENDED — 12-TET",
    name: "Enigmatic",
    info: "Western/Verdi · 7 notes",
    cents: [0, 100, 400, 600, 800, 1000, 1100],
  },
  {
    cat: "WESTERN EXTENDED — 12-TET",
    name: "Neapolitan Major",
    info: "Western · 7 notes",
    cents: [0, 100, 300, 500, 700, 900, 1100],
  },
  {
    cat: "WESTERN EXTENDED — 12-TET",
    name: "Neapolitan Minor",
    info: "Western · 7 notes",
    cents: [0, 100, 300, 500, 700, 800, 1100],
  },
  {
    cat: "WESTERN EXTENDED — 12-TET",
    name: "Romanian Minor",
    info: "Eastern European · 7 notes",
    cents: [0, 200, 300, 600, 700, 900, 1000],
  },
  {
    cat: "WESTERN EXTENDED — 12-TET",
    name: "Bebop Dominant",
    info: "Jazz · 8 notes",
    cents: [0, 200, 400, 500, 700, 900, 1000, 1100],
  },
  {
    cat: "WESTERN EXTENDED — 12-TET",
    name: "Bebop Major",
    info: "Jazz · 8 notes",
    cents: [0, 200, 400, 500, 700, 800, 900, 1100],
  },

  // JUST INTONATION — TRUE RATIOS
  {
    cat: "JUST INTONATION — TRUE RATIOS",
    name: "Pythagorean Tuning",
    info: "Ancient Greek · 12 notes · 3-limit",
    cents: [
      0, 114.0, 204.0, 294.1, 408.0, 498.0, 612.0, 702.0, 816.0, 906.1, 996.1,
      1110.0,
    ],
  },
  {
    cat: "JUST INTONATION — TRUE RATIOS",
    name: "Ptolemy's Intense Diatonic (Just Major)",
    info: "Ancient Greek · 7 notes · 5-limit",
    cents: [0, 203.9, 386.3, 498.0, 702.0, 884.4, 1088.3],
  },
  {
    cat: "JUST INTONATION — TRUE RATIOS",
    name: "Ptolemy's Soft Diatonic",
    info: "Ancient Greek · 7 notes",
    cents: [0, 182.4, 386.3, 498.0, 702.0, 884.4, 1086.8],
  },
  {
    cat: "JUST INTONATION — TRUE RATIOS",
    name: "Five-Limit Just Intonation",
    info: "Historical · 12 notes · 5-limit",
    cents: [
      0, 111.7, 203.9, 315.6, 386.3, 498.0, 590.2, 702.0, 813.7, 884.4, 996.1,
      1088.3,
    ],
  },
  {
    cat: "JUST INTONATION — TRUE RATIOS",
    name: "Seven-Limit Just Intonation",
    info: "Contemporary · 12 notes · 7-limit",
    cents: [
      0, 119.4, 203.9, 231.2, 386.3, 470.8, 582.5, 702.0, 764.9, 884.4, 968.8,
      1017.6,
    ],
  },
  {
    cat: "JUST INTONATION — TRUE RATIOS",
    name: "Harmonic Series (partials 1–16)",
    info: "Universal/Overtone-based · 15 notes",
    cents: [
      0, 203.9, 386.3, 498.0, 582.5, 702.0, 772.6, 840.5, 884.4, 968.8, 1017.6,
      1049.4, 1088.3, 1145.0, 1200.0,
    ].slice(0, 14),
  },
  {
    cat: "JUST INTONATION — TRUE RATIOS",
    name: "Partch 43-Tone Scale (first octave)",
    info: "Harry Partch · 43 notes · 11-limit",
    cents: [
      0, 21.5, 35.7, 49.4, 63.2, 84.5, 111.7, 119.4, 139.5, 155.1, 168.9, 203.9,
      222.5, 231.2, 266.9, 274.6, 294.1, 315.6, 333.8, 345.0, 386.3, 413.6,
      422.1, 470.8, 498.0, 519.5, 529.0, 551.3, 582.5, 600.9, 617.5, 631.3,
      649.0, 672.0, 700.0, 722.0, 741.2, 764.9, 772.6, 784.1, 813.7, 840.5,
      884.4, 906.1, 914.8, 932.5, 996.1, 1017.6,
    ].slice(0, 20),
  },

  // HISTORICAL TEMPERAMENTS
  {
    cat: "HISTORICAL TEMPERAMENTS",
    name: "Meantone (Quarter-Comma)",
    info: "Renaissance/Baroque · 12 notes",
    cents: [
      0, 76.0, 193.2, 310.3, 386.3, 503.4, 579.5, 696.6, 772.6, 889.7, 1006.8,
      1082.9,
    ],
  },
  {
    cat: "HISTORICAL TEMPERAMENTS",
    name: "Werckmeister III",
    info: "Baroque · 12 notes · J.S. Bach era",
    cents: [
      0, 90.2, 192.0, 294.1, 390.2, 498.0, 588.3, 696.1, 792.2, 888.3, 996.1,
      1092.2,
    ],
  },
  {
    cat: "HISTORICAL TEMPERAMENTS",
    name: "Kirnberger III",
    info: "18th century German · 12 notes",
    cents: [
      0, 90.2, 203.9, 294.1, 386.3, 498.0, 590.2, 702.0, 792.2, 895.1, 996.1,
      1088.3,
    ],
  },
  {
    cat: "HISTORICAL TEMPERAMENTS",
    name: "Vallotti Temperament",
    info: "18th century Italian · 12 notes",
    cents: [
      0, 94.1, 196.1, 298.0, 392.2, 501.9, 594.1, 698.0, 796.1, 894.1, 1000.0,
      1094.1,
    ],
  },
  {
    cat: "HISTORICAL TEMPERAMENTS",
    name: "19-EDO",
    info: "Renaissance onward · 19 equal divisions",
    cents: Array.from({ length: 19 }, (_, i) => i * (1200 / 19)),
  },
  {
    cat: "HISTORICAL TEMPERAMENTS",
    name: "31-EDO",
    info: "Theoretical/Huygens · 31 equal divisions",
    cents: Array.from({ length: 31 }, (_, i) => i * (1200 / 31)),
  },
  {
    cat: "HISTORICAL TEMPERAMENTS",
    name: "53-EDO",
    info: "Theoretical · 53 equal divisions",
    cents: Array.from({ length: 53 }, (_, i) => i * (1200 / 53)).slice(0, 12),
  },

  // MICROTONAL AND CONTEMPORARY
  {
    cat: "MICROTONAL & CONTEMPORARY",
    name: "Quarter-Tone Scale (24-EDO)",
    info: "Middle Eastern/Contemporary · 24 divisions",
    cents: Array.from({ length: 24 }, (_, i) => i * 50),
  },
  {
    cat: "MICROTONAL & CONTEMPORARY",
    name: "17-EDO",
    info: "Arabic approximation · 17 equal divisions",
    cents: Array.from({ length: 17 }, (_, i) => i * (1200 / 17)),
  },
  {
    cat: "MICROTONAL & CONTEMPORARY",
    name: "22-EDO",
    info: "Indian sruti approximation · 22 equal divisions",
    cents: Array.from({ length: 22 }, (_, i) => i * (1200 / 22)),
  },
  {
    cat: "MICROTONAL & CONTEMPORARY",
    name: "72-EDO",
    info: "Franz Richter Herf · 72 divisions · sixth-tones",
    cents: Array.from({ length: 72 }, (_, i) => i * (1200 / 72)).slice(0, 13),
  },
  {
    cat: "MICROTONAL & CONTEMPORARY",
    name: "Wendy Carlos Alpha",
    info: "1986 Beauty in the Beast · 15.39¢/step",
    cents: Array.from({ length: 19 }, (_, i) => i * 15.39),
  },
  {
    cat: "MICROTONAL & CONTEMPORARY",
    name: "Wendy Carlos Beta",
    info: "1986 · 18.75¢/step",
    cents: Array.from({ length: 16 }, (_, i) => i * 18.75),
  },
  {
    cat: "MICROTONAL & CONTEMPORARY",
    name: "Bohlen-Pierce Scale",
    info: "Bohlen/Pierce · 13 divisions of tritave (3:1)",
    cents: Array.from({ length: 13 }, (_, i) => i * (1902 / 13)),
  },

  // MIDDLE EASTERN / MAQAM
  {
    cat: "MIDDLE EASTERN — MAQAM",
    name: "Maqam Rast",
    info: "Arabic/Turkish · 7 notes · neutral third",
    cents: [0, 204, 351, 498, 702, 906, 1053],
  },
  {
    cat: "MIDDLE EASTERN — MAQAM",
    name: "Maqam Bayati",
    info: "Arabic/Turkish · 7 notes · neutral second",
    cents: [0, 150, 300, 498, 702, 852, 1002],
  },
  {
    cat: "MIDDLE EASTERN — MAQAM",
    name: "Maqam Hijaz",
    info: "Arabic/Turkish · 7 notes · augmented second",
    cents: [0, 100, 400, 500, 700, 800, 1000],
  },
  {
    cat: "MIDDLE EASTERN — MAQAM",
    name: "Maqam Hijaz Kar",
    info: "Arabic · 7 notes · double augmented second",
    cents: [0, 100, 400, 500, 700, 800, 1100],
  },
  {
    cat: "MIDDLE EASTERN — MAQAM",
    name: "Maqam Saba",
    info: "Arabic · 7 notes · very low third",
    cents: [0, 150, 280, 498, 648, 798, 1002],
  },
  {
    cat: "MIDDLE EASTERN — MAQAM",
    name: "Maqam Sikah",
    info: "Arabic/Turkish · built on neutral third",
    cents: [0, 204, 351, 551, 702, 853, 1002],
  },
  {
    cat: "MIDDLE EASTERN — MAQAM",
    name: "Maqam Nahawand",
    info: "Arabic · 7 notes · harmonic minor character",
    cents: [0, 200, 300, 500, 700, 800, 1100],
  },
  {
    cat: "MIDDLE EASTERN — MAQAM",
    name: "Maqam Nawa Athar",
    info: "Arabic · 7 notes",
    cents: [0, 200, 300, 600, 700, 800, 1100],
  },
  {
    cat: "MIDDLE EASTERN — MAQAM",
    name: "Makam Ussak",
    info: "Turkish · 7 notes · microtonal inflections",
    cents: [0, 150, 300, 500, 700, 850, 1000],
  },
  {
    cat: "MIDDLE EASTERN — MAQAM",
    name: "Persian Shur",
    info: "Iranian classical · 7 notes",
    cents: [0, 150, 300, 500, 700, 800, 1000],
  },
  {
    cat: "MIDDLE EASTERN — MAQAM",
    name: "Persian Chahargah",
    info: "Iranian · 7 notes",
    cents: [0, 200, 350, 500, 700, 900, 1050],
  },
  {
    cat: "MIDDLE EASTERN — MAQAM",
    name: "Persian Segah",
    info: "Iranian · 7 notes",
    cents: [0, 150, 350, 500, 700, 850, 1050],
  },

  // SOUTH & EAST ASIAN
  {
    cat: "SOUTH & EAST ASIAN",
    name: "Raga Bhairav",
    info: "Indian Hindustani · 7 notes · morning raga",
    cents: [0, 100, 400, 500, 700, 800, 1100],
  },
  {
    cat: "SOUTH & EAST ASIAN",
    name: "Raga Bhairavi",
    info: "Indian classical · 7 notes · all flat",
    cents: [0, 100, 300, 500, 700, 800, 1000],
  },
  {
    cat: "SOUTH & EAST ASIAN",
    name: "Raga Yaman (Kalyan)",
    info: "Indian classical · 7 notes · raised fourth · evening",
    cents: [0, 200, 400, 600, 700, 900, 1100],
  },
  {
    cat: "SOUTH & EAST ASIAN",
    name: "Raga Kafi",
    info: "Indian classical · 7 notes · Dorian with microtones",
    cents: [0, 200, 290, 500, 700, 900, 980],
  },
  {
    cat: "SOUTH & EAST ASIAN",
    name: "Raga Todi",
    info: "Indian classical · 7 notes · complex microtonal",
    cents: [0, 100, 300, 600, 700, 800, 1100],
  },
  {
    cat: "SOUTH & EAST ASIAN",
    name: "Raga Marwa",
    info: "Indian classical · 7 notes · no perfect fifth",
    cents: [0, 100, 400, 600, 900, 1100, 0],
  },
  {
    cat: "SOUTH & EAST ASIAN",
    name: "Raga Asavari",
    info: "Indian classical · 7 notes · descending emphasis",
    cents: [0, 200, 300, 500, 700, 800, 1000],
  },
  {
    cat: "SOUTH & EAST ASIAN",
    name: "22-Shruti Scale",
    info: "Indian classical theory · 22 microtones",
    cents: [
      0, 22, 90, 112, 182, 204, 270, 294, 316, 386, 408, 498, 520, 590, 612,
      702, 724, 792, 814, 884, 906, 996,
    ],
  },
  {
    cat: "SOUTH & EAST ASIAN",
    name: "Slendro (Javanese Gamelan)",
    info: "Java/Bali · 5 notes · non-equal spacing",
    cents: [0, 231, 474, 711, 951],
  },
  {
    cat: "SOUTH & EAST ASIAN",
    name: "Pelog (Javanese Gamelan)",
    info: "Java/Bali · 7 notes · highly unequal",
    cents: [0, 122, 271, 540, 675, 785, 947],
  },
  {
    cat: "SOUTH & EAST ASIAN",
    name: "Pelog Selisir (Balinese)",
    info: "Balinese Gamelan · 5-note Pelog mode",
    cents: [0, 122, 271, 675, 785],
  },
  {
    cat: "SOUTH & EAST ASIAN",
    name: "Japanese In Scale",
    info: "Japanese traditional · 5 notes · hemitonic",
    cents: [0, 100, 500, 700, 800],
  },
  {
    cat: "SOUTH & EAST ASIAN",
    name: "Japanese Yo Scale (Gagaku)",
    info: "Japanese · 5 notes · anhemitonic",
    cents: [0, 200, 500, 700, 900],
  },
  {
    cat: "SOUTH & EAST ASIAN",
    name: "Japanese Hirajoshi",
    info: "Japanese Koto · 5 notes · dark",
    cents: [0, 200, 300, 700, 800],
  },
  {
    cat: "SOUTH & EAST ASIAN",
    name: "Japanese Insen",
    info: "Japanese · 5 notes · very sparse",
    cents: [0, 100, 500, 700, 1000],
  },
  {
    cat: "SOUTH & EAST ASIAN",
    name: "Chinese Gong (Major Pentatonic)",
    info: "Chinese traditional · 5 notes",
    cents: [0, 204, 408, 702, 906],
  },
  {
    cat: "SOUTH & EAST ASIAN",
    name: "Chinese Yu (Minor Pentatonic)",
    info: "Chinese traditional · 5 notes",
    cents: [0, 294, 498, 702, 996],
  },
  {
    cat: "SOUTH & EAST ASIAN",
    name: "Mongolian Pentatonic",
    info: "Central Asian · 5 notes",
    cents: [0, 200, 400, 700, 900],
  },
  {
    cat: "SOUTH & EAST ASIAN",
    name: "Thai Ranat Scale",
    info: "Thai traditional · 7 near-equidistant tones",
    cents: [0, 171, 343, 514, 686, 857, 1029],
  },
  {
    cat: "SOUTH & EAST ASIAN",
    name: "Gamelan Degung (Sundanese)",
    info: "West Java · 5 notes",
    cents: [0, 176, 410, 702, 878],
  },
  {
    cat: "SOUTH & EAST ASIAN",
    name: "Sanfen Sunyi (Chinese Pythagorean)",
    info: "Ancient Chinese · 12 notes · stacked fifths",
    cents: [0, 114, 204, 294, 408, 498, 612, 702, 816, 906, 996, 1110],
  },
];

// ─── STATE ───────────────────────────────────────────────────────────────────
let audioCtx = null;
let masterGain = null;
let isPlaying = false;
let currentStep = 0;
let schedulerTimer = null;
let nextNoteTime = 0;
let nextBeatTime = 0;
let beatCounter = 1;
let bpm = 120;
let stepBeats = 0.5; // 1/8 note
let numSteps = 8;
let direction = "fwd";
let pingDir = 1;
let waveType = "sine";
let adsr = { a: 10, d: 80, s: 0.6, r: 200 };
let volume = 0.7;
let selectedScaleIdx = 0;
let rootHz = 440.0;
let rootMidi = 9; // A
let rootOctave = 4;
let playingStepIdx = -1;
let metronomeOn = false;
let metronomeClickBuffer = null;

// ─── FILTER + LFO STATE ──────────────────────────────────────────────────────
let filterCutoff = 2046; // Hz (log-scale, slider default=67)
let filterRes = 2.09; // Q factor
let filterNode = null;
let pulseWidth = 0.5; // base duty cycle for pulse wave
let currentPW = 0.5; // LFO-modulated pulse width

// ─── LFO STATE (2 modular LFOs) ──────────────────────────────────────────────
const LFO_COLORS = ["#ff6b35", "#00e5ff"];
const lfos = [
  {
    rate: 1.0,
    depth: 0.2,
    wave: "sine",
    target: "filter",
    phase: 0,
    animPhase: 0,
    animId: null,
    osc: null,
    gainNode: null,
  },
  {
    rate: 0.55,
    depth: 0.25,
    wave: "sine",
    target: "pw",
    phase: 0,
    animPhase: 0,
    animId: null,
    osc: null,
    gainNode: null,
  },
];

// ─── FILTER ADSR STATE ───────────────────────────────────────────────────────
let filterADSR = { a: 10, d: 150, s: 0.3, r: 300 };
let filterADSRamt = 0.5; // -1..+1 (mapped from -100..+100 slider)

// ─── KEY FOLLOW STATE ────────────────────────────────────────────────────────
let keyFollow = 0.0; // 0..1 (slider 0–100)
// Reference MIDI note for key-follow (centre of keyboard, C4 = MIDI 60)
const KEY_FOLLOW_REF_MIDI = 60;

// ─── REVERB STATE ────────────────────────────────────────────────────────────
const COMB_DELAYS_S = [0.0833, 0.1009, 0.1151, 0.1271, 0.1493, 0.1913];
let reverbWet = 0.6; // matches HTML slider default of 60%
let reverbDecay = 0.7; // 0..1 → RT60 0.5s..30s
let reverbPreDelay = 0.1; // 0..1 → 0..150ms
let reverbDamp = 0.4; // 0..1 → 500Hz..20kHz comb hi-cut
let reverbShimmer = 0.5; // 0..1 → chorus LFO depth
let reverbSpread = 0.8; // 0..1 → stereo pan ±
let reverbPreDelayNode = null;
let reverbSendGain = null;
let reverbWetGain = null;
let reverbSumGain = null;
let reverbCombFbGains = [];
let reverbCombHiCutNodes = [];
let reverbChorusGainNodes = [];
let reverbChorusLFONodes = [];
let reverbAPFbNodes = [];
let reverbPhaserLFO = null;
let reverbPhaserLFOGain = null;
let reverbOutAP = [];
let reverbLimiter = null;
let reverbShimmerLFO = null;
let reverbShimmerGain = null;
let reverbPanL = null;
let reverbPanR = null;
const MAX_STEPS = 64;

// ─── DELAY STATE ─────────────────────────────────────────────────────────────
let delaySubdiv = 0.5; // beats (1/8 note default)
let delayFeedback = 0.35;
let delayWet = 0.25;
let delaySpread = 1.0;
let delayHiCutFreq = 6300;
let delayDryGain = null;
let delayWetGain = null;
let delayL = null,
  delayR = null;
let delayPanL = null,
  delayPanR = null;
let delayHiCutLR = null,
  delayHiCutRL = null;
let delayFbGainLR = null,
  delayFbGainRL = null;
let ppAnimId = null;

// ─── MORPH STATE ─────────────────────────────────────────────────────────────
let morphDuration = 5.0; // seconds
let morphRafId = null;

// ─── CAPTURE STATE ────────────────────────────────────────────────────────────
let captureDestNode = null;
let mediaRecorder = null;
let captureChunks = [];
let captureTimerInterval = null;
let captureStartTime = 0;

// Step data: array of { degree: number, rest: boolean }
let steps = Array.from({ length: MAX_STEPS }, (_, i) => ({
  degree: i % 7,
  rest: false,
}));

// ─── AUDIO SETUP ─────────────────────────────────────────────────────────────
function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = volume * 0.3;
  filterNode = audioCtx.createBiquadFilter();
  filterNode.type = "lowpass";
  filterNode.frequency.value = filterCutoff;
  filterNode.Q.value = filterRes;
  masterGain.connect(audioCtx.destination);

  // ── Capture destination (MediaRecorder taps here) ────────────────────────
  captureDestNode = audioCtx.createMediaStreamDestination();
  masterGain.connect(captureDestNode);

  // Dry path: filter → dryGain → masterGain
  delayDryGain = audioCtx.createGain();
  delayDryGain.gain.value = 1 - delayWet;
  filterNode.connect(delayDryGain);
  delayDryGain.connect(masterGain);

  // Ping-pong delay wet path
  delayL = audioCtx.createDelay(4.0);
  delayR = audioCtx.createDelay(4.0);
  const dTime = (60 / bpm) * delaySubdiv;
  delayL.delayTime.value = dTime;
  delayR.delayTime.value = dTime;
  delayPanL = audioCtx.createStereoPanner();
  delayPanR = audioCtx.createStereoPanner();
  delayPanL.pan.value = -delaySpread;
  delayPanR.pan.value = delaySpread;
  delayWetGain = audioCtx.createGain();
  delayWetGain.gain.value = delayWet;
  delayWetGain.connect(masterGain);
  delayHiCutLR = audioCtx.createBiquadFilter();
  delayHiCutLR.type = "lowpass";
  delayHiCutLR.Q.value = 0.5;
  delayHiCutLR.frequency.value = delayHiCutFreq;
  delayHiCutRL = audioCtx.createBiquadFilter();
  delayHiCutRL.type = "lowpass";
  delayHiCutRL.Q.value = 0.5;
  delayHiCutRL.frequency.value = delayHiCutFreq;
  delayFbGainLR = audioCtx.createGain();
  delayFbGainLR.gain.value = delayFeedback;
  delayFbGainRL = audioCtx.createGain();
  delayFbGainRL.gain.value = delayFeedback;
  // Graph: input → delayL → panL → wetOut
  //               delayL → hiCut → fbGain → delayR → panR → wetOut
  //               delayR → hiCut → fbGain → delayL  (ping-pong loop)
  filterNode.connect(delayL);
  delayL.connect(delayPanL);
  delayPanL.connect(delayWetGain);
  delayL.connect(delayHiCutLR);
  delayHiCutLR.connect(delayFbGainLR);
  delayFbGainLR.connect(delayR);
  delayR.connect(delayPanR);
  delayPanR.connect(delayWetGain);
  delayR.connect(delayHiCutRL);
  delayHiCutRL.connect(delayFbGainRL);
  delayFbGainRL.connect(delayL);

  // ── Cathedral Reverb (parallel with delay) ───────────────────────────────
  // DISABLED — TODO: revisit gain staging and re-enable
  // To re-enable: remove the surrounding /* */ block comment
  /*
  // Plain Schroeder: 6 parallel comb filters → 2 allpass diffusers → stereo spread.
  // NO modulation inside any feedback path — unconditionally stable.
  // Shimmer: single slow LFO on the OUTPUT allpass only (not in any feedback loop).
  reverbPreDelayNode = audioCtx.createDelay(0.15);
  reverbPreDelayNode.delayTime.value = reverbPreDelay * 0.15;
  filterNode.connect(reverbPreDelayNode);

  reverbSendGain = audioCtx.createGain();
  reverbSendGain.gain.value = 1.0; // parallel send — full level, doesn't affect dry path
  reverbPreDelayNode.connect(reverbSendGain);

  reverbWetGain = audioCtx.createGain();
  reverbWetGain.gain.value = reverbWet; // WET slider controls output mix level
  reverbWetGain.connect(masterGain);
  reverbWetGain.connect(captureDestNode);

  // Soft limiter after comb bank sum — prevents runaway, preserves tail character
  reverbLimiter = audioCtx.createDynamicsCompressor();
  reverbLimiter.threshold.value = -3; // -3 dBFS, not -6
  reverbLimiter.knee.value = 6; // soft knee
  reverbLimiter.ratio.value = 6; // 6:1 — softens, not bricks
  reverbLimiter.attack.value = 0.005; // 5 ms — doesn't suppress transient onset
  reverbLimiter.release.value = 0.4; // 400 ms — lets tail breathe

  reverbSumGain = audioCtx.createGain();
  reverbSumGain.gain.value = 0.5; // raised from 0.2 — first echoes now ~0.5 amplitude at limiter input

  // Two output allpass diffusers (outside feedback — safe)
  reverbOutAP[0] = audioCtx.createBiquadFilter();
  reverbOutAP[0].type = "allpass";
  reverbOutAP[0].frequency.value = 556;
  reverbOutAP[0].Q.value = 0.7;
  reverbOutAP[1] = audioCtx.createBiquadFilter();
  reverbOutAP[1].type = "allpass";
  reverbOutAP[1].frequency.value = 2234;
  reverbOutAP[1].Q.value = 0.7;
  reverbSumGain.connect(reverbLimiter);
  reverbLimiter.connect(reverbOutAP[0]);
  reverbOutAP[0].connect(reverbOutAP[1]);

  // Stereo spread
  reverbPanL = audioCtx.createStereoPanner();
  reverbPanL.pan.value = -reverbSpread;
  reverbPanR = audioCtx.createStereoPanner();
  reverbPanR.pan.value = reverbSpread;
  reverbOutAP[1].connect(reverbPanL);
  reverbOutAP[1].connect(reverbPanR);
  reverbPanL.connect(reverbWetGain);
  reverbPanR.connect(reverbWetGain);

  // Shimmer LFO — modulates output diffuser frequency only, NOT in any feedback path
  reverbShimmerLFO = audioCtx.createOscillator();
  reverbShimmerLFO.type = "triangle";
  reverbShimmerLFO.frequency.value = 0.17;
  reverbShimmerGain = audioCtx.createGain();
  reverbShimmerGain.gain.value = reverbShimmer * 200;
  reverbShimmerLFO.connect(reverbShimmerGain);
  reverbShimmerGain.connect(reverbOutAP[0].frequency);
  reverbShimmerLFO.start();

  // 6 plain Schroeder combs: delay → lowpass(damp) → feedback_gain → delay
  const initDampFreq = 500 * Math.pow(40, reverbDamp);
  const initRt60 = 0.5 + reverbDecay * 29.5;
  for (let c = 0; c < COMB_DELAYS_S.length; c++) {
    const dNode = audioCtx.createDelay(4.0);
    dNode.delayTime.value = COMB_DELAYS_S[c];
    const lp = audioCtx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = initDampFreq;
    lp.Q.value = 0.5;
    reverbCombHiCutNodes.push(lp);
    const fb = audioCtx.createGain();
    fb.gain.value = Math.min(
      0.8,
      Math.pow(10, (-3 * COMB_DELAYS_S[c]) / initRt60),
    );
    reverbCombFbGains.push(fb);
    reverbSendGain.connect(dNode);
    dNode.connect(reverbSumGain);
    // Feedback path: dNode → lp → fb → dNode  (no extra nodes, no modulation)
    dNode.connect(lp);
    lp.connect(fb);
    fb.connect(dNode);
  }
  */

  // Initialize all 4 LFO oscillators and connect to their targets
  lfos.forEach((lfo, i) => {
    lfo.osc = audioCtx.createOscillator();
    lfo.gainNode = audioCtx.createGain();
    lfo.osc.type = lfo.wave;
    lfo.osc.frequency.value = lfo.rate;
    lfo.gainNode.gain.value = 0;
    lfo.osc.connect(lfo.gainNode);
    lfo.osc.start();
    connectLFO(i);
  });
}

function playNote(freq, time) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const env = audioCtx.createGain();
  if (waveType === "pulse") {
    osc.setPeriodicWave(buildPulseWave(currentPW));
  } else {
    osc.type = waveType;
  }
  osc.frequency.value = freq;
  osc.connect(env);
  env.connect(filterNode);
  const a = adsr.a / 1000;
  const d = adsr.d / 1000;
  const s = adsr.s;
  const r = adsr.r / 1000;
  const stepDur = (60 / bpm) * stepBeats;
  const noteDur = stepDur * 0.85;
  env.gain.setValueAtTime(0, time);
  env.gain.linearRampToValueAtTime(1, time + a);
  env.gain.linearRampToValueAtTime(s, time + a + d);
  env.gain.setValueAtTime(s, time + noteDur);
  env.gain.linearRampToValueAtTime(0, time + noteDur + r);
  osc.start(time);
  osc.stop(time + noteDur + r + 0.05);

  // ── Filter ADSR + Key-Follow per note ──────────────────────────────────────
  // Key-follow: shift cutoff by semitones relative to KEY_FOLLOW_REF_MIDI
  // freq → approximate MIDI pitch
  const noteMidi = 69 + 12 * Math.log2(freq / 440);
  const semiOffset = (noteMidi - KEY_FOLLOW_REF_MIDI) * keyFollow;
  const kfMult = Math.pow(2, semiOffset / 12);
  const baseCutoff = Math.min(20000, filterCutoff * kfMult);

  // Filter ADSR modulation: automate filterNode.frequency
  const fa = filterADSR.a / 1000;
  const fd = filterADSR.d / 1000;
  const fs = filterADSR.s;
  const fr = filterADSR.r / 1000;
  // amount: map filterADSRamt (-1..+1) to a semitone range (±48 semitones)
  const maxDelta = baseCutoff * (Math.pow(2, 4) - 1); // 4 octaves max sweep
  const peakCutoff = Math.min(
    20000,
    Math.max(20, baseCutoff + filterADSRamt * maxDelta),
  );
  const susCutoff = Math.min(
    20000,
    Math.max(20, baseCutoff + filterADSRamt * maxDelta * fs),
  );

  filterNode.frequency.cancelScheduledValues(time);
  filterNode.frequency.setValueAtTime(baseCutoff, time);
  filterNode.frequency.linearRampToValueAtTime(peakCutoff, time + fa);
  filterNode.frequency.linearRampToValueAtTime(susCutoff, time + fa + fd);
  filterNode.frequency.setValueAtTime(susCutoff, time + noteDur);
  filterNode.frequency.linearRampToValueAtTime(baseCutoff, time + noteDur + fr);
}

// ─── SCALE COMPUTATION ───────────────────────────────────────────────────────
// Convert cents offset from root to frequency
function centsToHz(rootHz, cents) {
  return rootHz * Math.pow(2, cents / 1200);
}

// Get all frequencies for current scale across 88 notes (A0 to C8)
function compute88Notes() {
  const scale = SCALES[selectedScaleIdx];
  const deg = scale.cents;
  const numDegrees = deg.length;
  // A0 = MIDI 21, C8 = MIDI 108
  const notes = [];
  for (let midi = 21; midi <= 108; midi++) {
    // Find which octave and degree this midi note falls on
    // Root is at rootMidi + rootOctave * 12 (roughly)
    const rootMidiNum = rootMidi + rootOctave * 12;
    const diff = midi - rootMidiNum;
    // Find closest degree in the scale
    // We need to find which octave and degree
    const totalCentsFromRoot = diff * 100; // 12-TET as reference for MIDI position
    // Find octave
    const scaleOctave = Math.floor(totalCentsFromRoot / 1200);
    // Find degree by finding closest scale cent
    let bestDeg = 0;
    let bestDist = Infinity;
    for (let d = 0; d < numDegrees; d++) {
      const scaleCents = deg[d] + scaleOctave * 1200;
      const dist = Math.abs(totalCentsFromRoot - scaleCents);
      if (dist < bestDist) {
        bestDist = dist;
        bestDeg = d;
      }
    }
    const inScale = bestDist < 60; // within 60 cents = "in scale"
    const trueCents = deg[bestDeg] + scaleOctave * 1200;
    const trueHz = centsToHz(rootHz, trueCents);
    notes.push({
      midi,
      inScale,
      degree: bestDeg,
      hz: trueHz,
      isRoot: bestDeg === 0 && bestDist < 30,
    });
  }
  return notes;
}

function getFreqForDegree(degree) {
  const scale = SCALES[selectedScaleIdx];
  const deg = scale.cents;
  const numDegrees = deg.length;
  const oct = Math.floor(degree / numDegrees);
  const d = degree % numDegrees;
  const cents = deg[d] + oct * 1200;
  return centsToHz(rootHz, cents);
}

// ─── SEQUENCER ───────────────────────────────────────────────────────────────
function getNextStep() {
  const active = numSteps;
  if (direction === "fwd") {
    currentStep = (currentStep + 1) % active;
  } else if (direction === "rev") {
    currentStep = (currentStep - 1 + active) % active;
  } else if (direction === "ping") {
    currentStep += pingDir;
    if (currentStep >= active) {
      currentStep = active - 2;
      pingDir = -1;
    }
    if (currentStep < 0) {
      currentStep = 1;
      pingDir = 1;
    }
  } else {
    currentStep = Math.floor(Math.random() * active);
  }
  return currentStep;
}

function scheduler() {
  const lookAhead = 0.1;
  while (nextBeatTime < audioCtx.currentTime + lookAhead) {
    const beatNum = beatCounter;
    const uiDelayMs = Math.max(0, (nextBeatTime - audioCtx.currentTime) * 1000);
    setTimeout(() => {
      updateTransportPosition(beatNum);
    }, uiDelayMs);
    beatCounter += 1;
    nextBeatTime += 60 / bpm;
  }

  while (nextNoteTime < audioCtx.currentTime + lookAhead) {
    const step = steps[currentStep];
    const stepDur = (60 / bpm) * stepBeats;
    const si = currentStep;
    const uiDelayMs = Math.max(0, (nextNoteTime - audioCtx.currentTime) * 1000);

    // Advance phases for PW-targeting LFOs and compute combined PWM modulation
    let pwMod = 0;
    lfos.forEach((lfo) => {
      if (lfo.target === "pw") {
        lfo.phase += lfo.rate * stepDur * 2 * Math.PI;
        pwMod += Math.sin(lfo.phase) * lfo.depth * 0.45;
      }
    });
    if (waveType === "pulse") {
      currentPW = Math.max(0.05, Math.min(0.95, pulseWidth + pwMod));
    }
    if (metronomeOn && si % 4 === 0) {
      playMetronomeClick(nextNoteTime);
    }
    if (!step.rest) {
      const freq = getFreqForDegree(step.degree);
      playNote(freq, nextNoteTime);
      // Update UI
      const f = freq;
      const scale = SCALES[selectedScaleIdx];
      const deg = step.degree % scale.cents.length;
      setTimeout(() => {
        updatePlayingUI(si, f, deg);
      }, uiDelayMs);
    }
    nextNoteTime += stepDur;
    getNextStep();
  }
  schedulerTimer = setTimeout(scheduler, 25);
}

function updateTransportPosition(beatNum) {
  document.getElementById("posDisplay").textContent = String(beatNum);
}

function updatePlayingUI(stepIdx, freq, deg) {
  // Clear previous
  document
    .querySelectorAll(".step")
    .forEach((s) => s.classList.remove("playing-step"));
  document
    .querySelectorAll(".kb-key")
    .forEach((k) => k.classList.remove("playing-key"));
  const stepEl = document.getElementById(`step-${stepIdx}`);
  if (stepEl) stepEl.classList.add("playing-step");
  // Find closest key on keyboard
  const notes88 = compute88Notes();
  let bestKey = -1,
    bestDist = Infinity;
  notes88.forEach((n, i) => {
    if (!n.inScale) return;
    const d = Math.abs(n.degree - deg);
    if (d < bestDist) {
      bestDist = d;
      bestKey = i;
    }
  });
  const keyEl = document.getElementById(`key-${bestKey}`);
  if (keyEl) keyEl.classList.add("playing-key");
  // Status
  document.getElementById("statusNote").textContent = `DEG ${deg + 1}`;
  document.getElementById("statusFreq").textContent = `${freq.toFixed(2)} Hz`;
  document.getElementById("statusStep").textContent = stepIdx + 1;
}

function togglePlay() {
  initAudio();
  if (isPlaying) {
    isPlaying = false;
    clearTimeout(schedulerTimer);
    document.getElementById("playBtn").textContent = "▶ PLAY";
    document.getElementById("playBtn").classList.remove("active");
  } else {
    isPlaying = true;
    currentStep = 0;
    beatCounter = 1;
    updateTransportPosition(beatCounter);
    nextBeatTime = audioCtx.currentTime + 0.05;
    nextNoteTime = audioCtx.currentTime + 0.05;
    scheduler();
    document.getElementById("playBtn").textContent = "⏸ PAUSE";
    document.getElementById("playBtn").classList.add("active");
  }
}

function stopSeq() {
  isPlaying = false;
  clearTimeout(schedulerTimer);
  currentStep = 0;
  beatCounter = 1;
  nextBeatTime = 0;
  document.getElementById("playBtn").textContent = "▶ PLAY";
  document.getElementById("playBtn").classList.remove("active");
  document
    .querySelectorAll(".step")
    .forEach((s) => s.classList.remove("playing-step"));
  document
    .querySelectorAll(".kb-key")
    .forEach((k) => k.classList.remove("playing-key"));
  document.getElementById("posDisplay").textContent = "1";
  document.getElementById("statusNote").textContent = "—";
  document.getElementById("statusFreq").textContent = "—";
  document.getElementById("statusStep").textContent = "—";
}

function playMetronomeClick(time) {
  if (!audioCtx || !masterGain) return;
  if (!metronomeClickBuffer) {
    const len = Math.max(1, Math.floor(audioCtx.sampleRate * 0.008));
    metronomeClickBuffer = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
    const data = metronomeClickBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const decay = Math.exp(-i / (len * 0.18));
      data[i] = (Math.random() * 2 - 1) * decay;
    }
  }

  const src = audioCtx.createBufferSource();
  src.buffer = metronomeClickBuffer;
  const hp = audioCtx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 1700;
  hp.Q.value = 0.7;
  const gain = audioCtx.createGain();

  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.linearRampToValueAtTime(0.22, time + 0.0008);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.012);

  src.connect(hp);
  hp.connect(gain);
  gain.connect(masterGain);
  src.start(time);
  src.stop(time + 0.015);
}

function toggleMetronome() {
  metronomeOn = !metronomeOn;
  const btn = document.getElementById("metroBtn");
  if (!btn) return;
  btn.textContent = metronomeOn ? "CLICK ON" : "CLICK OFF";
  btn.classList.toggle("active", metronomeOn);
}

// ─── CONTROLS ────────────────────────────────────────────────────────────────
function updateBPM(v) {
  bpm = parseInt(v);
  document.getElementById("bpmVal").textContent = v;
  updateDelay();
}

function updateSteps(v) {
  numSteps = parseInt(v);
  document.getElementById("stepsVal").textContent = v;
  renderStepGrid();
}

function randomizeScaleArpeggio() {
  const randomScaleIdx = Math.floor(Math.random() * SCALES.length);
  selectScale(randomScaleIdx);

  const scale = SCALES[selectedScaleIdx];
  const scaleLen = scale.cents.length;
  if (!scaleLen) return;

  const arps = [
    [0, 2, 4],
    [0, 2, 4, 6],
    [0, 3, 5],
    [0, 2, 5],
    [0, 4, 6],
  ];
  const motionModes = ["up", "updown", "rand"];
  const arp = arps[Math.floor(Math.random() * arps.length)];
  const motion = motionModes[Math.floor(Math.random() * motionModes.length)];
  const rootDeg = Math.floor(Math.random() * scaleLen);
  const baseOct = Math.floor(Math.random() * 2);
  const arpSpan = arp.length;

  for (let i = 0; i < steps.length; i++) {
    const phraseIndex = i % arpSpan;
    let patternIndex = phraseIndex;

    if (motion === "updown") {
      const period = Math.max(2, arpSpan * 2 - 2);
      const phase = i % period;
      patternIndex = phase < arpSpan ? phase : period - phase;
    } else if (motion === "rand") {
      patternIndex = Math.floor(Math.random() * arpSpan);
    }

    const degreeFromRoot = rootDeg + arp[patternIndex];
    const wrappedDeg = degreeFromRoot % scaleLen;
    const carryOct = Math.floor(degreeFromRoot / scaleLen);
    const phraseOctLift = motion === "rand" ? Math.floor(i / 8) : Math.floor(i / arpSpan) % 2;
    const oct = Math.max(0, Math.min(3, baseOct + carryOct + phraseOctLift));

    steps[i].degree = oct * scaleLen + wrappedDeg;
    steps[i].rest = false;
  }

  renderStepGrid();
}

function updateStepLen(v) {
  stepBeats = parseFloat(v);
}

function updateEnv() {
  adsr.a = parseInt(document.getElementById("atkSlider").value);
  adsr.d = parseInt(document.getElementById("decSlider").value);
  adsr.s = parseInt(document.getElementById("susSlider").value) / 100;
  adsr.r = parseInt(document.getElementById("relSlider").value);
  document.getElementById("atkVal").textContent = adsr.a + "ms";
  document.getElementById("decVal").textContent = adsr.d + "ms";
  document.getElementById("susVal").textContent =
    Math.round(adsr.s * 100) + "%";
  document.getElementById("relVal").textContent = adsr.r + "ms";
  drawADSRCanvas();
  if (window.updateKnobVisual) {
    ["atkSlider", "decSlider", "susSlider", "relSlider", "volSlider"].forEach(
      window.updateKnobVisual,
    );
  }
}

function updateVol(v) {
  volume = parseInt(v) / 100;
  document.getElementById("volVal").textContent = v + "%";
  if (masterGain) masterGain.gain.value = volume * 0.3;
}

// ─── PULSE WAVE ───────────────────────────────────────────────────────────────
function buildPulseWave(width) {
  const N = 256;
  const real = new Float32Array(N);
  const imag = new Float32Array(N);
  real[0] = 2 * width - 1; // DC offset
  for (let n = 1; n < N; n++) {
    real[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * width);
  }
  return audioCtx.createPeriodicWave(real, imag, {
    disableNormalization: false,
  });
}

function setWaveType(v) {
  waveType = v;
  const isPulse = v === "pulse";
  document.getElementById("pwGroup").style.opacity = isPulse ? "1" : "0.35";
}

function formatHzLabel(freq) {
  if (!Number.isFinite(freq)) return "--";
  return freq >= 1000
    ? (freq / 1000).toFixed(1) + "kHz"
    : Math.round(freq) + "Hz";
}

function updateFilterDebugDisplay(cutoffSliderValue = null) {
  const knobEl = document.getElementById("filterDebugKnob");
  const targetEl = document.getElementById("filterDebugTarget");
  const liveEl = document.getElementById("filterDebugLive");
  if (!knobEl || !targetEl || !liveEl) return;

  const cutoffSlider = document.getElementById("cutoffSlider");
  const knobVal =
    cutoffSliderValue === null
      ? parseFloat(cutoffSlider?.value ?? "")
      : cutoffSliderValue;

  let liveFreq = NaN;
  if (filterNode?.frequency) {
    if (typeof filterNode.frequency.getValueAtTime === "function" && audioCtx) {
      liveFreq = filterNode.frequency.getValueAtTime(audioCtx.currentTime);
    } else {
      liveFreq = filterNode.frequency.value;
    }
  }

  const knobLabel = Number.isFinite(knobVal) ? knobVal.toFixed(1) + "%" : "--";
  knobEl.textContent = "KNOB " + knobLabel;
  targetEl.textContent = "TARGET " + formatHzLabel(filterCutoff);
  liveEl.textContent = "LIVE " + formatHzLabel(liveFreq);
}

// ─── FILTER CONTROLS ──────────────────────────────────────────────────────────
function updateFilter() {
  const cv = parseFloat(document.getElementById("cutoffSlider").value);
  const rv = parseFloat(document.getElementById("resSlider").value);
  filterCutoff = 20 * Math.pow(1000, cv / 100);
  filterRes = 0.1 + (rv / 100) * 19.9;
  if (filterNode) {
    const now = audioCtx.currentTime;
    // cancelAndHoldAtTime captures the current mid-ramp value rather than
    // snapping to the intrinsic value, preventing an audible jump when the
    // knob is touched during a filter ADSR sweep.
    filterNode.frequency.cancelAndHoldAtTime(now);
    // setTargetAtTime smoothly eases to the new cutoff over ~15ms so that
    // rapid knob movement doesn't produce clicks.
    filterNode.frequency.setTargetAtTime(filterCutoff, now, 0.015);
    filterNode.Q.value = filterRes;
    lfos.forEach((lfo) => {
      if (lfo.target === "filter" && lfo.gainNode) {
        lfo.gainNode.gain.value = getLFOGainValue(lfo);
      }
    });
  }
  document.getElementById("cutoffVal").textContent =
    formatHzLabel(filterCutoff);
  document.getElementById("resVal").textContent = "Q " + filterRes.toFixed(1);
  updateFilterDebugDisplay(cv);
}

// ─── LFO SYSTEM ───────────────────────────────────────────────────────────────
function getLFOTargetParam(target) {
  if (!audioCtx) return null;
  switch (target) {
    case "filter":
      return filterNode?.frequency;
    case "resonance":
      return filterNode?.Q;
    case "volume":
      return masterGain?.gain;
    case "delay-wet":
      return delayWetGain?.gain;
    default:
      return null;
  }
}

function getLFOGainValue(lfo) {
  switch (lfo.target) {
    case "filter":
      return lfo.depth * filterCutoff;
    case "resonance":
      return lfo.depth * 10;
    case "volume":
      return lfo.depth * volume * 0.3;
    case "delay-wet":
      return lfo.depth * delayWet;
    default:
      return 0;
  }
}

function connectLFO(i) {
  const lfo = lfos[i];
  if (!audioCtx || !lfo.gainNode) return;
  try {
    lfo.gainNode.disconnect();
  } catch (e) {}
  const param = getLFOTargetParam(lfo.target);
  if (param) {
    lfo.gainNode.gain.value = getLFOGainValue(lfo);
    lfo.gainNode.connect(param);
  } else {
    lfo.gainNode.gain.value = 0;
  }
}

function updateLFO(i) {
  const lfo = lfos[i];
  const n = i + 1;
  const rv = parseInt(document.getElementById(`lfo${n}RateSlider`).value);
  const dv = parseInt(document.getElementById(`lfo${n}DepthSlider`).value);
  lfo.wave = document.getElementById(`lfo${n}WaveSelect`).value;
  lfo.rate = 0.05 * Math.pow(400, rv / 100);
  lfo.depth = dv / 100;
  if (lfo.osc) {
    lfo.osc.type = lfo.wave;
    lfo.osc.frequency.value = lfo.rate;
  }
  if (lfo.gainNode) lfo.gainNode.gain.value = getLFOGainValue(lfo);
  document.getElementById(`lfo${n}RateVal`).textContent =
    (lfo.rate < 1 ? lfo.rate.toFixed(2) : lfo.rate.toFixed(1)) + "Hz";
  document.getElementById(`lfo${n}DepthVal`).textContent = dv + "%";
}

function changeLFOTarget(i, target) {
  lfos[i].target = target;
  connectLFO(i);
}

function updatePW(v) {
  pulseWidth = parseInt(v) / 100;
  document.getElementById("pwVal").textContent = v + "%";
}

// ─── FILTER ADSR CONTROLS ─────────────────────────────────────────────────
function updateFilterADSR() {
  filterADSR.a = parseInt(document.getElementById("fatkSlider").value);
  filterADSR.d = parseInt(document.getElementById("fdecSlider").value);
  filterADSR.s = parseInt(document.getElementById("fsusSlider").value) / 100;
  filterADSR.r = parseInt(document.getElementById("frelSlider").value);
  const amtRaw = parseInt(document.getElementById("famtSlider").value);
  filterADSRamt = amtRaw / 100;
  document.getElementById("fatkVal").textContent = filterADSR.a + "ms";
  document.getElementById("fdecVal").textContent = filterADSR.d + "ms";
  document.getElementById("fsusVal").textContent =
    Math.round(filterADSR.s * 100) + "%";
  document.getElementById("frelVal").textContent = filterADSR.r + "ms";
  document.getElementById("famtVal").textContent =
    (amtRaw >= 0 ? "+" : "") + amtRaw + "%";
  drawFilterADSRCanvas();
}

// ─── KEY FOLLOW CONTROLS ──────────────────────────────────────────────────
function updateKeyFollow() {
  keyFollow = parseInt(document.getElementById("keyFollowSlider").value) / 100;
  document.getElementById("keyFollowVal").textContent =
    Math.round(keyFollow * 100) + "%";
}

// ─── DELAY CONTROLS ──────────────────────────────────────────────────────────
function updateDelay() {
  delaySubdiv = parseFloat(document.getElementById("delayTimeSelect").value);
  const fbV = parseInt(document.getElementById("delayFbSlider").value);
  const wetV = parseInt(document.getElementById("delayWetSlider").value);
  const sprV = parseInt(document.getElementById("delaySpreadSlider").value);
  const hcV = parseInt(document.getElementById("delayHiCutSlider").value);
  delayFeedback = fbV / 100;
  delayWet = wetV / 100;
  delaySpread = sprV / 100;
  // Log scale hi-cut: 200Hz → 20kHz
  delayHiCutFreq = 200 * Math.pow(100, hcV / 100);
  const dTime = (60 / bpm) * delaySubdiv;
  // Use setTargetAtTime to smoothly transition delay time and avoid pitch-sweep clicks
  if (delayL)
    delayL.delayTime.setTargetAtTime(dTime, audioCtx.currentTime, 0.008);
  if (delayR)
    delayR.delayTime.setTargetAtTime(dTime, audioCtx.currentTime, 0.008);
  if (delayFbGainLR) delayFbGainLR.gain.value = delayFeedback;
  if (delayFbGainRL) delayFbGainRL.gain.value = delayFeedback;
  if (delayPanL) delayPanL.pan.value = -delaySpread;
  if (delayPanR) delayPanR.pan.value = delaySpread;
  if (delayHiCutLR) delayHiCutLR.frequency.value = delayHiCutFreq;
  if (delayHiCutRL) delayHiCutRL.frequency.value = delayHiCutFreq;
  if (delayDryGain) delayDryGain.gain.value = 1 - delayWet;
  if (delayWetGain) delayWetGain.gain.value = delayWet;
  document.getElementById("delayFbVal").textContent = fbV + "%";
  document.getElementById("delayWetVal").textContent = wetV + "%";
  document.getElementById("delaySpreadVal").textContent = sprV + "%";
  document.getElementById("delayHiCutVal").textContent =
    delayHiCutFreq >= 1000
      ? (delayHiCutFreq / 1000).toFixed(1) + "kHz"
      : Math.round(delayHiCutFreq) + "Hz";
  // Show tempo-synced delay time in ms
  const ms = Math.round((60 / bpm) * delaySubdiv * 1000);
  document.getElementById("delayTimeVal").textContent = ms + "ms";
}

// ─── REVERB CONTROLS ─────────────────────────────────────────────────────────
function updateReverb() {
  if (!document.getElementById("reverbWetSlider")) return; // UI removed
  const wetV = parseInt(document.getElementById("reverbWetSlider").value);
  const decV = parseInt(document.getElementById("reverbDecaySlider").value);
  const pdV = parseInt(document.getElementById("reverbPreDlySlider").value);
  const dampV = parseInt(document.getElementById("reverbDampSlider").value);
  const shimV = parseInt(document.getElementById("reverbShimmerSlider").value);
  const sprV = parseInt(document.getElementById("reverbSpreadSlider").value);
  reverbWet = wetV / 100;
  reverbDecay = decV / 100;
  reverbPreDelay = pdV / 100;
  reverbDamp = dampV / 100;
  reverbShimmer = shimV / 100;
  reverbSpread = sprV / 100;
  if (reverbWetGain) reverbWetGain.gain.value = reverbWet; // WET on output
  if (reverbPreDelayNode && audioCtx)
    reverbPreDelayNode.delayTime.setTargetAtTime(
      reverbPreDelay * 0.15,
      audioCtx.currentTime,
      0.015,
    );
  const rt60 = 0.5 + reverbDecay * 29.5;
  const dampFreq = 500 * Math.pow(40, reverbDamp);
  for (let c = 0; c < COMB_DELAYS_S.length; c++) {
    if (reverbCombFbGains[c])
      reverbCombFbGains[c].gain.value = Math.min(
        0.8,
        Math.pow(10, (-3 * COMB_DELAYS_S[c]) / rt60),
      );
    if (reverbCombHiCutNodes[c])
      reverbCombHiCutNodes[c].frequency.value = dampFreq;
  }
  if (reverbShimmerGain) reverbShimmerGain.gain.value = reverbShimmer * 200;
  if (reverbPanL) reverbPanL.pan.value = -reverbSpread;
  if (reverbPanR) reverbPanR.pan.value = reverbSpread;
  const rt60Disp = rt60 < 10 ? rt60.toFixed(1) + "s" : Math.round(rt60) + "s";
  const pdMs = Math.round(reverbPreDelay * 150);
  const dampDisp =
    dampFreq >= 1000
      ? (dampFreq / 1000).toFixed(1) + "kHz"
      : Math.round(dampFreq) + "Hz";
  document.getElementById("reverbWetVal").textContent = wetV + "%";
  document.getElementById("reverbDecayVal").textContent = rt60Disp;
  document.getElementById("reverbPreDlyVal").textContent = pdMs + "ms";
  document.getElementById("reverbDampVal").textContent = dampDisp;
  document.getElementById("reverbShimmerVal").textContent = shimV + "%";
  document.getElementById("reverbSpreadVal").textContent = sprV + "%";
}

function setReverbPreset(p) {
  const presets = {
    room: { wet: 30, decay: 18, preDly: 5, damp: 62, shimmer: 18, spread: 55 },
    hall: { wet: 38, decay: 52, preDly: 15, damp: 48, shimmer: 35, spread: 80 },
    cath: {
      wet: 45,
      decay: 82,
      preDly: 26,
      damp: 32,
      shimmer: 62,
      spread: 100,
    },
    inf: {
      wet: 60,
      decay: 100,
      preDly: 33,
      damp: 18,
      shimmer: 90,
      spread: 100,
    },
  };
  const s = presets[p];
  if (!s) return;
  [
    ["reverbWetSlider", s.wet],
    ["reverbDecaySlider", s.decay],
    ["reverbPreDlySlider", s.preDly],
    ["reverbDampSlider", s.damp],
    ["reverbShimmerSlider", s.shimmer],
    ["reverbSpreadSlider", s.spread],
  ].forEach(([id, v]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = v;
    if (window.updateKnobVisual) window.updateKnobVisual(id);
  });
  updateReverb();
}

// ─── PING-PONG CANVAS ────────────────────────────────────────────────────────
function drawPPCanvas() {
  const canvas = document.getElementById("ppCanvas");
  if (!canvas) return;
  const W = canvas.width,
    H = canvas.height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0a0c0e";
  ctx.fillRect(0, 0, W, H);
  // Divider
  ctx.strokeStyle = "#1e2830";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(W / 2, 2);
  ctx.lineTo(W / 2, H - 13);
  ctx.stroke();
  // Labels
  ctx.fillStyle = "#4a6070";
  ctx.font = "8px monospace";
  ctx.textAlign = "center";
  ctx.fillText("L", W * 0.25, H - 2);
  ctx.fillText("R", W * 0.75, H - 2);
  const T = delayL ? delayL.delayTime.value : (60 / bpm) * delaySubdiv;
  const now = audioCtx ? audioCtx.currentTime : performance.now() / 1000;
  const phase2 = (now % (T * 2)) / (T * 2); // 0..1 over L+R cycle
  const midY = H * 0.4;
  // L echo (first half of cycle)
  const lPulse = phase2 < 0.5 ? Math.pow(1 - phase2 * 2, 0.4) : 0;
  ctx.beginPath();
  ctx.arc(W * 0.25, midY, 4 + lPulse * 5, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(0,229,255,${0.12 + lPulse * 0.88})`;
  ctx.fill();
  // glow ring
  if (lPulse > 0.1) {
    ctx.beginPath();
    ctx.arc(W * 0.25, midY, 10 + lPulse * 6, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(0,229,255,${lPulse * 0.25})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  // R echo (second half)
  const rPulse = phase2 >= 0.5 ? Math.pow(1 - (phase2 - 0.5) * 2, 0.4) : 0;
  ctx.beginPath();
  ctx.arc(W * 0.75, midY, 4 + rPulse * 5, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(255,107,53,${0.12 + rPulse * 0.88})`;
  ctx.fill();
  if (rPulse > 0.1) {
    ctx.beginPath();
    ctx.arc(W * 0.75, midY, 10 + rPulse * 6, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,107,53,${rPulse * 0.25})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  // Feedback echo dots (green, fading)
  let fbAmp = delayFeedback;
  for (let i = 1; i <= 5 && fbAmp > 0.04; i++) {
    const ePhase = (((phase2 - i * 0.5) % 1) + 1) % 1;
    const isR = i % 2 === 1;
    const ePulse = ePhase < 0.5 ? Math.pow(1 - ePhase * 2, 0.4) : 0;
    const cx = isR ? W * 0.75 : W * 0.25;
    ctx.beginPath();
    ctx.arc(cx, midY, 2 + ePulse * 3, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(127,255,0,${fbAmp * ePulse})`;
    ctx.fill();
    fbAmp *= delayFeedback;
  }
  ppAnimId = requestAnimationFrame(drawPPCanvas);
}

// ─── ADSR CANVAS ─────────────────────────────────────────────────────────────
function drawADSRCanvas() {
  const canvas = document.getElementById("adsrCanvas");
  if (!canvas) return;
  const cssW = canvas.offsetWidth;
  if (cssW > 0 && canvas.width !== cssW) canvas.width = cssW;
  const W = canvas.width,
    H = canvas.height;
  const c = canvas.getContext("2d");
  c.clearRect(0, 0, W, H);
  c.fillStyle = "#0a0c0e";
  c.fillRect(0, 0, W, H);
  const a = adsr.a,
    d = adsr.d,
    s = adsr.s,
    r = adsr.r;
  const hold = Math.max(a + d, 120);
  const total = a + d + hold + r;
  const pad = 5;
  const w = W - pad * 2,
    h = H - pad * 2;
  const xA = pad + (a / total) * w;
  const xD = xA + (d / total) * w;
  const xS = xD + (hold / total) * w;
  const xR = pad + w;
  const yTop = pad,
    yBot = pad + h;
  const ySus = pad + h * (1 - s);
  // Filled area
  c.beginPath();
  c.moveTo(pad, yBot);
  c.lineTo(xA, yTop);
  c.lineTo(xD, ySus);
  c.lineTo(xS, ySus);
  c.lineTo(xR, yBot);
  c.closePath();
  c.fillStyle = "rgba(0,229,255,0.07)";
  c.fill();
  // Envelope line
  c.beginPath();
  c.moveTo(pad, yBot);
  c.lineTo(xA, yTop);
  c.lineTo(xD, ySus);
  c.lineTo(xS, ySus);
  c.lineTo(xR, yBot);
  c.strokeStyle = "#00e5ff";
  c.lineWidth = 1.5;
  c.stroke();
  // Breakpoint dots
  [
    [xA, yTop],
    [xD, ySus],
    [xS, ySus],
  ].forEach(([x, y]) => {
    c.beginPath();
    c.arc(x, y, 2, 0, Math.PI * 2);
    c.fillStyle = "#00e5ff";
    c.fill();
  });
  // Segment labels
  c.fillStyle = "#4a6070";
  c.font = "7px monospace";
  c.textAlign = "center";
  c.fillText("A", (pad + xA) / 2, yBot - 2);
  c.fillText("D", (xA + xD) / 2, yBot - 2);
  c.fillText("S", (xD + xS) / 2, yBot - 2);
  c.fillText("R", (xS + xR) / 2, yBot - 2);
}

// ─── FILTER ADSR CANVAS ──────────────────────────────────────────────────────
function drawFilterADSRCanvas() {
  const canvas = document.getElementById("fadsrCanvas");
  if (!canvas) return;
  const cssW = canvas.offsetWidth;
  if (cssW > 0 && canvas.width !== cssW) canvas.width = cssW;
  const W = canvas.width,
    H = canvas.height;
  const c = canvas.getContext("2d");
  c.clearRect(0, 0, W, H);
  c.fillStyle = "#0a0c0e";
  c.fillRect(0, 0, W, H);
  const a = filterADSR.a,
    d = filterADSR.d,
    s = filterADSR.s,
    r = filterADSR.r;
  const hold = Math.max(a + d, 120);
  const total = a + d + hold + r;
  const pad = 4;
  const w = W - pad * 2,
    h = H - pad * 2 - 6;
  const xA = pad + (a / total) * w;
  const xD = xA + (d / total) * w;
  const xS = xD + (hold / total) * w;
  const xR = pad + w;
  const yTop = pad,
    yBot = pad + h;
  // for positive amt: peak is at top; for negative: peak is at bottom
  const ySus = yBot - h * s * Math.abs(filterADSRamt);
  const yPeak = filterADSRamt >= 0 ? yTop : yBot;
  c.beginPath();
  c.moveTo(pad, yBot);
  c.lineTo(xA, yPeak);
  c.lineTo(xD, ySus);
  c.lineTo(xS, ySus);
  c.lineTo(xR, yBot);
  c.closePath();
  c.fillStyle = "rgba(255,107,53,0.07)";
  c.fill();
  c.beginPath();
  c.moveTo(pad, yBot);
  c.lineTo(xA, yPeak);
  c.lineTo(xD, ySus);
  c.lineTo(xS, ySus);
  c.lineTo(xR, yBot);
  c.strokeStyle = "#ff6b35";
  c.lineWidth = 1.5;
  c.stroke();
  c.fillStyle = "#4a6070";
  c.font = "7px monospace";
  c.textAlign = "center";
  c.fillText("A", (pad + xA) / 2, yBot + 6);
  c.fillText("D", (xA + xD) / 2, yBot + 6);
  c.fillText("S", (xD + xS) / 2, yBot + 6);
  c.fillText("R", (xS + xR) / 2, yBot + 6);
}

// ─── LFO CANVAS ──────────────────────────────────────────────────────────────
function drawLFOCanvas(i) {
  const lfo = lfos[i];
  const canvas = document.getElementById(`lfo${i + 1}Canvas`);
  if (!canvas) return;
  const W = canvas.width,
    H = canvas.height;
  const c = canvas.getContext("2d");
  c.clearRect(0, 0, W, H);
  c.fillStyle = "#0a0c0e";
  c.fillRect(0, 0, W, H);
  c.beginPath();
  c.moveTo(0, H / 2);
  c.lineTo(W, H / 2);
  c.strokeStyle = "#1e2830";
  c.lineWidth = 1;
  c.stroke();
  const shape = lfo.wave;
  const cycles = 2.5;
  c.beginPath();
  for (let x = 0; x <= W; x++) {
    const t = (x / W) * cycles * 2 * Math.PI + lfo.animPhase;
    let y;
    if (shape === "sine") {
      y = Math.sin(t);
    } else if (shape === "triangle") {
      const p = (((t / (2 * Math.PI)) % 1) + 1) % 1;
      y = p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
    } else {
      const p = (((t / (2 * Math.PI)) % 1) + 1) % 1;
      y = 2 * p - 1;
    }
    const cy = H / 2 - y * (H / 2 - 4);
    if (x === 0) c.moveTo(x, cy);
    else c.lineTo(x, cy);
  }
  c.strokeStyle = LFO_COLORS[i];
  c.lineWidth = 1.5;
  c.stroke();
  lfo.animPhase += 0.04 * lfo.rate;
  lfo.animId = requestAnimationFrame(() => drawLFOCanvas(i));
}

function updateRoot() {
  rootMidi = parseInt(document.getElementById("rootSelect").value);
  rootOctave = parseInt(document.getElementById("octaveSelect").value);
  // Compute Hz: MIDI note to Hz
  // A4 = MIDI 69 = 440 Hz
  const midiNum = rootMidi + rootOctave * 12;
  rootHz = 440 * Math.pow(2, (midiNum - 69) / 12);
  document.getElementById("rootHzDisplay").textContent = rootHz.toFixed(2);
  const noteNames = ["C", "D", "E", "F", "G", "A", "B"];
  const noteName =
    noteNames[
      Object.values({
        0: "C",
        2: "D",
        4: "E",
        5: "F",
        7: "G",
        9: "A",
        11: "B",
      })[
        Object.keys({
          0: "C",
          2: "D",
          4: "E",
          5: "F",
          7: "G",
          9: "A",
          11: "B",
        }).indexOf(String(rootMidi))
      ]
    ];
  document.getElementById("statusRoot").textContent = `${rootHz.toFixed(2)} Hz`;
  renderScaleDegrees();
  renderKeyboard();
}

// ─── RENDER FUNCTIONS ─────────────────────────────────────────────────────────
function selectScale(idx) {
  selectedScaleIdx = idx;
  document.querySelectorAll(".scale-item").forEach((el, i) => {
    el.classList.toggle("selected", i === idx);
  });
  const scale = SCALES[idx];
  document.getElementById("activeScaleName").textContent =
    scale.name.toUpperCase();
  document.getElementById("activeScaleInfo").textContent = scale.info;
  document.getElementById("statusScale").textContent = scale.name.toUpperCase();
  renderScaleDegrees();
  renderKeyboard();
  renderStepGrid();
}

function renderScaleDegrees() {
  const scale = SCALES[selectedScaleIdx];
  const container = document.getElementById("scaleDegrees");
  container.innerHTML = "";
  scale.cents.forEach((c, i) => {
    const hz = centsToHz(rootHz, c);
    const chip = document.createElement("div");
    chip.className = "degree-chip" + (i === 0 ? " root-chip" : "");
    chip.innerHTML = `
<div class="degree-num">DEG ${i + 1}</div>
<div style="font-size:11px; color:${i === 0 ? "var(--accent)" : "var(--text)"}">${c === 0 ? "ROOT" : c % 1200 === 0 ? "OCT" : c.toFixed(1) + "¢"}</div>
<div class="degree-hz">${hz.toFixed(1)}Hz</div>
    `;
    chip.onclick = () => {
      initAudio();
      playNote(hz, audioCtx.currentTime);
    };
    container.appendChild(chip);
  });
}

function renderKeyboard() {
  const strip = document.getElementById("kbStrip");
  strip.innerHTML = "";
  const notes = compute88Notes();
  notes.forEach((n, i) => {
    const key = document.createElement("div");
    key.className =
      "kb-key" + (n.isRoot ? " root-key" : n.inScale ? " in-scale" : "");
    key.id = `key-${i}`;
    key.title = `MIDI ${n.midi} · ${n.hz.toFixed(2)} Hz · ${n.inScale ? "IN SCALE (deg " + (n.degree + 1) + ")" : "OUT OF SCALE"}`;
    key.onclick = () => {
      initAudio();
      playNote(n.hz, audioCtx.currentTime);
    };
    strip.appendChild(key);
  });
}

function renderStepGrid() {
  const grid = document.getElementById("stepGrid");
  grid.innerHTML = "";
  const scale = SCALES[selectedScaleIdx];
  for (let i = 0; i < numSteps; i++) {
    const step = steps[i];
    const freq = getFreqForDegree(step.degree);
    const degName = `D${(step.degree % scale.cents.length) + 1}`;
    const oct = Math.floor(step.degree / scale.cents.length) + 1;

    const el = document.createElement("div");
    el.className = "step active-step";
    el.id = `step-${i}`;
    el.innerHTML = `
<div class="step-num">${String(i + 1).padStart(2, "0")}</div>
${
  step.rest
    ? '<div class="step-rest">REST</div>'
    : `<div class="step-note">${degName}</div>
   <div style="font-size:9px; color:var(--accent3)">OCT${oct}</div>
   <div class="step-hz">${freq.toFixed(1)}Hz</div>`
}
<div class="step-btns">
  <div class="step-btn-row">
    <div class="step-mini-btn" onclick="stepDegChange(${i}, -1)">◀</div>
    <div class="step-mini-btn" onclick="stepDegChange(${i}, 1)">▶</div>
  </div>
  <div class="step-btn-row">
    <div class="step-mini-btn" onclick="stepOctChange(${i}, -1)">▼</div>
    <div class="step-mini-btn" onclick="stepOctChange(${i}, 1)">▲</div>
  </div>
  <div class="step-btn-row">
    <div class="step-mini-btn${step.rest ? " rest-active" : ""}" onclick="toggleRest(${i})">RST</div>
    <div class="step-mini-btn" onclick="previewStep(${i})">▶</div>
  </div>
</div>
    `;
    grid.appendChild(el);
  }
}

function stepDegChange(i, delta) {
  const scale = SCALES[selectedScaleIdx];
  const oct = Math.floor(steps[i].degree / scale.cents.length);
  let deg = (steps[i].degree % scale.cents.length) + delta;
  if (deg < 0) deg = scale.cents.length - 1;
  if (deg >= scale.cents.length) deg = 0;
  steps[i].degree = oct * scale.cents.length + deg;
  renderStepGrid();
}

function stepOctChange(i, delta) {
  const scale = SCALES[selectedScaleIdx];
  const oct = Math.floor(steps[i].degree / scale.cents.length) + delta;
  const deg = steps[i].degree % scale.cents.length;
  const newOct = Math.max(0, Math.min(3, oct));
  steps[i].degree = newOct * scale.cents.length + deg;
  renderStepGrid();
}

function toggleRest(i) {
  steps[i].rest = !steps[i].rest;
  renderStepGrid();
}

function previewStep(i) {
  if (steps[i].rest) return;
  initAudio();
  playNote(getFreqForDegree(steps[i].degree), audioCtx.currentTime);
}

function renderScaleList() {
  const list = document.getElementById("scaleList");
  list.innerHTML = "";
  let currentCat = "";
  document.getElementById("scaleCount").textContent = SCALES.length;

  SCALES.forEach((scale, idx) => {
    if (scale.cat !== currentCat) {
      currentCat = scale.cat;
      const catEl = document.createElement("div");
      catEl.className = "scale-category";
      catEl.textContent = scale.cat;
      list.appendChild(catEl);
    }
    const item = document.createElement("div");
    item.className = "scale-item" + (idx === 0 ? " selected" : "");
    item.innerHTML = `
<span class="scale-name">${scale.name}</span>
<span class="scale-info">${scale.cents.length}n</span>
    `;
    item.onclick = () => selectScale(idx);
    list.appendChild(item);
  });
}

// ─── ROTARY KNOB DRAG SYSTEM ─────────────────────────────────────────────────
(function () {
  let activeKnobInput = null;
  let dragStartY = 0;
  let dragStartVal = 0;
  const KNOB_DRAG_DEADZONE_PX = 3;

  function getKnobAngle(inputId) {
    const inp = document.getElementById(inputId);
    if (!inp) return -135;
    const min = parseFloat(inp.min);
    const max = parseFloat(inp.max);
    const val = parseFloat(inp.value);
    const t = (val - min) / (max - min);
    return -135 + t * 270;
  }

  function updateKnobVisual(inputId) {
    // find sibling .knob via closest .knob-group or .lfo-knob
    const inp = document.getElementById(inputId);
    if (!inp) return;
    const group = inp.closest(".knob-group") || inp.closest(".lfo-knob");
    if (!group) return;
    const knobEl = group.querySelector(".knob");
    if (!knobEl) return;
    const angle = getKnobAngle(inputId);
    // Rotate the indicator pseudo-element via CSS variable
    knobEl.style.setProperty("--rot", angle + "deg");
    // Update conic gradient to show filled arc
    const min = parseFloat(inp.min);
    const max = parseFloat(inp.max);
    const val = parseFloat(inp.value);
    const t = (val - min) / (max - min);
    const startDeg = 135; // conic starts at 0 = top, rotated by transform
    const fillDeg = t * 270;
    knobEl.style.background = `conic-gradient(
      from ${startDeg}deg,
      var(--accent) 0deg,
      var(--accent) ${fillDeg}deg,
      var(--dim) ${fillDeg}deg,
      var(--dim) 270deg,
      transparent 270deg
    )`;
    const pseudo = knobEl.querySelector ? null : null;
    knobEl.style.transform = ""; // marker handled via ::after rotation
    // hacky but effective: use a CSS custom property that we read in style
    knobEl.style.setProperty("--rot", angle + "deg");
  }

  function onMove(e) {
    if (!activeKnobInput) return;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const rawDelta = dragStartY - clientY; // positive = drag up = increase
    const absDelta = Math.abs(rawDelta);
    if (absDelta <= KNOB_DRAG_DEADZONE_PX) return;
    const delta =
      Math.sign(rawDelta) * (absDelta - KNOB_DRAG_DEADZONE_PX);
    const inp = document.getElementById(activeKnobInput);
    if (!inp) return;
    const min = parseFloat(inp.min);
    const max = parseFloat(inp.max);
    const range = max - min;
    // sensitivity: full range over ~200px drag
    const newVal = Math.min(
      max,
      Math.max(min, dragStartVal + (delta / 200) * range),
    );
    inp.value = newVal;
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    updateKnobVisual(activeKnobInput);
  }

  function onUp() {
    if (activeKnobInput) {
      const inp = document.getElementById(activeKnobInput);
      if (inp) {
        const group = inp.closest(".knob-group") || inp.closest(".lfo-knob");
        if (group) {
          const knobEl = group.querySelector(".knob");
          if (knobEl) knobEl.classList.remove("active");
        }
      }
    }
    activeKnobInput = null;
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    document.removeEventListener("touchmove", onMove);
    document.removeEventListener("touchend", onUp);
  }

  window.knobDown = function (e, inputId) {
    e.preventDefault();
    activeKnobInput = inputId;
    dragStartY = e.clientY;
    const inp = document.getElementById(inputId);
    dragStartVal = inp ? parseFloat(inp.value) : 0;
    const group = inp
      ? inp.closest(".knob-group") || inp.closest(".lfo-knob")
      : null;
    if (group) {
      const knobEl = group.querySelector(".knob");
      if (knobEl) knobEl.classList.add("active");
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  window.knobTouchStart = function (e, inputId) {
    e.preventDefault();
    activeKnobInput = inputId;
    dragStartY = e.touches[0].clientY;
    const inp = document.getElementById(inputId);
    dragStartVal = inp ? parseFloat(inp.value) : 0;
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onUp);
  };

  // Initialize all knob visuals after DOM is ready
  function initKnobVisuals() {
    document.querySelectorAll(".knob-hidden").forEach((inp) => {
      updateKnobVisual(inp.id);
    });
  }

  // Run after page load
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initKnobVisuals);
  } else {
    initKnobVisuals();
  }

  // Expose for external calls (e.g. after updateEnv)
  window.updateKnobVisual = updateKnobVisual;
})();

// ─── PRESET SYSTEM ───────────────────────────────────────────────────────────
const PRESET_KEY = "scaleSeqPresets";

const VONNEGUT_ADJ = [
  "Unstuck",
  "Tralfamadorian",
  "Bokonist",
  "Chronosynclastic",
  "Fatalistic",
  "Granfalloon",
  "Karass",
  "Wampeterian",
  "Dresden",
  "Pilgrim",
  "Deadeye",
  "Timequake",
  "Harmonic",
  "Sinooká",
  "Nothingburger",
  "Ice-Nine",
  "Unglued",
  "Infundibulated",
  "Fata-Tisi",
  "Lamentable",
  "Earnest",
  "Peculiar",
  "Listless",
  "Sanguine",
  "Aberrant",
  "Tranquil",
  "Effervescent",
  "Lugubrious",
  "Sardonic",
  "Absurdist",
  "Galactic",
  "Rumfoordian",
  "Wakefield",
  "Parabolic",
  "Oscillating",
];
const VONNEGUT_NOUN = [
  "Groove",
  "Waltz",
  "Cascade",
  "Fugue",
  "Drift",
  "Requiem",
  "Passage",
  "Tremolo",
  "Sequence",
  "Interlude",
  "Oscillation",
  "Lullaby",
  "Elegy",
  "Resonance",
  "Reverie",
  "Soliloquy",
  "Prelude",
  "Coda",
  "Bop",
  "Aria",
  "Nocturne",
  "Fantasia",
  "March",
  "Toccata",
  "Overture",
  "Raga",
  "Étude",
  "Schmaltz",
  "Waltz",
  "Sérénade",
  "Episode",
  "Threshold",
  "Chronicle",
  "Transmission",
  "Broadcast",
  "Frequency",
  "Signal",
];

function generatePresetName() {
  const adj = VONNEGUT_ADJ[Math.floor(Math.random() * VONNEGUT_ADJ.length)];
  const noun = VONNEGUT_NOUN[Math.floor(Math.random() * VONNEGUT_NOUN.length)];
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return `${adj} ${noun} · ${stamp}`;
}

function getPresetState() {
  // Capture every slider/select value by ID
  const sliderIds = [
    "bpmSlider",
    "stepsSlider",
    "atkSlider",
    "decSlider",
    "susSlider",
    "relSlider",
    "volSlider",
    "cutoffSlider",
    "resSlider",
    "keyFollowSlider",
    "fatkSlider",
    "fdecSlider",
    "fsusSlider",
    "frelSlider",
    "famtSlider",
    "lfo1RateSlider",
    "lfo1DepthSlider",
    "lfo2RateSlider",
    "lfo2DepthSlider",
    "pwSlider",
    "delayFbSlider",
    "delayWetSlider",
    "delaySpreadSlider",
    "delayHiCutSlider",
    "reverbWetSlider",
    "reverbDecaySlider",
    "reverbPreDlySlider",
    "reverbDampSlider",
    "reverbShimmerSlider",
    "reverbSpreadSlider",
  ];
  const selectIds = [
    "dirSelect",
    "stepLenSelect",
    "waveSelect",
    "rootSelect",
    "octaveSelect",
    "lfo1WaveSelect",
    "lfo1TargetSelect",
    "lfo2WaveSelect",
    "lfo2TargetSelect",
    "delayTimeSelect",
  ];
  const state = {
    sliders: {},
    selects: {},
    steps: [],
    scaleIdx: selectedScaleIdx,
  };
  sliderIds.forEach((id) => {
    const el = document.getElementById(id);
    if (el) state.sliders[id] = el.value;
  });
  selectIds.forEach((id) => {
    const el = document.getElementById(id);
    if (el) state.selects[id] = el.value;
  });
  // Deep-copy step data
  state.steps = steps.map((s) => ({ degree: s.degree, rest: s.rest }));
  return state;
}

function applyPresetState(state) {
  if (!state) return;
  // Restore sliders + fire their oninput handlers
  Object.entries(state.sliders || {}).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = val;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    if (window.updateKnobVisual) window.updateKnobVisual(id);
  });
  // Restore selects
  Object.entries(state.selects || {}).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = val;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  // Restore step data
  if (Array.isArray(state.steps)) {
    state.steps.forEach((s, i) => {
      if (i < steps.length) {
        steps[i].degree = s.degree;
        steps[i].rest = s.rest;
      }
    });
    renderStepGrid();
  }
  // Restore scale selection
  if (typeof state.scaleIdx === "number") {
    selectScale(state.scaleIdx);
  }
  // Redraw canvases
  drawADSRCanvas();
  drawFilterADSRCanvas();
}

function loadPresetsFromStorage() {
  try {
    return JSON.parse(localStorage.getItem(PRESET_KEY) || "[]");
  } catch {
    return [];
  }
}

function savePresetsToStorage(list) {
  localStorage.setItem(PRESET_KEY, JSON.stringify(list));
}

function renderPresetList() {
  const list = loadPresetsFromStorage();

  // Recall dropdown
  const sel = document.getElementById("presetSelect");
  if (sel) {
    const current = sel.value;
    sel.innerHTML = '<option value="">— recall —</option>';
    list.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      sel.appendChild(opt);
    });
    if (current && list.find((p) => p.id === current)) sel.value = current;
  }

  // Morph target dropdown
  const msel = document.getElementById("morphSelect");
  if (msel) {
    const mcurrent = msel.value;
    msel.innerHTML = '<option value="">— morph to —</option>';
    list.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      msel.appendChild(opt);
    });
    if (mcurrent && list.find((p) => p.id === mcurrent)) msel.value = mcurrent;
  }
}

function savePreset() {
  const list = loadPresetsFromStorage();
  const id = `preset_${Date.now()}`;
  const name = generatePresetName();
  list.unshift({ id, name, created: Date.now(), state: getPresetState() });
  savePresetsToStorage(list);
  renderPresetList();
  const sel = document.getElementById("presetSelect");
  if (sel) sel.value = id;
  const display = document.getElementById("presetNameDisplay");
  if (display) display.textContent = name;
  // Flash the save button
  const btn = document.querySelector(".preset-save-btn");
  if (btn) {
    btn.textContent = "✓ SAVED";
    setTimeout(() => {
      btn.textContent = "+ SAVE";
    }, 1200);
  }
}

function loadPreset(id) {
  if (!id) return;
  const list = loadPresetsFromStorage();
  const preset = list.find((p) => p.id === id);
  if (!preset) return;
  applyPresetState(preset.state);
  const display = document.getElementById("presetNameDisplay");
  if (display) display.textContent = preset.name;
}

function deleteSelectedPreset() {
  const sel = document.getElementById("presetSelect");
  if (!sel || !sel.value) return;
  const id = sel.value;
  const list = loadPresetsFromStorage().filter((p) => p.id !== id);
  savePresetsToStorage(list);
  renderPresetList();
  const display = document.getElementById("presetNameDisplay");
  if (display) display.textContent = "NO PRESET";
}

function exportPresets() {
  const list = loadPresetsFromStorage();
  if (!list.length) {
    alert("No presets saved yet — save some first!");
    return;
  }
  const json = JSON.stringify(list, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "presets.json";
  a.click();
  URL.revokeObjectURL(url);
}

function importPresets(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const imported = JSON.parse(e.target.result);
      if (!Array.isArray(imported)) throw new Error("not an array");
      const existing = loadPresetsFromStorage();
      const existingNames = new Set(existing.map((p) => p.name));
      const newOnes = imported.filter((p) => !existingNames.has(p.name));
      savePresetsToStorage([...newOnes, ...existing]);
      renderPresetList();
      input.value = "";
      const btn = document.querySelector(".preset-import-btn");
      if (btn) {
        btn.textContent = `✓ ${newOnes.length} IMPORTED`;
        setTimeout(() => (btn.textContent = "↑ IMPORT"), 1500);
      }
    } catch {
      alert("Could not read preset file — make sure it's a valid JSON export.");
    }
  };
  reader.readAsText(file);
}

// On fresh load, fetch presets.json from the server if localStorage is empty.
// This lets you commit an exported presets.json to the repo as the default set.
async function initPresets() {
  if (loadPresetsFromStorage().length === 0) {
    try {
      const resp = await fetch("presets.json");
      if (resp.ok) {
        const defaults = await resp.json();
        if (Array.isArray(defaults) && defaults.length > 0) {
          savePresetsToStorage(defaults);
        }
      }
    } catch {
      // presets.json not present — fine, start with empty list
    }
  }
  renderPresetList();
}

// ─── PRESET MORPH ────────────────────────────────────────────────────────────
function updateMorphTime(v) {
  morphDuration = parseFloat(v);
  document.getElementById("morphTimeVal").textContent =
    morphDuration.toFixed(1) + "s";
}

function morphToPreset(id) {
  if (!id) return;
  const list = loadPresetsFromStorage();
  const preset = list.find((p) => p.id === id);
  if (!preset) return;

  // Cancel any in-progress morph
  if (morphRafId) {
    cancelAnimationFrame(morphRafId);
    morphRafId = null;
  }

  const SLIDER_IDS = [
    "bpmSlider",
    "stepsSlider",
    "atkSlider",
    "decSlider",
    "susSlider",
    "relSlider",
    "volSlider",
    "cutoffSlider",
    "resSlider",
    "keyFollowSlider",
    "fatkSlider",
    "fdecSlider",
    "fsusSlider",
    "frelSlider",
    "famtSlider",
    "lfo1RateSlider",
    "lfo1DepthSlider",
    "lfo2RateSlider",
    "lfo2DepthSlider",
    "pwSlider",
    "delayFbSlider",
    "delayWetSlider",
    "delaySpreadSlider",
    "delayHiCutSlider",
    "reverbWetSlider",
    "reverbDecaySlider",
    "reverbPreDlySlider",
    "reverbDampSlider",
    "reverbShimmerSlider",
    "reverbSpreadSlider",
  ];

  // Snapshot start values
  const startVals = {};
  const targetVals = {};
  SLIDER_IDS.forEach((sid) => {
    const el = document.getElementById(sid);
    if (!el) return;
    startVals[sid] = parseFloat(el.value);
    const tv =
      preset.state.sliders && preset.state.sliders[sid] !== undefined
        ? parseFloat(preset.state.sliders[sid])
        : parseFloat(el.value);
    targetVals[sid] = tv;
  });

  // Apply non-interpolatable state immediately (selects, steps, scale)
  const SELECT_IDS = [
    "dirSelect",
    "stepLenSelect",
    "waveSelect",
    "rootSelect",
    "octaveSelect",
    "lfo1WaveSelect",
    "lfo1TargetSelect",
    "lfo2WaveSelect",
    "lfo2TargetSelect",
    "delayTimeSelect",
  ];
  SELECT_IDS.forEach((sid) => {
    const el = document.getElementById(sid);
    if (!el || !preset.state.selects) return;
    if (preset.state.selects[sid] !== undefined) {
      el.value = preset.state.selects[sid];
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  if (Array.isArray(preset.state.steps)) {
    preset.state.steps.forEach((s, i) => {
      if (i < steps.length) {
        steps[i].degree = s.degree;
        steps[i].rest = s.rest;
      }
    });
    renderStepGrid();
  }
  if (typeof preset.state.scaleIdx === "number")
    selectScale(preset.state.scaleIdx);

  const display = document.getElementById("presetNameDisplay");
  if (display) display.textContent = "◌ " + preset.name;

  const startTime = performance.now();
  const durationMs = morphDuration * 1000;

  function frame(now) {
    const t = Math.min(1, (now - startTime) / durationMs);
    SLIDER_IDS.forEach((sid) => {
      const el = document.getElementById(sid);
      if (!el) return;
      el.value = startVals[sid] + (targetVals[sid] - startVals[sid]) * t;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      if (window.updateKnobVisual) window.updateKnobVisual(sid);
    });
    if (t < 1) {
      morphRafId = requestAnimationFrame(frame);
    } else {
      morphRafId = null;
      drawADSRCanvas();
      drawFilterADSRCanvas();
      if (display) display.textContent = preset.name;
    }
  }

  morphRafId = requestAnimationFrame(frame);
}

// ─── AUDIO CAPTURE ───────────────────────────────────────────────────────────
function toggleCapture() {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
  } else {
    startCapture();
  }
}

function startCapture() {
  if (!audioCtx) initAudio();
  if (!captureDestNode) {
    captureDestNode = audioCtx.createMediaStreamDestination();
    masterGain.connect(captureDestNode);
  }

  captureChunks = [];
  const mimeType =
    ["audio/webm;codecs=opus", "audio/webm", "audio/ogg"].find((m) =>
      MediaRecorder.isTypeSupported(m),
    ) || "";

  mediaRecorder = new MediaRecorder(
    captureDestNode.stream,
    mimeType ? { mimeType } : undefined,
  );

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) captureChunks.push(e.data);
  };

  mediaRecorder.onstop = () => {
    clearInterval(captureTimerInterval);
    const blob = new Blob(captureChunks, {
      type: mediaRecorder.mimeType || "audio/webm",
    });
    const ext = (mediaRecorder.mimeType || "audio/webm").includes("ogg")
      ? "ogg"
      : "webm";
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `scale-seq-${ts}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
    // Reset button
    const btn = document.getElementById("captureBtn");
    if (btn) {
      btn.textContent = "⏺ REC";
      btn.classList.remove("capturing");
    }
    document.getElementById("captureTimer").textContent = "";
  };

  mediaRecorder.start(250); // collect chunks every 250ms
  captureStartTime = Date.now();

  const btn = document.getElementById("captureBtn");
  if (btn) {
    btn.textContent = "⏹ STOP";
    btn.classList.add("capturing");
  }

  captureTimerInterval = setInterval(() => {
    const s = Math.floor((Date.now() - captureStartTime) / 1000);
    const m = Math.floor(s / 60)
      .toString()
      .padStart(2, "0");
    const sc = (s % 60).toString().padStart(2, "0");
    const el = document.getElementById("captureTimer");
    if (el) el.textContent = `${m}:${sc}`;
  }, 500);
}

// ─── INIT ────────────────────────────────────────────────────────────────────
renderScaleList();
selectScale(0); // Default: Pythagorean
renderStepGrid();
updateEnv();
updateFilter();
lfos.forEach((_, i) => updateLFO(i));
updateFilterADSR();
updateKeyFollow();
updateDelay();
updateReverb();
lfos.forEach((_, i) => drawLFOCanvas(i));
drawPPCanvas();
initPresets();
updateFilterDebugDisplay();

setInterval(() => {
  updateFilterDebugDisplay();
}, 100);

// Auto-resume AudioContext on first interaction
document.addEventListener(
  "click",
  () => {
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  },
  { once: false },
);
