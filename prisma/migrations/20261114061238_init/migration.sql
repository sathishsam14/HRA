-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'HANDICAPPER', 'VIEWER');

-- CreateEnum
CREATE TYPE "RaceType" AS ENUM ('TERMS', 'HANDICAP');

-- CreateEnum
CREATE TYPE "RaceStatus" AS ENUM ('OPEN', 'REVIEWED');

-- CreateEnum
CREATE TYPE "RatingStatus" AS ENUM ('RATED', 'UNCHANGED', 'NOT_ELIGIBLE', 'NOT_RATED', 'NEEDS_HANDICAPPER');

-- CreateEnum
CREATE TYPE "KeywordType" AS ENUM ('STARTER', 'VETERINARY', 'INCIDENT', 'CONSTANT');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Horse" (
    "id" SERIAL NOT NULL,
    "horseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sexCategory" TEXT,
    "previousRuns" INTEGER NOT NULL DEFAULT 0,
    "currentRating" INTEGER,
    "trainer" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Horse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Race" (
    "id" SERIAL NOT NULL,
    "venue" TEXT NOT NULL,
    "raceDate" DATE NOT NULL,
    "season" TEXT,
    "category" TEXT NOT NULL,
    "raceNo" INTEGER NOT NULL,
    "cardNo" INTEGER,
    "distance" INTEGER NOT NULL,
    "raceType" "RaceType",
    "status" "RaceStatus" NOT NULL DEFAULT 'OPEN',

    CONSTRAINT "Race_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RaceEntry" (
    "id" SERIAL NOT NULL,
    "raceId" INTEGER NOT NULL,
    "horseId" INTEGER NOT NULL,
    "horseWeight" DOUBLE PRECISION,
    "shoes" TEXT,
    "startGate" INTEGER,
    "weightDeclare" DOUBLE PRECISION,
    "weightCarried" DOUBLE PRECISION,
    "jockey" TEXT,
    "placing" INTEGER,
    "timing" TEXT,
    "verdict" TEXT,
    "trainer" TEXT,
    "penetrometer" DOUBLE PRECISION,
    "railing" TEXT,
    "starterRemark" TEXT,
    "veterinaryRemark" TEXT,
    "incidentRemark" TEXT,

    CONSTRAINT "RaceEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rating" (
    "id" SERIAL NOT NULL,
    "entryId" INTEGER NOT NULL,
    "status" "RatingStatus" NOT NULL,
    "recommendedChange" INTEGER,
    "recommendedRating" INTEGER,
    "reasons" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" SERIAL NOT NULL,
    "entryId" INTEGER NOT NULL,
    "finalChange" INTEGER NOT NULL,
    "finalRating" INTEGER NOT NULL,
    "overridden" BOOLEAN NOT NULL DEFAULT false,
    "overrideReason" TEXT,
    "userId" INTEGER NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" INTEGER,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadedFile" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "errorText" TEXT,
    "uploadedBy" INTEGER,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UploadedFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Coefficient" (
    "id" SERIAL NOT NULL,
    "category" TEXT NOT NULL,
    "distance" INTEGER NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "time" DOUBLE PRECISION NOT NULL,
    "length" DOUBLE PRECISION NOT NULL,
    "penetrometer" DOUBLE PRECISION NOT NULL,
    "pTime" DOUBLE PRECISION,
    "pLength" DOUBLE PRECISION,
    "pPene" DOUBLE PRECISION,
    "overall" DOUBLE PRECISION,

    CONSTRAINT "Coefficient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExceptionKeyword" (
    "id" SERIAL NOT NULL,
    "type" "KeywordType" NOT NULL,
    "text" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ExceptionKeyword_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleVersion" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Horse_horseId_key" ON "Horse"("horseId");

-- CreateIndex
CREATE UNIQUE INDEX "Race_venue_raceDate_raceNo_key" ON "Race"("venue", "raceDate", "raceNo");

-- CreateIndex
CREATE UNIQUE INDEX "RaceEntry_raceId_horseId_key" ON "RaceEntry"("raceId", "horseId");

-- CreateIndex
CREATE UNIQUE INDEX "Rating_entryId_key" ON "Rating"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "Decision_entryId_key" ON "Decision"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "UploadedFile_name_size_hash_key" ON "UploadedFile"("name", "size", "hash");

-- CreateIndex
CREATE UNIQUE INDEX "Coefficient_category_distance_key" ON "Coefficient"("category", "distance");

-- CreateIndex
CREATE UNIQUE INDEX "ExceptionKeyword_type_text_key" ON "ExceptionKeyword"("type", "text");

-- AddForeignKey
ALTER TABLE "RaceEntry" ADD CONSTRAINT "RaceEntry_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "Race"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RaceEntry" ADD CONSTRAINT "RaceEntry_horseId_fkey" FOREIGN KEY ("horseId") REFERENCES "Horse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "RaceEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "RaceEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadedFile" ADD CONSTRAINT "UploadedFile_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
