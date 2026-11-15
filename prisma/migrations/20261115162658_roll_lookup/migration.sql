-- AlterTable
ALTER TABLE "RollEntry" ADD COLUMN "emailKeyHash" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AccessCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "electionId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "codeEnc" TEXT NOT NULL DEFAULT '',
    "batch" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "districtId" TEXT,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccessCode_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "Election" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AccessCode" ("batch", "codeHash", "createdAt", "districtId", "electionId", "id", "label", "usedAt") SELECT "batch", "codeHash", "createdAt", "districtId", "electionId", "id", "label", "usedAt" FROM "AccessCode";
DROP TABLE "AccessCode";
ALTER TABLE "new_AccessCode" RENAME TO "AccessCode";
CREATE UNIQUE INDEX "AccessCode_codeHash_key" ON "AccessCode"("codeHash");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "RollEntry_electionId_emailKeyHash_idx" ON "RollEntry"("electionId", "emailKeyHash");
