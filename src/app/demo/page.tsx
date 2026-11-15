import "../station.css";
import { notFound } from "next/navigation";
import { DictProvider } from "@/i18n/client";
import { getDict } from "@/i18n";
import { brandStyle } from "@/lib/brand";
import { DEFAULT_BRAND } from "@/lib/types";
import type { StationContest } from "@/lib/marks";
import { DemoStation } from "./DemoStation";

export const metadata = { title: "The Booth (demo)" };

const opt = (id: string, name: string, subtitle: string, color: string, symbol: string) => ({ id, name, subtitle, color, symbol, photoUrl: null, list: [] as string[] });

// Development only: plays the design study's sitting with static data. ?hall=envelope|board, ?more=1 adds ranked and score papers.
export default async function DemoPage({ searchParams }: { searchParams: Promise<{ hall?: string; more?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const sp = await searchParams;
  const variant = sp.hall === "envelope" || sp.hall === "board" ? sp.hall : "box";
  const extra: StationContest[] = sp.more
    ? [
        {
          id: "rank",
          title: "Senate chair",
          instruction: "",
          method: "RANKED",
          maxChoices: 1,
          scoreMax: 5,
          allowBlank: false,
          options: [opt("a", "Revolton", "UPSF", "#c22a2a", "star"), opt("b", "Norton", "CA", "#d99a12", "sun"), opt("c", "Harper", "KKKK", "#2f7d55", "bolt")],
        },
        {
          id: "score",
          title: "Rate the ministries",
          instruction: "",
          method: "SCORE",
          maxChoices: 1,
          scoreMax: 5,
          allowBlank: false,
          options: [opt("w", "War", "", "#6d4a2b", "hammer"), opt("i", "Imperialism", "", "#2456a6", "crown"), opt("g", "Agriculture", "", "#2f7d55", "grass")],
        },
      ]
    : [];
  return (
    <DictProvider dict={getDict()}>
      <div style={brandStyle(DEFAULT_BRAND)}>
        <DemoStation variant={variant} extra={extra} />
      </div>
    </DictProvider>
  );
}
