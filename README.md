# Halden

A molecular workbench in the browser. Draw and edit a structure, freeze atoms so they stay fixed, relax the rest with Python, and export the coordinates.

## Built-in structures

- **Ibuprofen** (C13H18O2), a pain reliever already relaxed with the same UFF engine.
- **MoS2 bilayer slab**, a 4×4 flake of 2H molybdenum disulfide, with its cell drawn.
- **Crambin** (PDB 1CRN), the 46-residue seed protein. Ribbon style follows the Cα trace.

## Python

Geometry relaxation is a Universal Force Field (Rappe et al., JACS 1992) written in pure Python. The browser runs that file in CPython through Pyodide. Frozen atoms are left out of the coordinate update, so they stay put while the rest of the molecule moves.

The engine is [`src/lib/mol/uff_engine.py`](src/lib/mol/uff_engine.py). The same code pre-relaxed the ibuprofen preset.

## Export

XYZ, Z-matrix, Gaussian, Q-Chem, ADF/AMS, NWChem, ORCA, and VASP POSCAR. Frozen atoms are written as constraints where that program supports them.

## Run

```bash
npm install
npm run dev
```

Then open the local URL the dev server prints.
