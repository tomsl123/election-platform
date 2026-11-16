-- AlterTable
ALTER TABLE "Election" ADD COLUMN "districts" TEXT;
ALTER TABLE "Election" ADD COLUMN "uctvContestId" TEXT;

-- CreateTable
CREATE TABLE "DistrictImport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "setId" TEXT,
    "payload" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_District" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "setId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "seats" INTEGER NOT NULL DEFAULT 1,
    "position" INTEGER NOT NULL DEFAULT 0,
    "counties" TEXT NOT NULL DEFAULT '[]',
    "ref" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "District_setId_fkey" FOREIGN KEY ("setId") REFERENCES "DistrictSet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_District" ("code", "id", "name", "position", "seats", "setId") SELECT "code", "id", "name", "position", "seats", "setId" FROM "District";
DROP TABLE "District";
ALTER TABLE "new_District" RENAME TO "District";
CREATE UNIQUE INDEX "District_setId_code_key" ON "District"("setId", "code");
CREATE TABLE "new_DistrictSet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "map" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT '{}',
    CONSTRAINT "DistrictSet_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_DistrictSet" ("id", "name", "orgId") SELECT "id", "name", "orgId" FROM "DistrictSet";
DROP TABLE "DistrictSet";
ALTER TABLE "new_DistrictSet" RENAME TO "DistrictSet";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "DistrictImport_orgId_idx" ON "DistrictImport"("orgId");
