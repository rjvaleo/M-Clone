// The effects shared with MultiGrainLive, as idMLab modules.
//
// Every range, default, choice and panel group comes from the prism-fx crate,
// through `prismCatalog.generated.ts`; this file only translates them into
// descriptors and into the tables the Rust bridge reads. Nothing here should
// ever restate a value the crate owns — a range changed there reaches every
// face here by regenerating the catalogue, and fails the checks until it is.
//
// The modules run on the Rust engine, where each is a `PrismModule` built from
// its effect's `code`. On Web Audio they pass their input through untouched:
// the effects themselves exist only in Rust.

import type { ModuleDescriptor, NodeFaceSection, ParameterDescriptor } from "../model/graph";
import { AUDIO_MUTE_PARAM } from "./audioModules";
import {
  boolParam,
  custom,
  defineModule,
  enumParam,
  input,
  numberParam,
  output,
  param,
  section,
  stringParam,
} from "./descriptorKit";
import { PRISM_CATALOG } from "./prismCatalog.generated";
import type { PrismEffect, PrismParam } from "./prismTypes";

/** The module type an effect is registered under. */
export const prismType = (id: string): string => `m.prism-${id}`;

/**
 * Names for the effects whose crate label is already one of idMLab's own
 * modules: MultiGrainLive's rack gain, EQ and compressor share their names
 * with the Web Audio Gain, EQ and Compressor. The menu and the registry need
 * every label distinct, so these say whose they are, as the Hyperprism
 * effects do.
 */
const LABELS_TAKEN_BY_IDMLAB: Readonly<Record<string, string>> = {
  gain: "MultiGrainLive Gain",
  eq: "MultiGrainLive EQ",
  compressor: "MultiGrainLive Compressor",
};

/** The label an effect is listed under in idMLab. */
export const prismLabel = (effect: PrismEffect): string => LABELS_TAKEN_BY_IDMLAB[effect.id] ?? effect.label;

/**
 * The rack's fade handle in a prism module's index table. Not `level`: an
 * effect from the crate may have a control of that name (Hyper Stereo does).
 */
export const PRISM_FADE_KEY = "rack-fade";

/** The structural parameter a sound-taking effect names its sound with. */
export const PRISM_SOUND_PARAM = "asset-id";

/**
 * A step fine enough for the travel: a hundredth of the bottom of a
 * logarithmic range, a thousandth of a linear one.
 */
const stepFor = (p: PrismParam): number => (p.log ? p.min / 100 : (p.max - p.min) / 1000);

const control = (p: PrismParam): ParameterDescriptor => {
  switch (p.kind) {
    case "choice":
      // Names on the face; the compiler sends the engine the option's index,
      // which is the value the kernel reads.
      return enumParam(p.key, p.label, p.choices ?? [], p.choices?.[p.default]);
    case "toggle":
      return boolParam(p.key, p.label, p.default >= (p.min + p.max) / 2);
    case "int":
      return numberParam(p.key, p.label, p.default, p.min, p.max, 1, p.unit || undefined);
    case "continuous":
      return numberParam(p.key, p.label, p.default, p.min, p.max, stepFor(p), p.unit || undefined);
  }
};

const descriptorFor = (effect: PrismEffect): ModuleDescriptor => {
  // An inert control is the original's dead knob, kept by the crate only for
  // the documents that store it: it is no control here, and the kernel keeps
  // its default. Every other control keeps its crate index all the same.
  const controls = effect.params.filter((p) => !p.inert);
  const grouped = new Set(effect.groups.flatMap((group) => group.keys));
  const loose = controls.filter((p) => !grouped.has(p.key)).map((p) => param(p.key));
  const sections: NodeFaceSection[] = [
    ...(effect.sound
      ? [section("sound", effect.sound.label, [custom("asset-slot", effect.sound.label, [PRISM_SOUND_PARAM])])]
      : []),
    ...effect.groups.map((group, index) => section(`group-${index + 1}`, group.label, group.keys.map(param))),
    ...(loose.length > 0 ? [section("more", "More", loose)] : []),
    section("state", "State", [param(AUDIO_MUTE_PARAM)]),
  ];
  return defineModule({
    type: prismType(effect.id),
    label: prismLabel(effect),
    family: "audio",
    colorToken: "audio",
    ports: [
      input("audio-in", "Audio", { kind: "audio", channels: 2 }, { merge: "sum" }),
      output("audio-out", "Audio", { kind: "audio", channels: 2 }),
    ],
    parameters: [
      ...controls.map(control),
      ...(effect.sound
        ? [{ ...stringParam(PRISM_SOUND_PARAM, effect.sound.label), smoothing: "none" as const, morph: "step-end" as const }]
        : []),
      boolParam(AUDIO_MUTE_PARAM, "Mute"),
    ],
    face: sections,
  });
};

export const PRISM_MODULES: ModuleDescriptor[] = PRISM_CATALOG.map(descriptorFor);

/** Each prism module's type → its effect's wire number. */
export const PRISM_CODES: Readonly<Record<string, number>> = Object.fromEntries(
  PRISM_CATALOG.map((effect) => [prismType(effect.id), effect.code]),
);

/**
 * Where each control lands in the Rust module's parameters: the kernel's, in
 * the crate's order, then the rack's fade handle under `PRISM_FADE_KEY`. An
 * inert control has no entry, as it is no control here; its index is skipped,
 * not reused.
 */
export const PRISM_PARAM_INDICES: Readonly<Record<string, Readonly<Record<string, number>>>> =
  Object.fromEntries(
    PRISM_CATALOG.map((effect) => [
      prismType(effect.id),
      {
        ...Object.fromEntries(
          effect.params.flatMap((p, index) => (p.inert ? [] : [[p.key, index] as const])),
        ),
        [PRISM_FADE_KEY]: effect.params.length,
      },
    ]),
  );

/** The sound an effect takes is structural: it reaches Rust as a sample slot. */
export const PRISM_STRUCTURE_PARAMS: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  PRISM_CATALOG.filter((effect) => effect.sound).map((effect) => [prismType(effect.id), [PRISM_SOUND_PARAM]]),
);

/** The prism modules that take a sound. */
export const PRISM_SOUND_TYPES: ReadonlySet<string> = new Set(Object.keys(PRISM_STRUCTURE_PARAMS));
