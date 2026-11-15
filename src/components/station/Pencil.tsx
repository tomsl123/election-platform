"use client";
// The pencil on its string: it follows the voter's hand over the shelf and swings back to rest.
import { useEffect, useRef, type MutableRefObject, type RefObject } from "react";

export type PencilApi = { rest: () => void };

export function Pencil({ shelfRef, hidden, api }: { shelfRef: RefObject<HTMLElement | null>; hidden: boolean; api: MutableRefObject<PencilApi | null> }) {
  const pencilRef = useRef<HTMLDivElement>(null);
  const pathRef = useRef<SVGPathElement>(null);

  useEffect(() => {
    const shelf = shelfRef.current;
    const pencil = pencilRef.current;
    const path = pathRef.current;
    if (!shelf || !pencil || !path) return;
    const LEN = 150;
    const rest = () => {
      const r = shelf.getBoundingClientRect();
      const small = innerWidth < 760;
      return {
        x: innerWidth - Math.max(30, innerWidth * 0.06) - (small ? 90 : 0),
        y: small ? innerHeight - 30 : r.top + Math.min(250, r.height * 0.45),
        a: small ? 38 : 5,
      };
    };
    let pen = rest();
    let aim = rest();
    let raf = 0;
    const loop = () => {
      pen = { x: pen.x + (aim.x - pen.x) * 0.3, y: pen.y + (aim.y - pen.y) * 0.3, a: pen.a + (aim.a - pen.a) * 0.2 };
      pencil.style.transform = `translate(${pen.x}px,${pen.y}px) rotate(${pen.a}deg)`;
      const t = (pen.a * Math.PI) / 180;
      const tx = pen.x + LEN * Math.sin(t);
      const ty = pen.y - LEN * Math.cos(t);
      const ax = innerWidth - 26;
      const ay = shelf.getBoundingClientRect().top - 4;
      path.setAttribute("d", `M${ax} ${ay} Q${(ax + tx) / 2} ${Math.max(ay, ty) + 46} ${tx} ${ty}`);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const onMove = (e: PointerEvent) => {
      if ((e.target as Element).closest?.(".paper")) aim = { x: e.clientX, y: e.clientY, a: 30 };
      else aim = rest();
    };
    const onLeave = () => (aim = rest());
    const onUp = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") aim = rest();
    };
    const onResize = () => (aim = rest());
    shelf.addEventListener("pointermove", onMove);
    shelf.addEventListener("pointerleave", onLeave);
    shelf.addEventListener("pointerup", onUp);
    addEventListener("resize", onResize);
    api.current = { rest: () => (aim = rest()) };
    return () => {
      cancelAnimationFrame(raf);
      shelf.removeEventListener("pointermove", onMove);
      shelf.removeEventListener("pointerleave", onLeave);
      shelf.removeEventListener("pointerup", onUp);
      removeEventListener("resize", onResize);
      api.current = null;
    };
  }, [shelfRef, api]);

  return (
    <>
      <svg className="string" aria-hidden="true" style={{ display: hidden ? "none" : undefined }}>
        <path ref={pathRef} />
      </svg>
      <div className="pencil" ref={pencilRef} aria-hidden="true" style={{ display: hidden ? "none" : undefined }} />
    </>
  );
}
