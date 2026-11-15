"use client";
// The real ballot paper, drawn still, beside the office's paper editor.
import { useRef } from "react";
import { BallotPaper } from "@/components/station/BallotPaper";
import { DictProvider } from "@/i18n/client";
import type { Dict } from "@/i18n";
import { emptyMark, type StationContest } from "@/lib/marks";

export function PaperPreview({ contest, index, total, tint, crestId, heading, dict }: { contest: StationContest; index: number; total: number; tint: string; crestId: string | null; heading: string; dict: Dict }) {
  const tray = useRef<HTMLDivElement>(null);
  return (
    <DictProvider dict={dict}>
      <div className="station preview" aria-label={`Preview of ${contest.title}`}>
        <BallotPaper
          preview
          contest={contest}
          index={index}
          total={total}
          tint={tint}
          crestId={crestId}
          heading={heading}
          serial="00000"
          dateLabel="preview"
          mark={emptyMark(contest)}
          onMark={() => undefined}
          onFolded={() => undefined}
          trayRef={tray}
        />
      </div>
    </DictProvider>
  );
}
