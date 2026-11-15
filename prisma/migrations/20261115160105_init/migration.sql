-- CreateTable
CREATE TABLE "Organisation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Prague',
    "brand" TEXT NOT NULL DEFAULT '{}',
    "smtp" TEXT NOT NULL DEFAULT '{}',
    "discord" TEXT NOT NULL DEFAULT '{}',
    "uctv" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT,
    "totpSecretEnc" TEXT,
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "ssoSource" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" DATETIME
);

-- CreateTable
CREATE TABLE "OrgMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrgMember_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrgMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "lastSeen" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signedAt" DATETIME,
    "ip" TEXT NOT NULL DEFAULT '',
    "userAgent" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Token" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "purpose" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT,
    "electionId" TEXT,
    "rollEntryId" TEXT,
    "payload" TEXT NOT NULL DEFAULT '{}',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdBy" TEXT,
    CONSTRAINT "Token_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Party" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "abbr" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#23201c',
    "symbol" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Party_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DistrictSet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "DistrictSet_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "District" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "setId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "seats" INTEGER NOT NULL DEFAULT 1,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "District_setId_fkey" FOREIGN KEY ("setId") REFERENCES "DistrictSet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RegisterEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "email" TEXT,
    "emailKey" TEXT,
    "userId" TEXT,
    "discordUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RegisterEntry_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RegisterDistrict" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entryId" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    CONSTRAINT "RegisterDistrict_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "RegisterEntry" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Election" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "access" TEXT NOT NULL DEFAULT 'PUBLIC',
    "routes" TEXT NOT NULL DEFAULT '["EMAIL_CODE"]',
    "transparency" TEXT NOT NULL DEFAULT 'SECRET',
    "handsLive" BOOLEAN NOT NULL DEFAULT false,
    "resultsMode" TEXT NOT NULL DEFAULT 'SEALED',
    "turnoutLive" BOOLEAN NOT NULL DEFAULT true,
    "allowRevote" BOOLEAN NOT NULL DEFAULT false,
    "districtSetId" TEXT,
    "districtAssign" TEXT NOT NULL DEFAULT 'NONE',
    "fraud" TEXT NOT NULL DEFAULT '{}',
    "heldDefault" TEXT NOT NULL DEFAULT 'WAIT',
    "notices" TEXT NOT NULL DEFAULT '{}',
    "discordRoleIds" TEXT NOT NULL DEFAULT '[]',
    "discordMinAgeDays" INTEGER NOT NULL DEFAULT 0,
    "nominationsOpenAt" DATETIME,
    "nominationsCloseAt" DATETIME,
    "opensAt" DATETIME,
    "closesAt" DATETIME,
    "openedAt" DATETIME,
    "closedAt" DATETIME,
    "rollPublishedAt" DATETIME,
    "round" INTEGER NOT NULL DEFAULT 1,
    "parentId" TEXT,
    "runoffAfterHours" INTEGER,
    "runoffLastsHours" INTEGER,
    "eligibleCount" INTEGER NOT NULL DEFAULT 0,
    "result" TEXT,
    "resultHash" TEXT,
    "seal" TEXT,
    "chainHead" TEXT,
    "countedAt" DATETIME,
    "certifiedAt" DATETIME,
    "certifiedById" TEXT,
    "uctvElectionId" TEXT,
    "reminderSentAt" DATETIME,
    "heldDigestAt" DATETIME,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Election_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Contest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "electionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "instruction" TEXT NOT NULL DEFAULT '',
    "method" TEXT NOT NULL DEFAULT 'SINGLE',
    "maxChoices" INTEGER NOT NULL DEFAULT 1,
    "seats" INTEGER NOT NULL DEFAULT 1,
    "scope" TEXT NOT NULL DEFAULT 'NATIONAL',
    "rule" TEXT NOT NULL DEFAULT '{}',
    CONSTRAINT "Contest_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "Election" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContestDistrict" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contestId" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "seats" INTEGER NOT NULL,
    CONSTRAINT "ContestDistrict_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Option" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contestId" TEXT NOT NULL,
    "districtId" TEXT,
    "name" TEXT NOT NULL,
    "subtitle" TEXT NOT NULL DEFAULT '',
    "partyId" TEXT,
    "color" TEXT NOT NULL DEFAULT '#23201c',
    "symbol" TEXT NOT NULL DEFAULT '',
    "photoId" TEXT,
    "statement" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT 'CHOICE',
    "status" TEXT NOT NULL DEFAULT 'APPROVED',
    "nominatedByEmail" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Option_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ListCandidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "optionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "ListCandidate_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "Option" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NominationSupport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "optionId" TEXT NOT NULL,
    "emailKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NominationSupport_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "Option" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RollEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "electionId" TEXT NOT NULL,
    "identityKey" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "registerEntryId" TEXT,
    "userId" TEXT,
    "emailEnc" TEXT,
    "emailMasked" TEXT NOT NULL DEFAULT '',
    "displayName" TEXT NOT NULL DEFAULT '',
    "nameStruck" BOOLEAN NOT NULL DEFAULT false,
    "districtId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'INVITED',
    "votedAt" DATETIME,
    "ipHash" TEXT NOT NULL DEFAULT '',
    "ipEnc" TEXT NOT NULL DEFAULT '',
    "deviceId" TEXT NOT NULL DEFAULT '',
    "deviceFp" TEXT NOT NULL DEFAULT '',
    "uaHash" TEXT NOT NULL DEFAULT '',
    "signals" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RollEntry_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "Election" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AccessCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "electionId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "batch" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "districtId" TEXT,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccessCode_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "Election" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BoothPass" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "electionId" TEXT NOT NULL,
    "rollEntryId" TEXT NOT NULL,
    "hold" BOOLEAN NOT NULL DEFAULT false,
    "reasons" TEXT NOT NULL DEFAULT '[]',
    "tokenId" TEXT,
    "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    CONSTRAINT "BoothPass_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "Election" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Envelope" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "electionId" TEXT NOT NULL,
    "rollEntryId" TEXT NOT NULL,
    "reasons" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'HELD',
    "decidedById" TEXT,
    "decidedAt" DATETIME,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Envelope_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "Election" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Ballot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "electionId" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "districtId" TEXT,
    "data" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rollEntryId" TEXT,
    "envelopeId" TEXT,
    "revoteTag" TEXT,
    "receiptHash" TEXT NOT NULL,
    "seq" INTEGER,
    "prevHash" TEXT,
    "hash" TEXT,
    "createdAt" DATETIME,
    CONSTRAINT "Ballot_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "Election" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Ballot_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IpVerdict" (
    "ip" TEXT NOT NULL PRIMARY KEY,
    "verdict" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "fetchedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Upload" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Upload_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "lastUsedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApiKey_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Webhook" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "events" TEXT NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Webhook_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Outbox" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT,
    "channel" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextTryAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "seq" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orgId" TEXT,
    "actorId" TEXT,
    "actorLabel" TEXT NOT NULL DEFAULT 'system',
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL DEFAULT '',
    "entityId" TEXT NOT NULL DEFAULT '',
    "details" TEXT NOT NULL DEFAULT '{}',
    "ip" TEXT NOT NULL DEFAULT '',
    "prevHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "RateBucket" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "count" INTEGER NOT NULL,
    "resetAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Organisation_slug_key" ON "Organisation"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "OrgMember_orgId_userId_key" ON "OrgMember"("orgId", "userId");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Token_tokenHash_key" ON "Token"("tokenHash");

-- CreateIndex
CREATE INDEX "Token_purpose_userId_idx" ON "Token"("purpose", "userId");

-- CreateIndex
CREATE INDEX "Token_purpose_electionId_idx" ON "Token"("purpose", "electionId");

-- CreateIndex
CREATE UNIQUE INDEX "District_setId_code_key" ON "District"("setId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "RegisterEntry_orgId_emailKey_key" ON "RegisterEntry"("orgId", "emailKey");

-- CreateIndex
CREATE UNIQUE INDEX "RegisterDistrict_entryId_setId_key" ON "RegisterDistrict"("entryId", "setId");

-- CreateIndex
CREATE INDEX "Election_status_opensAt_idx" ON "Election"("status", "opensAt");

-- CreateIndex
CREATE INDEX "Election_status_closesAt_idx" ON "Election"("status", "closesAt");

-- CreateIndex
CREATE UNIQUE INDEX "Election_orgId_slug_key" ON "Election"("orgId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "ContestDistrict_contestId_districtId_key" ON "ContestDistrict"("contestId", "districtId");

-- CreateIndex
CREATE UNIQUE INDEX "NominationSupport_optionId_emailKey_key" ON "NominationSupport"("optionId", "emailKey");

-- CreateIndex
CREATE INDEX "RollEntry_electionId_ipHash_idx" ON "RollEntry"("electionId", "ipHash");

-- CreateIndex
CREATE INDEX "RollEntry_electionId_deviceId_idx" ON "RollEntry"("electionId", "deviceId");

-- CreateIndex
CREATE INDEX "RollEntry_electionId_deviceFp_idx" ON "RollEntry"("electionId", "deviceFp");

-- CreateIndex
CREATE UNIQUE INDEX "RollEntry_electionId_identityKey_key" ON "RollEntry"("electionId", "identityKey");

-- CreateIndex
CREATE UNIQUE INDEX "AccessCode_codeHash_key" ON "AccessCode"("codeHash");

-- CreateIndex
CREATE INDEX "Ballot_electionId_status_idx" ON "Ballot"("electionId", "status");

-- CreateIndex
CREATE INDEX "Ballot_envelopeId_idx" ON "Ballot"("envelopeId");

-- CreateIndex
CREATE INDEX "Ballot_revoteTag_idx" ON "Ballot"("revoteTag");

-- CreateIndex
CREATE UNIQUE INDEX "Ballot_contestId_receiptHash_key" ON "Ballot"("contestId", "receiptHash");

-- CreateIndex
CREATE UNIQUE INDEX "Ballot_electionId_seq_key" ON "Ballot"("electionId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "Ballot_electionId_prevHash_key" ON "Ballot"("electionId", "prevHash");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "Outbox_status_nextTryAt_idx" ON "Outbox"("status", "nextTryAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuditLog_prevHash_key" ON "AuditLog"("prevHash");

-- CreateIndex
CREATE INDEX "AuditLog_orgId_action_idx" ON "AuditLog"("orgId", "action");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");
