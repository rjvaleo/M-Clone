/**
 * M's edit windows as modules: Note Density, Velocity Range, Transposition
 * and Note Order, four voices each. Each edits M Variables' values at that
 * Variable's active position, and its six position boxes switch that
 * position, as clicking them does in M.
 */

import { M_LAB_TYPES } from "../../registry/mLabModules";
import { variablesStateOf } from "../../mlab/links";
import { activate, setTableValue, type MVariable, type VariablesState } from "../../mlab/variables";
import { N4Panel } from "../n4/kit";
import { DensityEditor, EditorHead, NoteOrderEditor, TranspositionEditor, VelocityEditor } from "./VariableEditors";
import { findNodeOfType, useMLabHost, type MLabFaceProps } from "./common";

const VOICES = [0, 1, 2, 3];
type Table = "density" | "velocityRange" | "transposition" | "noteOrder";
const TITLES: Record<Table, string> = {
  density: "Note Density", velocityRange: "Velocity Range", transposition: "Transposition", noteOrder: "Note Order",
};

function EditWindow({ table }: { table: Table }) {
  const host = useMLabHost();
  const variables = findNodeOfType(host?.graph, M_LAB_TYPES.variables);
  if (!host || !variables) {
    return <N4Panel accent="orange"><p className="n4-muted m-ed__empty">Add M Variables to the canvas: this edits its values.</p></N4Panel>;
  }
  const state = variablesStateOf(variables);
  const write = (next: VariablesState) => host.setNodeParameters(variables.id, { tables: next.tables as never, active: next.active as never });
  const variable: MVariable = table;
  const position = state.active[variable];
  const set = <K extends Table>(v: number, value: VariablesState["tables"][K][number][number]) =>
    write(setTableValue(state, table as K, position, v, value));
  const values = VOICES.map((v) => state.tables[table][position][v]);
  return (
    <N4Panel accent="orange">
      <section className="m-ed-window">
        <EditorHead title={TITLES[table]} position={position} onPosition={(p) => write(activate(state, variable, p))} />
        {table === "density" && <DensityEditor values={values as number[]} onChange={(v, x) => set<"density">(v, x)} />}
        {table === "velocityRange" && <VelocityEditor values={values as never} onChange={(v, r) => set<"velocityRange">(v, r)} />}
        {table === "transposition" && <TranspositionEditor values={values as number[]} onChange={(v, t) => set<"transposition">(v, t)} />}
        {table === "noteOrder" && <NoteOrderEditor values={values as never} onChange={(v, m) => set<"noteOrder">(v, m)} />}
      </section>
    </N4Panel>
  );
}

export const DensityFace = (_props: MLabFaceProps) => <EditWindow table="density" />;
export const VelocityRangeFace = (_props: MLabFaceProps) => <EditWindow table="velocityRange" />;
export const TranspositionFace = (_props: MLabFaceProps) => <EditWindow table="transposition" />;
export const NoteOrderFace = (_props: MLabFaceProps) => <EditWindow table="noteOrder" />;
