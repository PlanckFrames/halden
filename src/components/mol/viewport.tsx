import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { elementOf, idealBond } from "@/lib/mol/elements";
import type { Atom, Molecule, StyleName, ToolName } from "@/lib/mol/types";

const BACKBONE = new Set(["N", "CA", "C", "O", "OXT"]);
const BRASS = new THREE.Color("#d4a054");
const SAGE = new THREE.Color("#8eae78");
const BOND = new THREE.Color("#8d8878");
const CLEAR = new THREE.Color("#12140f");

type Props = {
  mol: Molecule;
  style: StyleName;
  selected: number[];
  tool: ToolName;
  element: string;
  bondOrder: number;
  showCell: boolean;
  viewToken: number;
  onSelect: (index: number, shift: boolean) => void;
  onClear: () => void;
  onPlace: (x: number, y: number, z: number) => void;
  onGrow: (from: number, x: number, y: number, z: number) => void;
  onTransmute: (index: number) => void;
  onErase: (index: number) => void;
  onMove: (ids: number[], dx: number, dy: number, dz: number) => void;
  onBond: (index: number) => void;
};

function isBackbone(atom: Atom): boolean {
  return !atom.name || BACKBONE.has(atom.name);
}

function radii(el: string, style: StyleName): { atom: number; bond: number } {
  if (style === "space") return { atom: elementOf(el).vdw, bond: 0 };
  if (style === "wire") return { atom: el === "H" ? 0.07 : 0.1, bond: 0.03 };
  if (style === "stick" || style === "ribbon") return { atom: el === "H" ? 0.11 : 0.15, bond: 0.09 };
  return { atom: el === "H" ? 0.2 : 0.33, bond: 0.075 };
}

function bondOffsets(order: number): number[] {
  if (order >= 2.5) return [-0.11, 0, 0.11];
  if (order >= 1.7) return [-0.09, 0.09];
  if (order >= 1.3) return [0, 0.1];
  return [0];
}

export function Viewport(props: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const dirty = useRef(true);
  const fit = useRef(true);
  const token = useRef(props.viewToken);

  useEffect(() => {
    if (token.current !== props.viewToken) {
      token.current = props.viewToken;
      fit.current = true;
    }
    dirty.current = true;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(CLEAR, 1);
    host.appendChild(renderer.domElement);
    renderer.domElement.className = "block h-full w-full touch-none";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 800);
    camera.position.set(6, -10, 7);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.75;
    controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
    controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;

    scene.add(new THREE.AmbientLight(0xe7e4d6, 0.62));
    const key = new THREE.DirectionalLight(0xfff6e8, 1.25);
    key.position.set(6, 8, 10);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x8eae78, 0.38);
    fill.position.set(-8, -4, -6);
    scene.add(fill);

    const root = new THREE.Group();
    scene.add(root);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const dummy = new THREE.Object3D();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const quat = new THREE.Quaternion();

    let atomMesh: THREE.InstancedMesh | null = null;
    let bondMesh: THREE.InstancedMesh | null = null;
    let ringMesh: THREE.InstancedMesh | null = null;
    let builtKey = "";
    let frame = 0;

    const sphere = new THREE.SphereGeometry(1, 22, 16);
    const cylinder = new THREE.CylinderGeometry(1, 1, 1, 10);
    const torus = new THREE.TorusGeometry(1, 0.08, 8, 20);
    const atomMat = new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.06 });
    const bondMat = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.04 });
    const ringMat = new THREE.MeshStandardMaterial({ color: SAGE, roughness: 0.4, metalness: 0.1 });

    function size() {
      const width = host!.clientWidth || 1;
      const height = host!.clientHeight || 1;
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    }

    function visibleIndices(atoms: Atom[], style: StyleName): number[] {
      if (style !== "ribbon" || !atoms.some((atom) => atom.name === "CA")) {
        return atoms.map((_, index) => index);
      }
      return atoms.flatMap((atom, index) => (isBackbone(atom) ? [index] : []));
    }

    function disposeObject(object: THREE.Object3D | null) {
      if (!object) return;
      root.remove(object);
      if (object instanceof THREE.InstancedMesh) object.dispose();
    }

    function sync() {
      const { mol, style, selected, showCell } = propsRef.current;
      const atoms = mol.atoms;
      const selectedSet = new Set(selected);
      const shown = visibleIndices(atoms, style);
      const effective: StyleName = style === "ribbon" && !atoms.some((atom) => atom.name === "CA") ? "ball" : style;
      const bondKey = mol.bonds.map((bond) => `${bond.i}.${bond.j}.${bond.order}`).join("|");
      const caSig =
        effective === "ribbon"
          ? atoms
              .filter((atom) => atom.name === "CA")
              .map((atom) => `${atom.x.toFixed(2)},${atom.y.toFixed(2)},${atom.z.toFixed(2)}`)
              .join(";")
          : "";
      const key = `${effective}:${shown.join(".")}:${atoms.map((atom) => atom.el).join("")}:${bondKey}:${showCell && mol.cell ? "cell" : ""}:${caSig}`;

      if (key !== builtKey) {
        disposeObject(atomMesh);
        disposeObject(bondMesh);
        disposeObject(ringMesh);
        root.children.filter((child) => child.name === "ribbon" || child.name === "cell").forEach((child) => {
          root.remove(child);
          const mesh = child as THREE.Mesh;
          mesh.geometry?.dispose();
          if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose());
          else mesh.material?.dispose();
        });
        atomMesh = null;
        bondMesh = null;
        ringMesh = null;

        if (shown.length) {
          atomMesh = new THREE.InstancedMesh(sphere, atomMat, shown.length);
          atomMesh.frustumCulled = false;
          atomMesh.userData.ids = shown;
          root.add(atomMesh);

          ringMesh = new THREE.InstancedMesh(torus, ringMat, shown.length);
          ringMesh.frustumCulled = false;
          ringMesh.raycast = () => null;
          root.add(ringMesh);
        }

        if (effective !== "space") {
          let bondCount = 0;
          const pairs: { i: number; j: number; order: number }[] = [];
          const shownSet = new Set(shown);
          for (const bond of mol.bonds) {
            if (!shownSet.has(bond.i) || !shownSet.has(bond.j)) continue;
            pairs.push(bond);
            bondCount += bondOffsets(bond.order).length;
          }
          if (bondCount) {
            bondMesh = new THREE.InstancedMesh(cylinder, bondMat, bondCount);
            bondMesh.frustumCulled = false;
            bondMesh.raycast = () => null;
            bondMesh.userData.pairs = pairs;
            root.add(bondMesh);
          }
        }

        if (effective === "ribbon") {
          const cas = atoms.filter((atom) => atom.name === "CA");
          if (cas.length >= 8) {
            const curve = new THREE.CatmullRomCurve3(
              cas.map((atom) => new THREE.Vector3(atom.x, atom.y, atom.z)),
              false,
              "catmullrom",
              0.15,
            );
            const segments = Math.max(32, cas.length * 3);
            const tube = new THREE.TubeGeometry(curve, segments, 0.22, 8, false);
            const colors = new Float32Array(tube.attributes.position!.count * 3);
            const radial = 8;
            const rings = segments + 1;
            for (let i = 0; i < tube.attributes.position!.count; i++) {
              const t = Math.floor(i / radial) / Math.max(1, rings - 1);
              const color = BRASS.clone().lerp(SAGE, t);
              colors[i * 3] = color.r;
              colors[i * 3 + 1] = color.g;
              colors[i * 3 + 2] = color.b;
            }
            tube.setAttribute("color", new THREE.BufferAttribute(colors, 3));
            const mesh = new THREE.Mesh(
              tube,
              new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.02 }),
            );
            mesh.name = "ribbon";
            mesh.raycast = () => null;
            root.add(mesh);
          }
        }

        if (showCell && mol.cell) {
          const { origin, a, b, c } = mol.cell;
          const o = new THREE.Vector3(...origin);
          const av = new THREE.Vector3(...a);
          const bv = new THREE.Vector3(...b);
          const cv = new THREE.Vector3(...c);
          const p = (i: number, j: number, k: number) =>
            o.clone().addScaledVector(av, i).addScaledVector(bv, j).addScaledVector(cv, k);
          const corners = [p(0, 0, 0), p(1, 0, 0), p(0, 1, 0), p(1, 1, 0), p(0, 0, 1), p(1, 0, 1), p(0, 1, 1), p(1, 1, 1)];
          const edges = [
            [0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3], [2, 6], [3, 7], [4, 5], [4, 6], [5, 7], [6, 7],
          ];
          const points: number[] = [];
          for (const [u, v] of edges) {
            const from = corners[u!]!;
            const to = corners[v!]!;
            points.push(from.x, from.y, from.z, to.x, to.y, to.z);
          }
          const geo = new THREE.BufferGeometry();
          geo.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
          const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: SAGE, transparent: true, opacity: 0.55 }));
          lines.name = "cell";
          root.add(lines);
        }
        builtKey = key;
      }

      if (atomMesh) {
        const ids = atomMesh.userData.ids as number[];
        ids.forEach((index, slot) => {
          const atom = atoms[index]!;
          const radius = radii(atom.el, effective).atom;
          dummy.position.set(atom.x, atom.y, atom.z);
          dummy.quaternion.identity();
          dummy.scale.setScalar(radius);
          dummy.updateMatrix();
          atomMesh!.setMatrixAt(slot, dummy.matrix);
          const color = selectedSet.has(index) ? BRASS : new THREE.Color(elementOf(atom.el).color);
          atomMesh!.setColorAt(slot, color);
          if (ringMesh) {
            const ringScale = atom.frozen ? Math.max(0.28, radius * 1.55) : 0.0001;
            dummy.scale.set(ringScale, ringScale, ringScale);
            dummy.rotation.set(Math.PI / 2, 0, 0);
            dummy.updateMatrix();
            ringMesh.setMatrixAt(slot, dummy.matrix);
          }
        });
        atomMesh.instanceMatrix.needsUpdate = true;
        if (atomMesh.instanceColor) atomMesh.instanceColor.needsUpdate = true;
        if (ringMesh) ringMesh.instanceMatrix.needsUpdate = true;
      }

      if (bondMesh) {
        const pairs = bondMesh.userData.pairs as { i: number; j: number; order: number }[];
        let slot = 0;
        for (const bond of pairs) {
          const a = atoms[bond.i]!;
          const b = atoms[bond.j]!;
          const start = new THREE.Vector3(a.x, a.y, a.z);
          const end = new THREE.Vector3(b.x, b.y, b.z);
          const delta = end.clone().sub(start);
          const length = Math.max(delta.length(), 0.001);
          delta.normalize();
          const side = new THREE.Vector3().crossVectors(delta, Math.abs(delta.y) > 0.92 ? new THREE.Vector3(1, 0, 0) : yAxis).normalize();
          quat.setFromUnitVectors(yAxis, delta);
          const highlighted = selectedSet.has(bond.i) && selectedSet.has(bond.j);
          const radius = radii(a.el, effective).bond * (bond.order >= 1.3 && bond.order < 1.7 ? 0.72 : 1);
          for (const offset of bondOffsets(bond.order)) {
            dummy.position.copy(start).add(end).multiplyScalar(0.5).addScaledVector(side, offset);
            dummy.quaternion.copy(quat);
            dummy.scale.set(radius, length, radius);
            dummy.updateMatrix();
            bondMesh!.setMatrixAt(slot, dummy.matrix);
            bondMesh!.setColorAt(slot, highlighted ? BRASS : BOND);
            slot += 1;
          }
        }
        bondMesh.instanceMatrix.needsUpdate = true;
        if (bondMesh.instanceColor) bondMesh.instanceColor.needsUpdate = true;
      }

      if (fit.current && atoms.length) {
        const box = new THREE.Box3();
        for (const atom of atoms) box.expandByPoint(new THREE.Vector3(atom.x, atom.y, atom.z));
        const center = box.getCenter(new THREE.Vector3());
        const size3 = box.getSize(new THREE.Vector3());
        const radius = Math.max(size3.x, size3.y, size3.z, 2) * 0.55;
        const distance = radius / Math.tan((camera.fov * Math.PI) / 360) * 1.25;
        camera.position.set(center.x + distance * 0.45, center.y - distance * 0.9, center.z + distance * 0.5);
        controls.target.copy(center);
        controls.update();
        fit.current = false;
      }
    }

    function ndc(event: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    }

    function pickAtom(event: PointerEvent): number | null {
      if (!atomMesh) return null;
      ndc(event);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObject(atomMesh);
      const hit = hits[0];
      if (!hit || hit.instanceId === undefined) return null;
      const ids = atomMesh.userData.ids as number[];
      return ids[hit.instanceId] ?? null;
    }

    function pointOnPlane(event: PointerEvent, origin: THREE.Vector3): THREE.Vector3 | null {
      ndc(event);
      raycaster.setFromCamera(pointer, camera);
      const normal = new THREE.Vector3();
      camera.getWorldDirection(normal);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin);
      const hit = new THREE.Vector3();
      return raycaster.ray.intersectPlane(plane, hit) ? hit : null;
    }

    let drag: { kind: "draw"; from: number; x: number; y: number; moved: boolean } | { kind: "move"; ids: number[]; last: THREE.Vector3 } | null = null;

    function onPointerDown(event: PointerEvent) {
      if (event.button !== 0) return;
      const tool = propsRef.current.tool;
      controls.mouseButtons.LEFT = (tool === "navigate" ? THREE.MOUSE.ROTATE : -1) as THREE.MOUSE;
      if (tool === "navigate") return;
      const index = pickAtom(event);
      if (tool === "erase") {
        if (index !== null) propsRef.current.onErase(index);
        return;
      }
      if (tool === "select") {
        if (index === null) propsRef.current.onClear();
        else propsRef.current.onSelect(index, event.shiftKey);
        return;
      }
      if (tool === "bond") {
        if (index !== null) propsRef.current.onBond(index);
        return;
      }
      if (tool === "move") {
        if (index === null) return;
        const atom = propsRef.current.mol.atoms[index];
        if (!atom) return;
        const origin = new THREE.Vector3(atom.x, atom.y, atom.z);
        const last = pointOnPlane(event, origin);
        if (!last) return;
        const selected = propsRef.current.selected;
        const ids = selected.includes(index) ? selected : [index];
        drag = { kind: "move", ids, last };
        renderer.domElement.setPointerCapture(event.pointerId);
        return;
      }
      if (tool === "draw") {
        drag = { kind: "draw", from: index ?? -1, x: event.clientX, y: event.clientY, moved: false };
        renderer.domElement.setPointerCapture(event.pointerId);
      }
    }

    function onPointerMove(event: PointerEvent) {
      if (!drag) return;
      if (drag.kind === "draw") {
        if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 8) drag.moved = true;
        return;
      }
      const hit = pointOnPlane(event, drag.last);
      if (!hit) return;
      const dx = hit.x - drag.last.x;
      const dy = hit.y - drag.last.y;
      const dz = hit.z - drag.last.z;
      drag.last.copy(hit);
      if (dx || dy || dz) propsRef.current.onMove(drag.ids, dx, dy, dz);
    }

    function onPointerUp(event: PointerEvent) {
      if (!drag) return;
      const current = drag;
      drag = null;
      if (current.kind === "move") return;
      if (current.kind !== "draw") return;
      if (current.from >= 0 && current.moved) {
        const atom = propsRef.current.mol.atoms[current.from];
        if (!atom) return;
        const origin = new THREE.Vector3(atom.x, atom.y, atom.z);
        const hit = pointOnPlane(event, origin);
        if (!hit) return;
        const dir = hit.sub(origin);
        if (dir.length() < 0.05) return;
        dir.normalize();
        const len = idealBond(atom.el, propsRef.current.element, propsRef.current.bondOrder);
        const pos = origin.addScaledVector(dir, len);
        propsRef.current.onGrow(current.from, pos.x, pos.y, pos.z);
        return;
      }
      if (current.from >= 0) {
        propsRef.current.onTransmute(current.from);
        return;
      }
      const origin = new THREE.Vector3();
      const atoms = propsRef.current.mol.atoms;
      if (atoms.length) {
        for (const atom of atoms) origin.add(new THREE.Vector3(atom.x, atom.y, atom.z));
        origin.multiplyScalar(1 / atoms.length);
      }
      const hit = pointOnPlane(event, origin);
      if (!hit) return;
      propsRef.current.onPlace(hit.x, hit.y, hit.z);
    }

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("contextmenu", (event) => event.preventDefault());

    const observer = new ResizeObserver(() => size());
    observer.observe(host);
    size();

    const tick = () => {
      frame = requestAnimationFrame(tick);
      const tool = propsRef.current.tool;
      controls.mouseButtons.LEFT = (tool === "navigate" ? THREE.MOUSE.ROTATE : -1) as THREE.MOUSE;
      controls.touches.ONE = (tool === "navigate" ? THREE.TOUCH.ROTATE : -1) as THREE.TOUCH;
      if (dirty.current) {
        sync();
        dirty.current = false;
      }
      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      controls.dispose();
      sphere.dispose();
      cylinder.dispose();
      torus.dispose();
      atomMat.dispose();
      bondMat.dispose();
      ringMat.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={hostRef} className="absolute inset-0" />;
}
