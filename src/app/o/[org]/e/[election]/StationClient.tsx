"use client";
import { DictProvider } from "@/i18n/client";
import type { Dict } from "@/i18n";
import { PollingStation, type StationProps } from "@/components/station/PollingStation";
import { Desk, type DeskProps } from "@/components/station/Desk";
import { castBallots, confirmCode, enterWithAccount, enterWithCode, enterWithLink, presentEmail } from "./actions";

type DeskConfig = Omit<DeskProps, "admit" | "showSign" | "actions" | "electionId" | "crestId">;

export function StationClient({ dict, electionId, station, desk }: { dict: Dict; electionId: string; station: Omit<StationProps, "cast" | "desk">; desk: DeskConfig | null }) {
  return (
    <DictProvider dict={dict}>
      <PollingStation
        {...station}
        cast={(marks) => castBallots(electionId, marks)}
        desk={
          desk
            ? (admit, showSign) => (
                <Desk {...desk} electionId={electionId} crestId={station.crestId} admit={admit} showSign={showSign} actions={{ presentEmail, confirmCode, enterWithCode, enterWithAccount, enterWithLink }} />
              )
            : undefined
        }
      />
    </DictProvider>
  );
}
