// Creates .env with fresh secrets (if missing) and the data folders.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const envPath = resolve(root, ".env");

mkdirSync(resolve(root, "data", "uploads"), { recursive: true });

if (existsSync(envPath)) {
  console.log(".env already exists, leaving it untouched.");
} else {
  const secret = randomBytes(48).toString("base64url");
  const setup = randomBytes(18).toString("base64url");
  writeFileSync(
    envPath,
    [
      'DATABASE_URL="file:../data/elections.db"',
      `APP_SECRET="${secret}"`,
      `SETUP_TOKEN="${setup}"`,
      'BASE_URL="http://localhost:3220"',
      'UPLOAD_DIR="./data/uploads"',
      'TRUST_PROXY="0"',
      "",
    ].join("\n"),
  );
  console.log("Created .env with fresh secrets.");
  console.log("The setup token for creating the first platform admin is in .env (SETUP_TOKEN).");
}
