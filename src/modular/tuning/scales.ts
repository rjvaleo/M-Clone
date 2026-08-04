/**
 * Eighty-one tuning systems, in cents from the root.
 *
 * Ported from the scale sequencer (rjvaleo/scale-sequencer), where the point was
 * that these are **true intervals**: a Pythagorean major third is 408 cents and
 * a maqam's neutral second is 150, and neither is a 12-TET pitch rounded off.
 * Storing cents rather than semitones is what makes that possible, and it is why
 * every consumer here works in cents too.
 *
 * ## Ids
 *
 * The sequencer selected a scale by its index in this array, which means
 * inserting a scale silently retunes every saved preset. Each scale carries a
 * stable id instead, so a document names the scale it meant.
 *
 * Generated from the source table; one correction was applied on the way in —
 * see the Raga Marwa note below.
 */

export const SCALE_CATEGORIES = [
  "WESTERN DIATONIC — 12-TET",
  "WESTERN EXTENDED — 12-TET",
  "JUST INTONATION — TRUE RATIOS",
  "HISTORICAL TEMPERAMENTS",
  "MICROTONAL & CONTEMPORARY",
  "MIDDLE EASTERN — MAQAM",
  "SOUTH & EAST ASIAN",
] as const;

export type ScaleCategory = (typeof SCALE_CATEGORIES)[number];

export type Scale = {
  /** Stable across releases; what a document stores. */
  readonly id: string;
  readonly name: string;
  readonly category: ScaleCategory;
  /** Provenance and note count, for the face. */
  readonly info: string;
  /** Ascending cent offsets from the root, always starting at 0. */
  readonly cents: readonly number[];
};

export const SCALES: readonly Scale[] = [
  {
    id: "ionian-major",
    name: "Ionian (Major)",
    category: "WESTERN DIATONIC — 12-TET",
    info: "Western · 7 notes",
    cents: [0, 200, 400, 500, 700, 900, 1100],
  },
  {
    id: "dorian",
    name: "Dorian",
    category: "WESTERN DIATONIC — 12-TET",
    info: "Western/Medieval · 7 notes",
    cents: [0, 200, 300, 500, 700, 900, 1000],
  },
  {
    id: "phrygian",
    name: "Phrygian",
    category: "WESTERN DIATONIC — 12-TET",
    info: "Western/Medieval · 7 notes",
    cents: [0, 100, 300, 500, 700, 800, 1000],
  },
  {
    id: "lydian",
    name: "Lydian",
    category: "WESTERN DIATONIC — 12-TET",
    info: "Western/Medieval · 7 notes",
    cents: [0, 200, 400, 600, 700, 900, 1100],
  },
  {
    id: "mixolydian",
    name: "Mixolydian",
    category: "WESTERN DIATONIC — 12-TET",
    info: "Western/Medieval · 7 notes",
    cents: [0, 200, 400, 500, 700, 900, 1000],
  },
  {
    id: "aeolian-natural-minor",
    name: "Aeolian (Natural Minor)",
    category: "WESTERN DIATONIC — 12-TET",
    info: "Western · 7 notes",
    cents: [0, 200, 300, 500, 700, 800, 1000],
  },
  {
    id: "locrian",
    name: "Locrian",
    category: "WESTERN DIATONIC — 12-TET",
    info: "Western/Medieval · 7 notes",
    cents: [0, 100, 300, 500, 600, 800, 1000],
  },
  {
    id: "harmonic-minor",
    name: "Harmonic Minor",
    category: "WESTERN EXTENDED — 12-TET",
    info: "Western · 7 notes",
    cents: [0, 200, 300, 500, 700, 800, 1100],
  },
  {
    id: "melodic-minor-ascending",
    name: "Melodic Minor (ascending)",
    category: "WESTERN EXTENDED — 12-TET",
    info: "Western · 7 notes",
    cents: [0, 200, 300, 500, 700, 900, 1100],
  },
  {
    id: "major-pentatonic",
    name: "Major Pentatonic",
    category: "WESTERN EXTENDED — 12-TET",
    info: "Global · 5 notes",
    cents: [0, 200, 400, 700, 900],
  },
  {
    id: "minor-pentatonic",
    name: "Minor Pentatonic",
    category: "WESTERN EXTENDED — 12-TET",
    info: "Global · 5 notes",
    cents: [0, 300, 500, 700, 1000],
  },
  {
    id: "blues-scale",
    name: "Blues Scale",
    category: "WESTERN EXTENDED — 12-TET",
    info: "American · 6 notes",
    cents: [0, 300, 500, 600, 700, 1000],
  },
  {
    id: "whole-tone",
    name: "Whole Tone",
    category: "WESTERN EXTENDED — 12-TET",
    info: "French Impressionist · 6 notes",
    cents: [0, 200, 400, 600, 800, 1000],
  },
  {
    id: "diminished-half-whole",
    name: "Diminished (Half-Whole)",
    category: "WESTERN EXTENDED — 12-TET",
    info: "Jazz · 8 notes",
    cents: [0, 100, 300, 400, 600, 700, 900, 1000],
  },
  {
    id: "diminished-whole-half",
    name: "Diminished (Whole-Half)",
    category: "WESTERN EXTENDED — 12-TET",
    info: "Jazz · 8 notes",
    cents: [0, 200, 300, 500, 600, 800, 900, 1100],
  },
  {
    id: "double-harmonic-byzantine",
    name: "Double Harmonic (Byzantine)",
    category: "WESTERN EXTENDED — 12-TET",
    info: "Eastern/Western · 7 notes",
    cents: [0, 100, 400, 500, 700, 800, 1100],
  },
  {
    id: "hungarian-minor",
    name: "Hungarian Minor",
    category: "WESTERN EXTENDED — 12-TET",
    info: "Eastern European · 7 notes",
    cents: [0, 200, 300, 600, 700, 800, 1100],
  },
  {
    id: "spanish-phrygian-dominant",
    name: "Spanish Phrygian Dominant",
    category: "WESTERN EXTENDED — 12-TET",
    info: "Flamenco/Middle Eastern · 7 notes",
    cents: [0, 100, 400, 500, 700, 800, 1000],
  },
  {
    id: "persian",
    name: "Persian",
    category: "WESTERN EXTENDED — 12-TET",
    info: "Middle Eastern · 7 notes",
    cents: [0, 100, 400, 500, 600, 800, 1100],
  },
  {
    id: "prometheus-scriabin",
    name: "Prometheus (Scriabin)",
    category: "WESTERN EXTENDED — 12-TET",
    info: "Western · 6 notes",
    cents: [0, 200, 400, 600, 900, 1000],
  },
  {
    id: "augmented-scale",
    name: "Augmented Scale",
    category: "WESTERN EXTENDED — 12-TET",
    info: "Western · 6 notes",
    cents: [0, 300, 400, 700, 800, 1100],
  },
  {
    id: "enigmatic",
    name: "Enigmatic",
    category: "WESTERN EXTENDED — 12-TET",
    info: "Western/Verdi · 7 notes",
    cents: [0, 100, 400, 600, 800, 1000, 1100],
  },
  {
    id: "neapolitan-major",
    name: "Neapolitan Major",
    category: "WESTERN EXTENDED — 12-TET",
    info: "Western · 7 notes",
    cents: [0, 100, 300, 500, 700, 900, 1100],
  },
  {
    id: "neapolitan-minor",
    name: "Neapolitan Minor",
    category: "WESTERN EXTENDED — 12-TET",
    info: "Western · 7 notes",
    cents: [0, 100, 300, 500, 700, 800, 1100],
  },
  {
    id: "romanian-minor",
    name: "Romanian Minor",
    category: "WESTERN EXTENDED — 12-TET",
    info: "Eastern European · 7 notes",
    cents: [0, 200, 300, 600, 700, 900, 1000],
  },
  {
    id: "bebop-dominant",
    name: "Bebop Dominant",
    category: "WESTERN EXTENDED — 12-TET",
    info: "Jazz · 8 notes",
    cents: [0, 200, 400, 500, 700, 900, 1000, 1100],
  },
  {
    id: "bebop-major",
    name: "Bebop Major",
    category: "WESTERN EXTENDED — 12-TET",
    info: "Jazz · 8 notes",
    cents: [0, 200, 400, 500, 700, 800, 900, 1100],
  },
  {
    id: "pythagorean-tuning",
    name: "Pythagorean Tuning",
    category: "JUST INTONATION — TRUE RATIOS",
    info: "Ancient Greek · 12 notes · 3-limit",
    cents: [0, 114, 204, 294.1, 408, 498, 612, 702, 816, 906.1, 996.1, 1110],
  },
  {
    id: "ptolemys-intense-diatonic-just-major",
    name: "Ptolemy's Intense Diatonic (Just Major)",
    category: "JUST INTONATION — TRUE RATIOS",
    info: "Ancient Greek · 7 notes · 5-limit",
    cents: [0, 203.9, 386.3, 498, 702, 884.4, 1088.3],
  },
  {
    id: "ptolemys-soft-diatonic",
    name: "Ptolemy's Soft Diatonic",
    category: "JUST INTONATION — TRUE RATIOS",
    info: "Ancient Greek · 7 notes",
    cents: [0, 182.4, 386.3, 498, 702, 884.4, 1086.8],
  },
  {
    id: "five-limit-just-intonation",
    name: "Five-Limit Just Intonation",
    category: "JUST INTONATION — TRUE RATIOS",
    info: "Historical · 12 notes · 5-limit",
    cents: [0, 111.7, 203.9, 315.6, 386.3, 498, 590.2, 702, 813.7, 884.4, 996.1, 1088.3],
  },
  {
    id: "seven-limit-just-intonation",
    name: "Seven-Limit Just Intonation",
    category: "JUST INTONATION — TRUE RATIOS",
    info: "Contemporary · 12 notes · 7-limit",
    cents: [0, 119.4, 203.9, 231.2, 386.3, 470.8, 582.5, 702, 764.9, 884.4, 968.8, 1017.6],
  },
  {
    id: "harmonic-series-partials-1-16",
    name: "Harmonic Series (partials 1–16)",
    category: "JUST INTONATION — TRUE RATIOS",
    info: "Universal/Overtone-based · 15 notes",
    cents: [0, 203.9, 386.3, 498, 582.5, 702, 772.6, 840.5, 884.4, 968.8, 1017.6, 1049.4, 1088.3, 1145],
  },
  {
    id: "partch-43-tone-scale-first-octave",
    name: "Partch 43-Tone Scale (first octave)",
    category: "JUST INTONATION — TRUE RATIOS",
    info: "Harry Partch · 43 notes · 11-limit",
    cents: [0, 21.5, 35.7, 49.4, 63.2, 84.5, 111.7, 119.4, 139.5, 155.1, 168.9, 203.9, 222.5, 231.2, 266.9, 274.6, 294.1, 315.6, 333.8, 345],
  },
  {
    id: "meantone-quarter-comma",
    name: "Meantone (Quarter-Comma)",
    category: "HISTORICAL TEMPERAMENTS",
    info: "Renaissance/Baroque · 12 notes",
    cents: [0, 76, 193.2, 310.3, 386.3, 503.4, 579.5, 696.6, 772.6, 889.7, 1006.8, 1082.9],
  },
  {
    id: "werckmeister-iii",
    name: "Werckmeister III",
    category: "HISTORICAL TEMPERAMENTS",
    info: "Baroque · 12 notes · J.S. Bach era",
    cents: [0, 90.2, 192, 294.1, 390.2, 498, 588.3, 696.1, 792.2, 888.3, 996.1, 1092.2],
  },
  {
    id: "kirnberger-iii",
    name: "Kirnberger III",
    category: "HISTORICAL TEMPERAMENTS",
    info: "18th century German · 12 notes",
    cents: [0, 90.2, 203.9, 294.1, 386.3, 498, 590.2, 702, 792.2, 895.1, 996.1, 1088.3],
  },
  {
    id: "vallotti-temperament",
    name: "Vallotti Temperament",
    category: "HISTORICAL TEMPERAMENTS",
    info: "18th century Italian · 12 notes",
    cents: [0, 94.1, 196.1, 298, 392.2, 501.9, 594.1, 698, 796.1, 894.1, 1000, 1094.1],
  },
  {
    id: "19-edo",
    name: "19-EDO",
    category: "HISTORICAL TEMPERAMENTS",
    info: "Renaissance onward · 19 equal divisions",
    cents: [0, 63.1578947368421, 126.3157894736842, 189.4736842105263, 252.6315789473684, 315.7894736842105, 378.9473684210526, 442.10526315789474, 505.2631578947368, 568.421052631579, 631.578947368421, 694.7368421052631, 757.8947368421052, 821.0526315789473, 884.2105263157895, 947.3684210526316, 1010.5263157894736, 1073.6842105263158, 1136.842105263158],
  },
  {
    id: "31-edo",
    name: "31-EDO",
    category: "HISTORICAL TEMPERAMENTS",
    info: "Theoretical/Huygens · 31 equal divisions",
    cents: [0, 38.70967741935484, 77.41935483870968, 116.12903225806451, 154.83870967741936, 193.5483870967742, 232.25806451612902, 270.9677419354839, 309.6774193548387, 348.38709677419354, 387.0967741935484, 425.80645161290323, 464.51612903225805, 503.2258064516129, 541.9354838709678, 580.6451612903226, 619.3548387096774, 658.0645161290323, 696.7741935483871, 735.483870967742, 774.1935483870968, 812.9032258064516, 851.6129032258065, 890.3225806451613, 929.0322580645161, 967.741935483871, 1006.4516129032259, 1045.1612903225807, 1083.8709677419356, 1122.5806451612902, 1161.2903225806451],
  },
  {
    id: "53-edo",
    name: "53-EDO",
    category: "HISTORICAL TEMPERAMENTS",
    info: "Theoretical · 53 equal divisions",
    cents: [0, 22.641509433962263, 45.283018867924525, 67.9245283018868, 90.56603773584905, 113.2075471698113, 135.8490566037736, 158.49056603773585, 181.1320754716981, 203.77358490566036, 226.4150943396226, 249.0566037735849],
  },
  {
    id: "quarter-tone-scale-24-edo",
    name: "Quarter-Tone Scale (24-EDO)",
    category: "MICROTONAL & CONTEMPORARY",
    info: "Middle Eastern/Contemporary · 24 divisions",
    cents: [0, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750, 800, 850, 900, 950, 1000, 1050, 1100, 1150],
  },
  {
    id: "17-edo",
    name: "17-EDO",
    category: "MICROTONAL & CONTEMPORARY",
    info: "Arabic approximation · 17 equal divisions",
    cents: [0, 70.58823529411765, 141.1764705882353, 211.76470588235296, 282.3529411764706, 352.9411764705883, 423.5294117647059, 494.11764705882354, 564.7058823529412, 635.2941176470589, 705.8823529411766, 776.4705882352941, 847.0588235294118, 917.6470588235295, 988.2352941176471, 1058.8235294117649, 1129.4117647058824],
  },
  {
    id: "22-edo",
    name: "22-EDO",
    category: "MICROTONAL & CONTEMPORARY",
    info: "Indian sruti approximation · 22 equal divisions",
    cents: [0, 54.54545454545455, 109.0909090909091, 163.63636363636363, 218.1818181818182, 272.72727272727275, 327.27272727272725, 381.8181818181818, 436.3636363636364, 490.90909090909093, 545.4545454545455, 600, 654.5454545454545, 709.0909090909091, 763.6363636363636, 818.1818181818182, 872.7272727272727, 927.2727272727273, 981.8181818181819, 1036.3636363636365, 1090.909090909091, 1145.4545454545455],
  },
  {
    id: "72-edo",
    name: "72-EDO",
    category: "MICROTONAL & CONTEMPORARY",
    info: "Franz Richter Herf · 72 divisions · sixth-tones",
    cents: [0, 16.666666666666668, 33.333333333333336, 50, 66.66666666666667, 83.33333333333334, 100, 116.66666666666667, 133.33333333333334, 150, 166.66666666666669, 183.33333333333334, 200],
  },
  {
    id: "wendy-carlos-alpha",
    name: "Wendy Carlos Alpha",
    category: "MICROTONAL & CONTEMPORARY",
    info: "1986 Beauty in the Beast · 15.39¢/step",
    cents: [0, 15.39, 30.78, 46.17, 61.56, 76.95, 92.34, 107.73, 123.12, 138.51, 153.9, 169.29000000000002, 184.68, 200.07, 215.46, 230.85000000000002, 246.24, 261.63, 277.02],
  },
  {
    id: "wendy-carlos-beta",
    name: "Wendy Carlos Beta",
    category: "MICROTONAL & CONTEMPORARY",
    info: "1986 · 18.75¢/step",
    cents: [0, 18.75, 37.5, 56.25, 75, 93.75, 112.5, 131.25, 150, 168.75, 187.5, 206.25, 225, 243.75, 262.5, 281.25],
  },
  {
    id: "bohlen-pierce-scale",
    name: "Bohlen-Pierce Scale",
    category: "MICROTONAL & CONTEMPORARY",
    info: "Bohlen/Pierce · 13 divisions of tritave (3:1)",
    cents: [0, 146.30769230769232, 292.61538461538464, 438.92307692307696, 585.2307692307693, 731.5384615384617, 877.8461538461539, 1024.1538461538462, 1170.4615384615386, 1316.769230769231, 1463.0769230769233, 1609.3846153846155, 1755.6923076923078],
  },
  {
    id: "maqam-rast",
    name: "Maqam Rast",
    category: "MIDDLE EASTERN — MAQAM",
    info: "Arabic/Turkish · 7 notes · neutral third",
    cents: [0, 204, 351, 498, 702, 906, 1053],
  },
  {
    id: "maqam-bayati",
    name: "Maqam Bayati",
    category: "MIDDLE EASTERN — MAQAM",
    info: "Arabic/Turkish · 7 notes · neutral second",
    cents: [0, 150, 300, 498, 702, 852, 1002],
  },
  {
    id: "maqam-hijaz",
    name: "Maqam Hijaz",
    category: "MIDDLE EASTERN — MAQAM",
    info: "Arabic/Turkish · 7 notes · augmented second",
    cents: [0, 100, 400, 500, 700, 800, 1000],
  },
  {
    id: "maqam-hijaz-kar",
    name: "Maqam Hijaz Kar",
    category: "MIDDLE EASTERN — MAQAM",
    info: "Arabic · 7 notes · double augmented second",
    cents: [0, 100, 400, 500, 700, 800, 1100],
  },
  {
    id: "maqam-saba",
    name: "Maqam Saba",
    category: "MIDDLE EASTERN — MAQAM",
    info: "Arabic · 7 notes · very low third",
    cents: [0, 150, 280, 498, 648, 798, 1002],
  },
  {
    id: "maqam-sikah",
    name: "Maqam Sikah",
    category: "MIDDLE EASTERN — MAQAM",
    info: "Arabic/Turkish · built on neutral third",
    cents: [0, 204, 351, 551, 702, 853, 1002],
  },
  {
    id: "maqam-nahawand",
    name: "Maqam Nahawand",
    category: "MIDDLE EASTERN — MAQAM",
    info: "Arabic · 7 notes · harmonic minor character",
    cents: [0, 200, 300, 500, 700, 800, 1100],
  },
  {
    id: "maqam-nawa-athar",
    name: "Maqam Nawa Athar",
    category: "MIDDLE EASTERN — MAQAM",
    info: "Arabic · 7 notes",
    cents: [0, 200, 300, 600, 700, 800, 1100],
  },
  {
    id: "makam-ussak",
    name: "Makam Ussak",
    category: "MIDDLE EASTERN — MAQAM",
    info: "Turkish · 7 notes · microtonal inflections",
    cents: [0, 150, 300, 500, 700, 850, 1000],
  },
  {
    id: "persian-shur",
    name: "Persian Shur",
    category: "MIDDLE EASTERN — MAQAM",
    info: "Iranian classical · 7 notes",
    cents: [0, 150, 300, 500, 700, 800, 1000],
  },
  {
    id: "persian-chahargah",
    name: "Persian Chahargah",
    category: "MIDDLE EASTERN — MAQAM",
    info: "Iranian · 7 notes",
    cents: [0, 200, 350, 500, 700, 900, 1050],
  },
  {
    id: "persian-segah",
    name: "Persian Segah",
    category: "MIDDLE EASTERN — MAQAM",
    info: "Iranian · 7 notes",
    cents: [0, 150, 350, 500, 700, 850, 1050],
  },
  {
    id: "raga-bhairav",
    name: "Raga Bhairav",
    category: "SOUTH & EAST ASIAN",
    info: "Indian Hindustani · 7 notes · morning raga",
    cents: [0, 100, 400, 500, 700, 800, 1100],
  },
  {
    id: "raga-bhairavi",
    name: "Raga Bhairavi",
    category: "SOUTH & EAST ASIAN",
    info: "Indian classical · 7 notes · all flat",
    cents: [0, 100, 300, 500, 700, 800, 1000],
  },
  {
    id: "raga-yaman-kalyan",
    name: "Raga Yaman (Kalyan)",
    category: "SOUTH & EAST ASIAN",
    info: "Indian classical · 7 notes · raised fourth · evening",
    cents: [0, 200, 400, 600, 700, 900, 1100],
  },
  {
    id: "raga-kafi",
    name: "Raga Kafi",
    category: "SOUTH & EAST ASIAN",
    info: "Indian classical · 7 notes · Dorian with microtones",
    cents: [0, 200, 290, 500, 700, 900, 980],
  },
  {
    id: "raga-todi",
    name: "Raga Todi",
    category: "SOUTH & EAST ASIAN",
    info: "Indian classical · 7 notes · complex microtonal",
    cents: [0, 100, 300, 600, 700, 800, 1100],
  },
  {
    id: "raga-marwa",
    // Corrected on the way in. The source listed a seventh degree of 0 cents,
    // which sounded the root again where the leading tone should be — and made
    // this the one scale in the library that did not ascend.
    name: "Raga Marwa",
    category: "SOUTH & EAST ASIAN",
    info: "Indian classical · 6 notes · no perfect fifth",
    cents: [0, 100, 400, 600, 900, 1100],
  },
  {
    id: "raga-asavari",
    name: "Raga Asavari",
    category: "SOUTH & EAST ASIAN",
    info: "Indian classical · 7 notes · descending emphasis",
    cents: [0, 200, 300, 500, 700, 800, 1000],
  },
  {
    id: "22-shruti-scale",
    name: "22-Shruti Scale",
    category: "SOUTH & EAST ASIAN",
    info: "Indian classical theory · 22 microtones",
    cents: [0, 22, 90, 112, 182, 204, 270, 294, 316, 386, 408, 498, 520, 590, 612, 702, 724, 792, 814, 884, 906, 996],
  },
  {
    id: "slendro-javanese-gamelan",
    name: "Slendro (Javanese Gamelan)",
    category: "SOUTH & EAST ASIAN",
    info: "Java/Bali · 5 notes · non-equal spacing",
    cents: [0, 231, 474, 711, 951],
  },
  {
    id: "pelog-javanese-gamelan",
    name: "Pelog (Javanese Gamelan)",
    category: "SOUTH & EAST ASIAN",
    info: "Java/Bali · 7 notes · highly unequal",
    cents: [0, 122, 271, 540, 675, 785, 947],
  },
  {
    id: "pelog-selisir-balinese",
    name: "Pelog Selisir (Balinese)",
    category: "SOUTH & EAST ASIAN",
    info: "Balinese Gamelan · 5-note Pelog mode",
    cents: [0, 122, 271, 675, 785],
  },
  {
    id: "japanese-in-scale",
    name: "Japanese In Scale",
    category: "SOUTH & EAST ASIAN",
    info: "Japanese traditional · 5 notes · hemitonic",
    cents: [0, 100, 500, 700, 800],
  },
  {
    id: "japanese-yo-scale-gagaku",
    name: "Japanese Yo Scale (Gagaku)",
    category: "SOUTH & EAST ASIAN",
    info: "Japanese · 5 notes · anhemitonic",
    cents: [0, 200, 500, 700, 900],
  },
  {
    id: "japanese-hirajoshi",
    name: "Japanese Hirajoshi",
    category: "SOUTH & EAST ASIAN",
    info: "Japanese Koto · 5 notes · dark",
    cents: [0, 200, 300, 700, 800],
  },
  {
    id: "japanese-insen",
    name: "Japanese Insen",
    category: "SOUTH & EAST ASIAN",
    info: "Japanese · 5 notes · very sparse",
    cents: [0, 100, 500, 700, 1000],
  },
  {
    id: "chinese-gong-major-pentatonic",
    name: "Chinese Gong (Major Pentatonic)",
    category: "SOUTH & EAST ASIAN",
    info: "Chinese traditional · 5 notes",
    cents: [0, 204, 408, 702, 906],
  },
  {
    id: "chinese-yu-minor-pentatonic",
    name: "Chinese Yu (Minor Pentatonic)",
    category: "SOUTH & EAST ASIAN",
    info: "Chinese traditional · 5 notes",
    cents: [0, 294, 498, 702, 996],
  },
  {
    id: "mongolian-pentatonic",
    name: "Mongolian Pentatonic",
    category: "SOUTH & EAST ASIAN",
    info: "Central Asian · 5 notes",
    cents: [0, 200, 400, 700, 900],
  },
  {
    id: "thai-ranat-scale",
    name: "Thai Ranat Scale",
    category: "SOUTH & EAST ASIAN",
    info: "Thai traditional · 7 near-equidistant tones",
    cents: [0, 171, 343, 514, 686, 857, 1029],
  },
  {
    id: "gamelan-degung-sundanese",
    name: "Gamelan Degung (Sundanese)",
    category: "SOUTH & EAST ASIAN",
    info: "West Java · 5 notes",
    cents: [0, 176, 410, 702, 878],
  },
  {
    id: "sanfen-sunyi-chinese-pythagorean",
    name: "Sanfen Sunyi (Chinese Pythagorean)",
    category: "SOUTH & EAST ASIAN",
    info: "Ancient Chinese · 12 notes · stacked fifths",
    cents: [0, 114, 204, 294, 408, 498, 612, 702, 816, 906, 996, 1110],
  },
];

const BY_ID = new Map(SCALES.map((scale) => [scale.id, scale]));

/** Look a scale up by the id a document stored. */
export function scaleById(id: string): Scale {
  const scale = BY_ID.get(id);
  if (!scale) throw new Error(`Unknown scale: ${id}`);
  return scale;
}

/** Every scale in one category, in the order the library lists them. */
export const scalesInCategory = (category: ScaleCategory): Scale[] =>
  SCALES.filter((scale) => scale.category === category);
