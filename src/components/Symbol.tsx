// Wordless marks for parties and options, so a ballot can be read without reading.
// The first ten come from the design studies.

const S = { fill: "none", stroke: "currentColor", strokeWidth: 2.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

const PATHS: Record<string, React.ReactNode> = {
  star: <path d="M12 2.2l2.8 6.3 6.8.7-5.1 4.6 1.5 6.7L12 17l-6 3.5 1.5-6.7-5.1-4.6 6.8-.7z" />,
  tower: <path d="M6 21.5V10H5V4.5h2.6v2h2.1v-2h4.6v2h2.1v-2H19V10h-1v11.5h-4.3V17a1.7 1.7 0 00-3.4 0v4.5z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4.6" />
      <path {...S} d="M12 1.8v3.4M12 18.8v3.4M1.8 12h3.4M18.8 12h3.4M4.8 4.8l2.4 2.4M16.8 16.8l2.4 2.4M4.8 19.2l2.4-2.4M16.8 7.2l2.4-2.4" />
    </>
  ),
  bolt: <path d="M13.8 1.8L4.6 13.6h5.6L9 22.2l10.4-12.6h-5.8z" />,
  yes: <path {...S} strokeWidth={3.2} d="M4.5 12.8l5 5 10-11.2" />,
  no: <path {...S} strokeWidth={3.2} d="M6 6l12 12M18 6L6 18" />,
  mountain: <path d="M1.8 20.5L9 6.5l3.8 6.4 2.6-3.6 6.8 11.2z" />,
  snow: <path {...S} d="M12 2.5v19M3.8 7.2l16.4 9.6M20.2 7.2L3.8 16.8M9.6 4.2L12 6.4l2.4-2.2M9.6 19.8l2.4-2.2 2.4 2.2" />,
  dune: (
    <>
      <circle cx="17.6" cy="6.4" r="2.8" />
      <path d="M1.8 20.5c4.2-8 7.4-8 10.4-3.4 2.2-4.2 5.4-5.2 10 3.4z" />
    </>
  ),
  grass: <path {...S} d="M5 21c0-6 1-9.5 3.2-12.5M12 21V5.5M19 21c0-6-1-9.5-3.2-12.5M8.6 21c0-3 .5-5 1.4-7M15.4 21c0-3-.5-5-1.4-7" />,
  anchor: <path {...S} d="M12 6.5V21M7.5 10.5h9M4 14c0 4 3.5 7 8 7s8-3 8-7M12 2.5a2 2 0 110 4 2 2 0 010-4z" />,
  tree: <path d="M12 1.8l6.5 9.2h-3.2l4.4 6.2h-6.2v4.6h-3v-4.6H4.3l4.4-6.2H5.5z" />,
  key: <path {...S} d="M14.5 9.5a5 5 0 11-1.5-3.6M14 10l7.5 7.5M18 14l2.2-2.2M16 16l2-2" />,
  wheel: (
    <>
      <circle {...S} cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2.4" />
      <path {...S} d="M12 3v6.6M12 14.4V21M3 12h6.6M14.4 12H21M5.6 5.6l4.7 4.7M13.7 13.7l4.7 4.7M5.6 18.4l4.7-4.7M13.7 10.3l4.7-4.7" />
    </>
  ),
  book: <path {...S} d="M12 6.5C9.5 4.5 6 4 2.5 4.5v14c3.5-.5 7 0 9.5 2 2.5-2 6-2.5 9.5-2v-14C18 4 14.5 4.5 12 6.5zM12 6.5v14" />,
  flame: <path d="M12 1.8c1 4.2 6.5 6.6 6.5 12.4A6.5 6.5 0 015.5 14.2c0-3 1.6-4.8 3.2-6.4.2 2.2 1 3.6 2.4 4.3-.6-3.8.2-7 .9-10.3z" />,
  crown: <path d="M2.5 7.5l5 4.5L12 4.5l4.5 7.5 5-4.5-2 12h-15z" />,
  bell: <path d="M12 2.5a1.6 1.6 0 011.6 1.6v.6A6 6 0 0118 10.5V15l2.5 3H3.5L6 15v-4.5a6 6 0 014.4-5.8v-.6A1.6 1.6 0 0112 2.5zM9.5 19.5h5a2.5 2.5 0 01-5 0z" />,
  fish: <path d="M2 12c3.5-5 9.5-6.5 14.5-3l5-3.5-1.8 6.5 1.8 6.5-5-3.5C11.5 18.5 5.5 17 2 12zm5.5-1.2a1.2 1.2 0 100 2.4 1.2 1.2 0 000-2.4z" />,
  hammer: <path d="M3 3.5h11.5l3.5 2.2v2.6H3zM9.8 8.3h3.4v13.2H9.8z" />,
  wave: <path {...S} d="M2 9c2.5-2.5 5-2.5 7.5 0s5 2.5 7.5 0 3.8-2.5 5 0M2 15c2.5-2.5 5-2.5 7.5 0s5 2.5 7.5 0 3.8-2.5 5 0" />,
  eye: (
    <>
      <path {...S} d="M1.8 12c2.8-5 6.2-7 10.2-7s7.4 2 10.2 7c-2.8 5-6.2 7-10.2 7S4.6 17 1.8 12z" />
      <circle cx="12" cy="12" r="3.4" />
    </>
  ),
  hand: <path d="M8 21.5c-2.6-1.2-4.4-3.8-4.4-6.6V9.6a1.5 1.5 0 013 0v3.2h.7V4.6a1.5 1.5 0 013 0v7.2h.7V3.2a1.5 1.5 0 013 0v8.6h.7V5a1.5 1.5 0 013 0v8.2l.4-1.2a1.5 1.5 0 012.9.9l-1.8 5.3a7 7 0 01-6.6 4.8z" />,
  moon: <path d="M15.5 2.5A9.5 9.5 0 1021.5 15 7.6 7.6 0 0115.5 2.5z" />,
};

export const SYMBOLS = Object.keys(PATHS);

export function Sym({ name, className = "", title }: { name: string; className?: string; title?: string }) {
  const body = PATHS[name];
  if (!body) return null;
  return (
    <svg className={`sym ${className}`} viewBox="0 0 24 24" fill="currentColor" aria-hidden={title ? undefined : true} role={title ? "img" : undefined}>
      {title ? <title>{title}</title> : null}
      {body}
    </svg>
  );
}
