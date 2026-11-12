import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Copy,
  Download,
  Eraser,
  FileOutput,
  Library,
  Link2,
  List,
  Lock,
  LockOpen,
  MousePointer2,
  Move,
  Pencil,
  Play,
  Redo2,
  Rotate3d,
  Square,
  Undo2,
} from "lucide-react";
import { Viewport } from "@/components/mol/viewport";
import { elementOf, formulaOf, PALETTE } from "@/lib/mol/elements";
import { FORMATS, renderFormat, slug, type FormatId } from "@/lib/mol/export";
import { addHydrogens, deleteAtoms, measureSelection, parseCoordinateText } from "@/lib/mol/geometry";
import { PRESETS, useWorkbench } from "@/lib/mol/store";
import type { StyleName, ToolName } from "@/lib/mol/types";
import uffSource from "@/lib/mol/uff_engine.py?raw";

const TOOLS: { id: ToolName; label: string; hint: string; icon: typeof Rotate3d }[] = [
  { id: "navigate", label: "Orbit", hint: "Drag to orbit. Scroll to zoom.", icon: Rotate3d },
  { id: "select", label: "Select", hint: "Click an atom. Shift adds to the selection.", icon: MousePointer2 },
  { id: "draw", label: "Draw", hint: "Click empty space to place. Drag from an atom to grow a bond.", icon: Pencil },
  { id: "move", label: "Move", hint: "Drag an atom. A selection moves together.", icon: Move },
  { id: "erase", label: "Erase", hint: "Click an atom to delete it.", icon: Eraser },
  { id: "bond", label: "Bond", hint: "Two clicks cycle none, single, double, triple, aromatic.", icon: Link2 },
];

const ORDERS = [
  { order: 1, label: "1" },
  { order: 1.5, label: "Ar" },
  { order: 2, label: "2" },
  { order: 3, label: "3" },
] as const;

const STYLES: { id: StyleName; label: string }[] = [
  { id: "ball", label: "Ball" },
  { id: "stick", label: "Stick" },
  { id: "space", label: "Space" },
  { id: "wire", label: "Wire" },
  { id: "ribbon", label: "Ribbon" },
];

const DARK_ON_ELEMENT = new Set(["H", "F", "S", "Cl", "Si", "P"]);

function nextBondOrder(order: number): number {
  if (Math.abs(order - 1.5) < 0.2) return 0;
  if (order < 0.2) return 1;
  if (order < 1.2) return 2;
  if (order < 2.2) return 3;
  if (order < 3.2) return 1.5;
  return 0;
}

function formulaFromAtoms(atoms: { el: string }[]): string {
  const counts = new Map<string, number>();
  for (const atom of atoms) counts.set(atom.el, (counts.get(atom.el) ?? 0) + 1);
  return counts.size ? formulaOf(counts) : "empty";
}

export function Workbench() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      const api = useWorkbench.getState();
      if (event.key === "Escape") {
        api.clearSelection();
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        if (!api.selected.length) return;
        event.preventDefault();
        api.replace(deleteAtoms(api.mol, api.selected), false);
        return;
      }
      if (event.key === "f" || event.key === "F") {
        if (!api.selected.length) return;
        const thaw = api.selected.some((index) => api.mol.atoms[index] && !api.mol.atoms[index]!.frozen);
        api.commit((draft) => {
          for (const index of api.selected) {
            const atom = draft.atoms[index];
            if (atom) atom.frozen = thaw;
          }
        });
        return;
      }
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) api.redo();
        else api.undo();
      } else if (meta && event.key.toLowerCase() === "y") {
        event.preventDefault();
        api.redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-bg text-ink">
      <HeaderBar />
      <div className="app-shell">
        <ToolRail />
        <Stage />
        <SidePanel />
      </div>
    </main>
  );
}

function HeaderBar() {
  const name = useWorkbench((s) => s.mol.name);
  const subtitle = useWorkbench((s) => s.mol.subtitle);
  const atoms = useWorkbench((s) => s.mol.atoms);
  const formula = useMemo(() => formulaFromAtoms(atoms), [atoms]);
  const frozen = atoms.filter((atom) => atom.frozen).length;

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-3">
      <div className="shrink-0 border-l-2 border-brass pl-2">
        <h1 className="font-display text-xl leading-none text-ink">Halden</h1>
        <p className="text-xs text-muted">Molecular workbench</p>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="truncate text-xs text-muted">
          {subtitle}
          {" · "}
          {formula}
          {" · "}
          {atoms.length} atoms
          {frozen ? ` · ${frozen} frozen` : ""}
        </p>
      </div>
    </header>
  );
}

function ToolRail() {
  const tool = useWorkbench((s) => s.tool);
  const element = useWorkbench((s) => s.element);
  const bondOrder = useWorkbench((s) => s.bondOrder);
  const setTool = useWorkbench((s) => s.setTool);
  const setElement = useWorkbench((s) => s.setElement);
  const setBondOrder = useWorkbench((s) => s.setBondOrder);
  const undo = useWorkbench((s) => s.undo);
  const redo = useWorkbench((s) => s.redo);
  const history = useWorkbench((s) => s.history.length);
  const future = useWorkbench((s) => s.future.length);

  return (
    <nav
      aria-label="Tools"
      className="flex min-h-0 min-w-0 items-center gap-1 overflow-x-auto border-b border-line bg-panel p-1 lg:flex-col lg:items-stretch lg:overflow-x-hidden lg:overflow-y-auto lg:border-r lg:border-b-0"
    >
      {TOOLS.map((item) => {
        const Icon = item.icon;
        const active = tool === item.id;
        return (
          <button
            key={item.id}
            type="button"
            title={item.hint}
            aria-label={item.label}
            aria-pressed={active}
            onClick={() => setTool(item.id)}
            className={
              "flex size-11 shrink-0 items-center justify-center rounded-md " +
              (active ? "bg-brass text-brass-ink" : "text-ink hover:bg-panel-2")
            }
          >
            <Icon className="size-5" strokeWidth={1.75} />
          </button>
        );
      })}
      <span className="mx-1 h-6 w-px shrink-0 bg-line lg:mx-1 lg:h-px lg:w-auto" />
      {PALETTE.map((symbol) => {
        const info = elementOf(symbol);
        const active = element === symbol;
        return (
          <button
            key={symbol}
            type="button"
            title={info.name}
            aria-label={info.name}
            aria-pressed={active}
            onClick={() => setElement(symbol)}
            className={
              "flex size-11 shrink-0 items-center justify-center rounded-full text-xs font-semibold " +
              (DARK_ON_ELEMENT.has(symbol) ? "text-brass-ink" : "text-ink") +
              (active ? " ring-2 ring-brass ring-offset-2 ring-offset-panel" : "")
            }
            style={{ backgroundColor: info.color }}
          >
            {symbol}
          </button>
        );
      })}
      <span className="mx-1 h-6 w-px shrink-0 bg-line lg:mx-1 lg:h-px lg:w-auto" />
      {ORDERS.map((item) => {
        const active = bondOrder === item.order;
        return (
          <button
            key={item.label}
            type="button"
            aria-label={`Bond order ${item.label}`}
            aria-pressed={active}
            onClick={() => setBondOrder(item.order)}
            className={
              "flex size-11 shrink-0 items-center justify-center rounded-md font-mono text-sm " +
              (active ? "bg-brass text-brass-ink" : "bg-panel-2 text-ink")
            }
          >
            {item.label}
          </button>
        );
      })}
      <span className="mx-1 h-6 w-px shrink-0 bg-line lg:mx-1 lg:h-px lg:w-auto" />
      <button
        type="button"
        aria-label="Undo"
        title="Undo"
        disabled={history === 0}
        onClick={() => undo()}
        className="flex size-11 shrink-0 items-center justify-center rounded-md text-ink hover:bg-panel-2 disabled:opacity-40"
      >
        <Undo2 className="size-5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        aria-label="Redo"
        title="Redo"
        disabled={future === 0}
        onClick={() => redo()}
        className="flex size-11 shrink-0 items-center justify-center rounded-md text-ink hover:bg-panel-2 disabled:opacity-40"
      >
        <Redo2 className="size-5" strokeWidth={1.75} />
      </button>
    </nav>
  );
}

function Stage() {
  const mol = useWorkbench((s) => s.mol);
  const style = useWorkbench((s) => s.style);
  const selected = useWorkbench((s) => s.selected);
  const tool = useWorkbench((s) => s.tool);
  const element = useWorkbench((s) => s.element);
  const bondOrder = useWorkbench((s) => s.bondOrder);
  const showCell = useWorkbench((s) => s.showCell);
  const viewToken = useWorkbench((s) => s.viewToken);
  const bondAnchor = useWorkbench((s) => s.bondAnchor);
  const moving = useRef(false);

  useEffect(() => {
    const up = () => {
      moving.current = false;
    };
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);

  const onSelect = useCallback((index: number, shift: boolean) => {
    useWorkbench.getState().select(index, shift);
  }, []);
  const onClear = useCallback(() => {
    useWorkbench.getState().clearSelection();
  }, []);
  const onPlace = useCallback((x: number, y: number, z: number) => {
    const api = useWorkbench.getState();
    api.commit((draft) => {
      draft.atoms.push({ el: api.element, x, y, z, frozen: false });
    });
  }, []);
  const onGrow = useCallback((from: number, x: number, y: number, z: number) => {
    const api = useWorkbench.getState();
    api.commit((draft) => {
      const j = draft.atoms.length;
      draft.atoms.push({ el: api.element, x, y, z, frozen: false });
      draft.bonds.push({ i: from, j, order: api.bondOrder });
    });
  }, []);
  const onTransmute = useCallback((index: number) => {
    const api = useWorkbench.getState();
    api.commit((draft) => {
      const atom = draft.atoms[index];
      if (atom) atom.el = api.element;
    });
  }, []);
  const onErase = useCallback((index: number) => {
    const api = useWorkbench.getState();
    api.replace(deleteAtoms(api.mol, [index]), false);
  }, []);
  const onMove = useCallback((ids: number[], dx: number, dy: number, dz: number) => {
    const api = useWorkbench.getState();
    if (!moving.current) {
      api.commit(() => undefined);
      moving.current = true;
    }
    useWorkbench.getState().patchAtoms((draft) => {
      for (const id of ids) {
        const atom = draft.atoms[id];
        if (!atom) continue;
        atom.x += dx;
        atom.y += dy;
        atom.z += dz;
      }
    });
  }, []);
  const onBond = useCallback((index: number) => {
    const api = useWorkbench.getState();
    if (api.bondAnchor === null || api.bondAnchor === index) {
      api.setBondAnchor(api.bondAnchor === index ? null : index);
      return;
    }
    const a = api.bondAnchor;
    const b = index;
    api.commit((draft) => {
      const found = draft.bonds.findIndex(
        (bond) => (bond.i === a && bond.j === b) || (bond.i === b && bond.j === a),
      );
      const order = found >= 0 ? draft.bonds[found]!.order : 0;
      const next = nextBondOrder(order);
      if (next === 0) {
        if (found >= 0) draft.bonds.splice(found, 1);
        return;
      }
      if (found >= 0) draft.bonds[found]!.order = next;
      else draft.bonds.push({ i: a, j: b, order: next });
    });
    api.setBondAnchor(null);
  }, []);

  const highlight = useMemo(() => {
    if (bondAnchor === null || selected.includes(bondAnchor)) return selected;
    return [...selected, bondAnchor];
  }, [bondAnchor, selected]);

  const hint = TOOLS.find((item) => item.id === tool)?.hint ?? "";

  return (
    <section className="relative min-h-0 min-w-0 bg-bg">
      <Viewport
        mol={mol}
        style={style}
        selected={highlight}
        tool={tool}
        element={element}
        bondOrder={bondOrder}
        showCell={showCell}
        viewToken={viewToken}
        onSelect={onSelect}
        onClear={onClear}
        onPlace={onPlace}
        onGrow={onGrow}
        onTransmute={onTransmute}
        onErase={onErase}
        onMove={onMove}
        onBond={onBond}
      />
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="pointer-events-auto flex flex-wrap gap-1 rounded-lg border border-line bg-panel p-1">
            {STYLES.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={style === item.id}
                onClick={() => useWorkbench.getState().setStyle(item.id)}
                className={
                  "min-h-11 rounded-md px-3 text-sm " +
                  (style === item.id ? "bg-brass text-brass-ink" : "text-ink hover:bg-panel-2")
                }
              >
                {item.label}
              </button>
            ))}
            <label className="flex min-h-11 items-center gap-2 px-2 text-sm text-muted">
              <input
                type="checkbox"
                className="size-4 accent-brass"
                checked={showCell && Boolean(mol.cell)}
                disabled={!mol.cell}
                onChange={(event) => useWorkbench.getState().setShowCell(event.target.checked)}
              />
              Cell
            </label>
          </div>
        </div>
        <div className="flex items-end justify-between gap-2">
          <p className="max-w-sm rounded-md bg-panel px-3 py-2 text-xs text-muted">
            {bondAnchor !== null ? `Bond from atom ${bondAnchor + 1}. Click a second atom.` : hint}
            {mol.atoms.length === 0 ? " The canvas is empty — pick an element and draw, or open the library." : ""}
            {" Scroll to zoom. Right-drag orbits."}
          </p>
        </div>
      </div>
    </section>
  );
}

function SidePanel() {
  const [tab, setTab] = useState<"library" | "atoms" | "export">("library");
  const tabs = [
    { id: "library" as const, label: "Library", icon: Library },
    { id: "atoms" as const, label: "Atoms", icon: List },
    { id: "export" as const, label: "Export", icon: FileOutput },
  ];

  return (
    <aside className="flex min-h-0 min-w-0 flex-col border-t border-line bg-panel lg:border-t-0 lg:border-l">
      <div role="tablist" aria-label="Structure" className="flex shrink-0 border-b border-line">
        {tabs.map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(item.id)}
              className={
                "flex min-h-11 flex-1 items-center justify-center gap-2 text-sm " +
                (active ? "border-b-2 border-brass text-ink" : "text-muted")
              }
            >
              <Icon className="size-4" strokeWidth={1.75} />
              {item.label}
            </button>
          );
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "library" ? <LibraryPane /> : null}
        {tab === "atoms" ? <AtomsPane /> : null}
        {tab === "export" ? <ExportPane /> : null}
      </div>
      <RelaxDock />
    </aside>
  );
}

function LibraryPane() {
  const sourceId = useWorkbench((s) => s.sourceId);
  return (
    <div className="flex flex-col gap-2 p-3">
      <p className="text-xs text-muted">Three structures ship with the page. Nothing is fetched.</p>
      {PRESETS.map((preset) => {
        const active = sourceId === preset.id;
        return (
          <button
            key={preset.id}
            type="button"
            onClick={() => useWorkbench.getState().loadPreset(preset.id)}
            className={
              "rounded-lg border p-3 text-left " +
              (active ? "border-brass bg-panel-2" : "border-line bg-bg hover:border-brass")
            }
          >
            <span className="block text-sm font-medium">{preset.name}</span>
            <span className="mt-1 block text-xs text-sage">{preset.subtitle}</span>
            <span className="mt-1 block font-mono text-xs text-muted">{preset.formula}</span>
            <span className="mt-2 block text-sm leading-snug text-muted">{preset.detail}</span>
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => useWorkbench.getState().clearMolecule()}
        className="min-h-11 rounded-lg border border-line bg-bg px-3 text-sm text-ink hover:border-brass"
      >
        Blank canvas
      </button>
    </div>
  );
}

function AtomsPane() {
  const mol = useWorkbench((s) => s.mol);
  const selected = useWorkbench((s) => s.selected);
  const [paste, setPaste] = useState("");
  const [error, setError] = useState("");
  const measure = measureSelection(mol, selected);

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {selected.length ? `${selected.length} selected` : "Click a row to select"}
          {measure ? ` · ${measure}` : ""}
        </p>
        <button
          type="button"
          onClick={() => useWorkbench.getState().replace(addHydrogens(useWorkbench.getState().mol), false)}
          className="min-h-11 rounded-md border border-line bg-panel-2 px-3 text-sm text-ink hover:border-brass"
        >
          Add hydrogens
        </button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-max text-left text-xs">
          <thead className="sticky top-0 bg-panel-2 text-muted">
            <tr>
              <th className="px-2 py-2 font-medium">#</th>
              <th className="px-2 py-2 font-medium">El</th>
              <th className="px-2 py-2 font-medium">Res</th>
              <th className="px-2 py-2 font-medium">x</th>
              <th className="px-2 py-2 font-medium">y</th>
              <th className="px-2 py-2 font-medium">z</th>
              <th className="px-2 py-2 font-medium">Freeze</th>
            </tr>
          </thead>
          <tbody>
            {mol.atoms.map((atom, index) => {
              const on = selected.includes(index);
              return (
                <tr
                  key={`${index}-${atom.el}`}
                  onClick={(event) => useWorkbench.getState().select(index, event.shiftKey)}
                  className={on ? "bg-panel-2" : "bg-bg"}
                >
                  <td className="px-2 py-1 font-mono text-muted">{index + 1}</td>
                  <td className="px-2 py-1 font-medium">{atom.el}</td>
                  <td className="px-2 py-1 text-muted">{atom.res ?? atom.name ?? ""}</td>
                  <td className="px-1 py-1">
                    <CoordField
                      value={atom.x}
                      onCommit={(value) =>
                        useWorkbench.getState().commit((draft) => {
                          const target = draft.atoms[index];
                          if (target) target.x = value;
                        })
                      }
                    />
                  </td>
                  <td className="px-1 py-1">
                    <CoordField
                      value={atom.y}
                      onCommit={(value) =>
                        useWorkbench.getState().commit((draft) => {
                          const target = draft.atoms[index];
                          if (target) target.y = value;
                        })
                      }
                    />
                  </td>
                  <td className="px-1 py-1">
                    <CoordField
                      value={atom.z}
                      onCommit={(value) =>
                        useWorkbench.getState().commit((draft) => {
                          const target = draft.atoms[index];
                          if (target) target.z = value;
                        })
                      }
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="checkbox"
                      className="size-4 accent-brass"
                      checked={atom.frozen}
                      aria-label={`Freeze atom ${index + 1}`}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => {
                        const frozen = event.target.checked;
                        useWorkbench.getState().commit((draft) => {
                          const target = draft.atoms[index];
                          if (target) target.frozen = frozen;
                        });
                      }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {mol.atoms.length === 0 ? <p className="p-3 text-sm text-muted">No atoms yet.</p> : null}
      </div>
      <label className="flex flex-col gap-1 text-sm text-muted">
        Paste XYZ
        <textarea
          value={paste}
          onChange={(event) => setPaste(event.target.value)}
          rows={5}
          spellCheck={false}
          placeholder={"3\ncomment\nO  0  0  0\nH  0.96  0  0\nH  -0.24  0.93  0"}
          className="min-h-24 rounded-md border border-line bg-bg p-2 font-mono text-xs text-ink"
        />
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            const parsed = parseCoordinateText(paste, useWorkbench.getState().mol);
            if (!parsed.ok) {
              setError(parsed.error);
              return;
            }
            setError("");
            useWorkbench.getState().replace(parsed.mol, true);
          }}
          className="min-h-11 rounded-md bg-brass px-3 text-sm font-medium text-brass-ink"
        >
          Apply coordinates
        </button>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
      </div>
    </div>
  );
}

function CoordField({ value, onCommit }: { value: number; onCommit: (next: number) => void }) {
  const [text, setText] = useState(() => value.toFixed(4));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value.toFixed(4));
  }, [value]);
  return (
    <input
      value={text}
      inputMode="decimal"
      aria-label="Coordinate"
      onClick={(event) => event.stopPropagation()}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        focused.current = false;
        const next = Number(text);
        if (Number.isFinite(next) && Math.abs(next - value) > 1e-8) onCommit(next);
        else setText(value.toFixed(4));
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") (event.currentTarget as HTMLInputElement).blur();
      }}
      className="w-20 rounded-sm border border-line bg-bg px-1 py-1 font-mono text-ink"
    />
  );
}

function ExportPane() {
  const mol = useWorkbench((s) => s.mol);
  const [format, setFormat] = useState<FormatId>("xyz");
  const [copied, setCopied] = useState(false);
  const text = useMemo(() => renderFormat(mol, format), [mol, format]);
  const meta = FORMATS.find((item) => item.id === format) ?? FORMATS[0]!;

  return (
    <div className="flex flex-col gap-3 p-3">
      <label className="flex flex-col gap-1 text-sm text-muted">
        Format
        <select
          value={format}
          onChange={(event) => setFormat(event.target.value as FormatId)}
          className="min-h-11 rounded-md border border-line bg-bg px-2 text-sm text-ink"
        >
          {FORMATS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-muted">{meta.hint}. Frozen atoms are written as constraints where the program supports them.</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-sm text-muted">
          Charge
          <input
            type="number"
            value={mol.charge}
            onChange={(event) => useWorkbench.getState().setCharge(Number(event.target.value) || 0)}
            className="min-h-11 rounded-md border border-line bg-bg px-2 font-mono text-sm text-ink"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-muted">
          Multiplicity
          <input
            type="number"
            min={1}
            value={mol.multiplicity}
            onChange={(event) => useWorkbench.getState().setMultiplicity(Math.max(1, Number(event.target.value) || 1))}
            className="min-h-11 rounded-md border border-line bg-bg px-2 font-mono text-sm text-ink"
          />
        </label>
      </div>
      <textarea readOnly value={text} spellCheck={false} rows={12} className="min-h-40 w-full rounded-md border border-line bg-bg p-2 font-mono text-xs text-ink" />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            });
          }}
          className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md border border-line bg-panel-2 text-sm text-ink"
        >
          <Copy className="size-4" />
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          type="button"
          onClick={() => {
            const blob = new Blob([text], { type: "text/plain" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `${slug(mol.name)}.${meta.ext}`;
            link.click();
            URL.revokeObjectURL(url);
          }}
          className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md bg-brass text-sm font-medium text-brass-ink"
        >
          <Download className="size-4" />
          Download
        </button>
      </div>
      <details className="rounded-lg border border-line bg-bg p-3">
        <summary className="cursor-pointer text-sm text-ink">Python UFF engine</summary>
        <p className="mt-2 text-xs leading-snug text-muted">
          Relaxation runs this file in CPython via Pyodide. The same source pre-optimized the ibuprofen coordinates.
        </p>
        <pre className="mt-2 max-h-48 overflow-auto font-mono text-xs text-sage">{uffSource}</pre>
      </details>
    </div>
  );
}

function RelaxDock() {
  const apiRef = useRef<typeof import("@/lib/mol/relax") | null>(null);
  const jobRef = useRef(0);
  const [status, setStatus] = useState<"loading" | "ready" | "running" | "error">("loading");
  const [message, setMessage] = useState("Loading CPython…");
  const [energy, setEnergy] = useState<number | null>(null);
  const [force, setForce] = useState<number | null>(null);
  const [step, setStep] = useState(0);
  const [maxSteps, setMaxSteps] = useState(0);
  const total = useWorkbench((s) => s.mol.atoms.length);
  const movable = useWorkbench((s) => s.mol.atoms.reduce((count, atom) => count + (atom.frozen ? 0 : 1), 0));
  const selectedCount = useWorkbench((s) => s.selected.length);

  const attach = useCallback((api: typeof import("@/lib/mol/relax")) => {
    api.onRelaxStep((report) => {
      if (report.error) {
        setStatus("error");
        setMessage(report.error);
        return;
      }
      const state = useWorkbench.getState();
      if (report.positions.length !== state.mol.atoms.length) {
        api.cancelRelax();
        setStatus("ready");
        setMessage("Python ready · UFF in CPython via Pyodide");
        return;
      }
      state.patchAtoms((draft) => {
        report.positions.forEach((xyz, index) => {
          const atom = draft.atoms[index];
          if (!atom || atom.frozen || !xyz) return;
          atom.x = xyz[0] ?? atom.x;
          atom.y = xyz[1] ?? atom.y;
          atom.z = xyz[2] ?? atom.z;
        });
      });
      setEnergy(report.energy);
      setForce(report.maxForce);
      setStep(report.step);
      setMaxSteps(report.maxSteps);
      if (report.done) {
        setStatus("ready");
        setMessage("Python ready · UFF in CPython via Pyodide");
      } else {
        api.continueRelax(jobRef.current);
      }
    });
  }, []);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const api = await import("@/lib/mol/relax");
        if (!live) return;
        apiRef.current = api;
        attach(api);
        await api.bootPython();
        if (!live) return;
        setStatus("ready");
        setMessage("Python ready · UFF in CPython via Pyodide");
      } catch (err) {
        if (!live) return;
        setStatus("error");
        setMessage(err instanceof Error ? err.message : "Python failed to load");
      }
    })();
    return () => {
      live = false;
    };
  }, [attach]);

  function setFrozen(which: "sel" | "all", frozen: boolean) {
    const api = useWorkbench.getState();
    api.commit((draft) => {
      const ids = which === "sel" ? api.selected : draft.atoms.map((_, index) => index);
      for (const id of ids) {
        const atom = draft.atoms[id];
        if (atom) atom.frozen = frozen;
      }
    });
  }

  async function ensurePython() {
    const api = apiRef.current ?? (await import("@/lib/mol/relax"));
    apiRef.current = api;
    attach(api);
    await api.bootPython();
    return api;
  }

  async function relax() {
    if (status === "running" || status === "loading") return;
    if (total === 0 || movable === 0) return;
    try {
      const api = await ensurePython();
      const state = useWorkbench.getState();
      state.commit(() => undefined);
      const mol = useWorkbench.getState().mol;
      const id = api.beginRelax({
        elements: mol.atoms.map((atom) => atom.el),
        positions: mol.atoms.map((atom) => [atom.x, atom.y, atom.z]),
        bonds: mol.bonds.map((bond) => [bond.i, bond.j, bond.order]),
        frozen: mol.atoms.flatMap((atom, index) => (atom.frozen ? [index] : [])),
        maxSteps: mol.atoms.length > 80 ? 36 : 100,
      });
      jobRef.current = id;
      setStatus("running");
      setMessage("Relaxing with Python UFF…");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Python failed to load");
    }
  }

  function stop() {
    apiRef.current?.cancelRelax();
    if (apiRef.current) {
      setStatus("ready");
      setMessage("Stopped · Python still loaded");
    }
  }

  const canRelax = status !== "loading" && status !== "running" && total > 0 && movable > 0;

  return (
    <footer className="shrink-0 border-t border-line p-3">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={selectedCount === 0}
          onClick={() => setFrozen("sel", true)}
          className="flex min-h-11 items-center justify-center gap-1 rounded-md border border-line bg-panel-2 px-2 text-xs text-ink disabled:opacity-40"
        >
          <Lock className="size-3.5" />
          Freeze selection
        </button>
        <button
          type="button"
          disabled={selectedCount === 0}
          onClick={() => setFrozen("sel", false)}
          className="flex min-h-11 items-center justify-center gap-1 rounded-md border border-line bg-panel-2 px-2 text-xs text-ink disabled:opacity-40"
        >
          <LockOpen className="size-3.5" />
          Unfreeze selection
        </button>
        <button
          type="button"
          disabled={total === 0}
          onClick={() => setFrozen("all", true)}
          className="min-h-11 rounded-md border border-line bg-bg px-2 text-xs text-ink disabled:opacity-40"
        >
          Freeze all
        </button>
        <button
          type="button"
          disabled={total === 0}
          onClick={() => setFrozen("all", false)}
          className="min-h-11 rounded-md border border-line bg-bg px-2 text-xs text-ink disabled:opacity-40"
        >
          Unfreeze all
        </button>
      </div>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={!canRelax}
          onClick={() => void relax()}
          className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md bg-brass text-sm font-medium text-brass-ink disabled:opacity-40"
        >
          <Play className="size-4" />
          Relax with Python
        </button>
        <button
          type="button"
          disabled={status !== "running"}
          onClick={stop}
          aria-label="Stop relaxation"
          className="flex size-11 items-center justify-center rounded-md border border-line text-ink disabled:opacity-40"
        >
          <Square className="size-4" />
        </button>
      </div>
      <p className={"mt-2 text-xs " + (status === "error" ? "text-danger" : "text-sage")}>{message}</p>
      <p className="text-xs text-muted">
        {status === "running" ? `Step ${step}/${maxSteps} · ` : ""}
        {energy === null ? "Energy —" : `Energy ${energy.toFixed(2)} kcal/mol`}
        {force === null ? "" : ` · force ${force.toFixed(2)}`}
      </p>
      <p className="text-xs text-muted">Frozen atoms stay put while Python relaxes the rest.</p>
    </footer>
  );
}
