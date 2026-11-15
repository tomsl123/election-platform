"use client";
import { createContext, useContext } from "react";
import { en } from "./en";
import { t as translate, type Dict, type DictKey } from "./index";

const Ctx = createContext<Dict>(en as Dict);

export function DictProvider({ dict, children }: { dict: Dict; children: React.ReactNode }) {
  return <Ctx.Provider value={dict}>{children}</Ctx.Provider>;
}

/** `const t = useT(); t("desk.email")` inside client components. */
export function useT() {
  const dict = useContext(Ctx);
  return (key: DictKey, vars?: Record<string, string | number>) => translate(dict, key, vars);
}
