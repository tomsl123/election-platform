"use client";
import { PollingStation, type CastResult } from "@/components/station/PollingStation";
import type { StationContest } from "@/lib/marks";

const opt = (id: string, name: string, subtitle: string, color: string, symbol: string) => ({ id, name, subtitle, color, symbol, photoUrl: null, list: [] });

export const DEMO_CONTESTS: StationContest[] = [
  {
    id: "pm",
    title: "Prime Minister",
    instruction: "",
    method: "SINGLE",
    maxChoices: 1,
    scoreMax: 5,
    allowBlank: false,
    options: [
      opt("rev", "Gen. Revolucionez", "UPSF", "#c22a2a", "star"),
      opt("bld", "Rev. Builderswartz", "CUP", "#2456a6", "tower"),
      opt("sim", "Prof. Simons", "CA", "#d99a12", "sun"),
      opt("pla", "Zeman Planovsky", "KKKK", "#2f7d55", "bolt"),
    ],
  },
  {
    id: "ref",
    title: "Referendum",
    instruction: "Hold the Senate elections again?",
    method: "YESNO",
    maxChoices: 1,
    scoreMax: 5,
    allowBlank: true,
    options: [opt("yes", "Yes", "", "#2f7d55", "yes"), opt("no", "No", "", "#b3261e", "no")],
  },
  {
    id: "jk",
    title: "JK Days host",
    instruction: "",
    method: "MULTI",
    maxChoices: 2,
    scoreMax: 5,
    allowBlank: false,
    options: [
      opt("dead", "Dead End Cliff", "", "#6c4fa3", "mountain"),
      opt("snow", "Snowbelle Cliff", "", "#3c8fb5", "snow"),
      opt("sand", "Eternal Sand Cliff", "", "#c9792b", "dune"),
      opt("step", "Endless Steppe Cliff", "", "#6f8f2f", "grass"),
    ],
  },
];

function receipt() {
  const a = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const s = Array.from({ length: 12 }, () => a[Math.floor(Math.random() * a.length)]).join("");
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

export function DemoStation({ variant, extra }: { variant: "box" | "envelope" | "board"; extra: StationContest[] }) {
  return (
    <PollingStation
      crestId={null}
      plate="Polling station"
      title="Federal Polling Day"
      subtitle="United States of Free Cliffs"
      heading="USFC · Federal Polling Day"
      dateLabel="15 · XI · 2026"
      serialBase={41273}
      contests={[...DEMO_CONTESTS, ...extra]}
      tints={["#f6f1e4", "#f3e7b5", "#dbe6ee", "#e6dcef", "#dcecd8"]}
      hall={variant}
      voterName={variant === "board" ? "Citizen Tudlenudle" : undefined}
      links={{ board: "/demo", verify: "/demo" }}
      cast={async (): Promise<CastResult> => {
        await new Promise((r) => setTimeout(r, 400));
        return { ok: true, receipt: receipt(), held: variant === "envelope", pinned: variant === "board" };
      }}
    />
  );
}
