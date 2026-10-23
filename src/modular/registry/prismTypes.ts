// The shape of one effect in `prismCatalog.generated.ts`, which rust/prism-gen
// writes from the prism-fx crate's descriptors.

export type PrismParam = {
  key: string;
  label: string;
  min: number;
  max: number;
  default: number;
  /** Travel is logarithmic in the crate's panels. */
  log: boolean;
  unit: string;
  kind: "continuous" | "int" | "choice" | "toggle";
  /** For a choice, its names in value order: value `i` is `choices[i]`. */
  choices: readonly string[] | null;
  /** Acts only while another control is at this value. */
  when: { key: string; value: number } | null;
};

export type PrismEffect = {
  id: string;
  /** The crate's wire number, which the Rust module is built from. */
  code: number;
  label: string;
  category: string;
  source: string;
  /** A sound the effect takes as well as its input. */
  sound: { key: string; label: string } | null;
  params: readonly PrismParam[];
  groups: readonly { label: string; keys: readonly string[] }[];
  primary: readonly string[];
};
