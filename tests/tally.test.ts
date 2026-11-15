import { describe, expect, it } from "vitest";
import { allocateSeats, countChoices, decideMulti, decideSingle, irv, rollUp, scoreTotals, stv, tallyContest } from "@/lib/tally";

const rep = <T,>(n: number, v: T): T[] => Array.from({ length: n }, () => v);

describe("seats for party lists", () => {
  const votes = { A: 100000, B: 80000, C: 30000, D: 20000 };
  it("D'Hondt", () => expect(allocateSeats(votes, 8, "DHONDT").seats).toEqual({ A: 4, B: 3, C: 1, D: 0 }));
  it("Sainte-Laguë", () => expect(allocateSeats(votes, 8, "SAINTE_LAGUE").seats).toEqual({ A: 3, B: 3, C: 1, D: 1 }));
  it("Hare with largest remainders", () => expect(allocateSeats(votes, 8, "HARE").seats).toEqual({ A: 3, B: 3, C: 1, D: 1 }));
  it("drops lists under the threshold first", () => expect(allocateSeats(votes, 8, "DHONDT", 10).seats).toEqual({ A: 4, B: 3, C: 1, D: 0 }));
  it("reports a tie for the last seat", () => expect(allocateSeats({ A: 10, B: 10 }, 1, "DHONDT").tie).toBe(true));
});

describe("single winner", () => {
  it("sends 45/40/15 to a second round under the majority rule", () => {
    expect(decideSingle({ A: 45, B: 40, C: 15 }, { win: "MAJORITY_RUNOFF", majorityPct: 50 })).toEqual({ outcome: "RUNOFF", winners: [], finalists: ["A", "B"] });
  });
  it("elects 45/40/15 by plurality", () => expect(decideSingle({ A: 45, B: 40, C: 15 }, { win: "PLURALITY", majorityPct: 50 }).winners).toEqual(["A"]));
  it("elects on a majority", () => expect(decideSingle({ A: 51, B: 49 }, { win: "MAJORITY_RUNOFF", majorityPct: 50 }).outcome).toBe("ELECTED"));
  it("reports a tie", () => expect(decideSingle({ A: 5, B: 5 }, { win: "PLURALITY", majorityPct: 50 })).toEqual({ outcome: "TIED", winners: [], tied: ["A", "B"] }));
  it("counts blanks apart", () => expect(countChoices([{ x: ["A"] }, { x: [] }, { x: ["B"] }], ["A", "B"])).toEqual({ totals: { A: 1, B: 1 }, blank: 1, valid: 2 }));
  it("takes the top N on multi papers and flags a tie at the cut", () => {
    expect(decideMulti({ A: 5, B: 4, C: 3 }, 2)).toEqual({ outcome: "ELECTED", winners: ["A", "B"] });
    expect(decideMulti({ A: 5, B: 4, C: 4 }, 2)).toEqual({ outcome: "TIED", winners: ["A"], tied: ["B", "C"] });
  });
});

describe("ranked papers", () => {
  it("instant runoff: 4×AB, 3×BA, 2×CB → B wins 5–4", () => {
    const r = irv([...rep(4, ["A", "B"]), ...rep(3, ["B", "A"]), ...rep(2, ["C", "B"])], ["A", "B", "C"]);
    expect(r.rounds![0].counts).toEqual({ A: 4, B: 3, C: 2 });
    expect(r.rounds![0].eliminated).toEqual(["C"]);
    expect(r.rounds![1].counts).toEqual({ A: 4, B: 5 });
    expect(r.winners).toEqual(["B"]);
  });
  it("STV, three seats, the food election", () => {
    const ballots = [
      ...rep(4, ["Oranges"]),
      ...rep(2, ["Pears", "Oranges"]),
      ...rep(8, ["Chocolate", "Strawberries"]),
      ...rep(4, ["Chocolate", "Sweets"]),
      ["Strawberries"],
      ["Sweets"],
    ];
    const r = stv(ballots, ["Oranges", "Pears", "Chocolate", "Strawberries", "Sweets"], 3);
    expect(r.quota).toBe(6);
    expect(r.rounds![0].elected).toEqual(["Chocolate"]);
    expect(r.rounds![1].counts).toMatchObject({ Strawberries: 5, Sweets: 3, Oranges: 4, Pears: 2 });
    expect(r.rounds![1].eliminated).toEqual(["Pears"]);
    expect(r.rounds![2].elected).toEqual(["Oranges"]);
    expect(r.winners).toEqual(["Chocolate", "Oranges", "Strawberries"]);
  });
});

describe("scores and the dispatcher", () => {
  it("sums scores, the highest sum wins", () => {
    const r = scoreTotals([{ s: { A: 5, B: 3 } }, { s: { A: 1, B: 4 } }], ["A", "B"]);
    expect(r.sums).toEqual({ A: 6, B: 7 });
    expect(r.winners).toEqual(["B"]);
  });
  it("routes each method", () => {
    const rule = { win: "PLURALITY" as const, majorityPct: 50, pr: "DHONDT" as const, prThresholdPct: 0, scoreMax: 5 };
    expect(tallyContest({ method: "YESNO", seats: 1, rule }, ["y", "n"], [{ x: ["y"] }, { x: ["y"] }, { x: ["n"] }]).winners).toEqual(["y"]);
    expect(tallyContest({ method: "PARTY_LIST", seats: 3, rule }, ["a", "b"], [{ x: ["a"] }, { x: ["a"] }, { x: ["b"] }]).seats).toEqual({ a: 2, b: 1 });
    expect(tallyContest({ method: "RANKED", seats: 1, rule }, ["a", "b"], [{ r: ["a", "b"] }, { r: [] }]).blank).toBe(1);
  });
  it("rolls districts up", () => {
    const r = rollUp([
      { valid: 3, blank: 0, totals: { a: 2, b: 1 }, seats: { a: 1, b: 0 }, outcome: "ELECTED", winners: ["a"] },
      { valid: 2, blank: 1, totals: { a: 0, b: 2 }, seats: { a: 0, b: 1 }, outcome: "ELECTED", winners: ["b"] },
    ]);
    expect(r.totals).toEqual({ a: 2, b: 3 });
    expect(r.seats).toEqual({ a: 1, b: 1 });
    expect(r.valid).toBe(5);
  });
});
