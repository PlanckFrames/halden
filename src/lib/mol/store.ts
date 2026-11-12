import { create } from "zustand";
import { PRESETS } from "./presets";
import type { Molecule, Preset, StyleName, ToolName } from "./types";
import { cloneMolecule } from "./geometry";

function fromPreset(preset: Preset): Molecule {
  return {
    name: preset.name,
    subtitle: preset.subtitle,
    atoms: preset.atoms.map((atom) => ({ ...atom })),
    bonds: preset.bonds.map((bond) => ({ ...bond })),
    cell: preset.cell
      ? {
          origin: [...preset.cell.origin],
          a: [...preset.cell.a],
          b: [...preset.cell.b],
          c: [...preset.cell.c],
        }
      : null,
    charge: 0,
    multiplicity: 1,
  };
}

type WorkbenchState = {
  mol: Molecule;
  sourceId: string | null;
  tool: ToolName;
  style: StyleName;
  element: string;
  bondOrder: number;
  selected: number[];
  showCell: boolean;
  viewToken: number;
  history: Molecule[];
  future: Molecule[];
  bondAnchor: number | null;
  setTool: (tool: ToolName) => void;
  setStyle: (style: StyleName) => void;
  setElement: (element: string) => void;
  setBondOrder: (order: number) => void;
  setShowCell: (show: boolean) => void;
  select: (index: number, shift: boolean) => void;
  setSelected: (ids: number[]) => void;
  clearSelection: () => void;
  loadPreset: (id: string) => void;
  clearMolecule: () => void;
  commit: (recipe: (draft: Molecule) => void, refit?: boolean) => void;
  replace: (mol: Molecule, refit?: boolean) => void;
  patchAtoms: (recipe: (draft: Molecule) => void) => void;
  undo: () => void;
  redo: () => void;
  setCharge: (charge: number) => void;
  setMultiplicity: (multiplicity: number) => void;
  setBondAnchor: (index: number | null) => void;
};

const initial = PRESETS[0]!;

export const useWorkbench = create<WorkbenchState>((set, get) => ({
  mol: fromPreset(initial),
  sourceId: initial.id,
  tool: "navigate",
  style: initial.style,
  element: "C",
  bondOrder: 1,
  selected: [],
  showCell: Boolean(initial.cell),
  viewToken: 1,
  history: [],
  future: [],
  bondAnchor: null,

  setTool: (tool) => set({ tool, bondAnchor: tool === "bond" ? get().bondAnchor : null }),
  setStyle: (style) => set({ style }),
  setElement: (element) => set({ element }),
  setBondOrder: (bondOrder) => set({ bondOrder }),
  setShowCell: (showCell) => set({ showCell }),
  setBondAnchor: (bondAnchor) => set({ bondAnchor }),

  select: (index, shift) => {
    const selected = get().selected;
    if (!shift) {
      set({ selected: selected.length === 1 && selected[0] === index ? [] : [index] });
      return;
    }
    set({
      selected: selected.includes(index) ? selected.filter((id) => id !== index) : [...selected, index],
    });
  },
  setSelected: (ids) => set({ selected: ids }),
  clearSelection: () => set({ selected: [], bondAnchor: null }),

  loadPreset: (id) => {
    const preset = PRESETS.find((item) => item.id === id);
    if (!preset) return;
    const prev = cloneMolecule(get().mol);
    set({
      mol: fromPreset(preset),
      sourceId: id,
      style: preset.style,
      selected: [],
      bondAnchor: null,
      showCell: Boolean(preset.cell),
      history: [...get().history, prev].slice(-40),
      future: [],
      viewToken: get().viewToken + 1,
    });
  },

  clearMolecule: () => {
    const prev = cloneMolecule(get().mol);
    set({
      mol: {
        name: "Untitled",
        subtitle: "Draw in the viewport",
        atoms: [],
        bonds: [],
        cell: null,
        charge: 0,
        multiplicity: 1,
      },
      sourceId: null,
      selected: [],
      bondAnchor: null,
      history: [...get().history, prev].slice(-40),
      future: [],
      viewToken: get().viewToken + 1,
    });
  },

  commit: (recipe, refit = false) => {
    const prev = cloneMolecule(get().mol);
    const draft = cloneMolecule(get().mol);
    recipe(draft);
    set({
      mol: draft,
      history: [...get().history, prev].slice(-40),
      future: [],
      viewToken: refit ? get().viewToken + 1 : get().viewToken,
    });
  },

  replace: (mol, refit = true) => {
    const prev = cloneMolecule(get().mol);
    set({
      mol,
      selected: [],
      bondAnchor: null,
      history: [...get().history, prev].slice(-40),
      future: [],
      viewToken: refit ? get().viewToken + 1 : get().viewToken,
    });
  },

  patchAtoms: (recipe) => {
    const draft = cloneMolecule(get().mol);
    recipe(draft);
    set({ mol: draft });
  },

  undo: () => {
    const history = get().history;
    const prev = history[history.length - 1];
    if (!prev) return;
    set({
      mol: prev,
      history: history.slice(0, -1),
      future: [cloneMolecule(get().mol), ...get().future].slice(0, 40),
      selected: [],
      bondAnchor: null,
      viewToken: get().viewToken + 1,
    });
  },

  redo: () => {
    const [next, ...rest] = get().future;
    if (!next) return;
    set({
      history: [...get().history, cloneMolecule(get().mol)].slice(-40),
      future: rest,
      mol: next,
      selected: [],
      bondAnchor: null,
      viewToken: get().viewToken + 1,
    });
  },

  setCharge: (charge) => set({ mol: { ...get().mol, charge } }),
  setMultiplicity: (multiplicity) => set({ mol: { ...get().mol, multiplicity } }),
}));

export { PRESETS };
