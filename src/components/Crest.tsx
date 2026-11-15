// The organisation's crest: its uploaded image, or the default shield (serpent ring, crab, tree)
// drawn from the design studies. Works in server and client components.

export function DefaultCrest({ className = "" }: { className?: string }) {
  return (
    <svg className={`crest ${className}`} viewBox="0 0 100 116" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 8h84v52c0 26-20 40-42 50C28 100 8 86 8 60z" />
      <circle cx="50" cy="47" r="24" strokeWidth="2.6" strokeDasharray="3.4 2.4" />
      <ellipse cx="50" cy="50" rx="11" ry="8" fill="currentColor" stroke="none" />
      <path d="M40 46c-7-2-10-8-6-13 1 4 4 7 8 8M60 46c7-2 10-8 6-13-1 4-4 7-8 8" />
      <path strokeWidth="2" d="M40 54l-7 4M41 57l-5 6M60 54l7 4M59 57l5 6" />
      <path strokeWidth="2.6" d="M50 78v19M50 85l-8-6M50 85l8-6M50 92l-6-4M50 92l6-4" />
    </svg>
  );
}

export function Crest({ uploadId, className = "", alt = "" }: { uploadId?: string | null; className?: string; alt?: string }) {
  if (uploadId) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={`crest crest-img ${className}`} src={`/api/files/${uploadId}`} alt={alt} />;
  }
  return <DefaultCrest className={className} />;
}
