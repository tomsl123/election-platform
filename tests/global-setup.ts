// Builds a fresh test database from the migrations before the test run.
import { execSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

export default function setup() {
  const root = resolve(import.meta.dirname, "..");
  mkdirSync(resolve(root, "data"), { recursive: true });
  for (const f of ["test.db", "test.db-journal"]) rmSync(resolve(root, "data", f), { force: true });
  execSync("npx prisma migrate deploy", { cwd: root, stdio: "ignore", env: { ...process.env, DATABASE_URL: "file:../data/test.db" } });
}
