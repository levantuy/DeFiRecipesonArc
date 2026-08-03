-- CreateEnum
CREATE TYPE "RecipeType" AS ENUM ('AUTO_COMPOUNDER', 'RECURRING_DCA', 'SMART_YIELD_REBALANCER', 'SAFETY_NET', 'SAVINGS_STREAM');

-- CreateEnum
CREATE TYPE "RecipeStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('SIMULATING', 'SUBMITTED', 'CONFIRMED', 'SIMULATION_FAILED', 'REVERTED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionKey" (
    "id" TEXT NOT NULL,
    "userAddress" TEXT NOT NULL,
    "sessionPublicKey" TEXT NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "maxUsdcSpend" DECIMAL(18,6),
    "currentUsdcSpent" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActiveRecipe" (
    "id" TEXT NOT NULL,
    "userAddress" TEXT NOT NULL,
    "recipeType" "RecipeType" NOT NULL,
    "status" "RecipeStatus" NOT NULL DEFAULT 'ACTIVE',
    "targetProtocol" TEXT NOT NULL,
    "parametersJson" JSONB NOT NULL,
    "lastExecutedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActiveRecipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionLog" (
    "id" TEXT NOT NULL,
    "activeRecipeId" TEXT NOT NULL,
    "status" "ExecutionStatus" NOT NULL,
    "txHash" TEXT,
    "gasUsedUsdc" DECIMAL(18,6),
    "simulatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executedAt" TIMESTAMP(3),
    "errorMessage" TEXT,

    CONSTRAINT "ExecutionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_walletAddress_key" ON "User"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "SessionKey_sessionPublicKey_key" ON "SessionKey"("sessionPublicKey");

-- CreateIndex
CREATE INDEX "ActiveRecipe_userAddress_idx" ON "ActiveRecipe"("userAddress");

-- CreateIndex
CREATE INDEX "ActiveRecipe_recipeType_status_idx" ON "ActiveRecipe"("recipeType", "status");

-- CreateIndex
CREATE INDEX "ExecutionLog_activeRecipeId_idx" ON "ExecutionLog"("activeRecipeId");

-- CreateIndex
CREATE INDEX "ExecutionLog_txHash_idx" ON "ExecutionLog"("txHash");

-- AddForeignKey
ALTER TABLE "SessionKey" ADD CONSTRAINT "SessionKey_userAddress_fkey" FOREIGN KEY ("userAddress") REFERENCES "User"("walletAddress") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActiveRecipe" ADD CONSTRAINT "ActiveRecipe_userAddress_fkey" FOREIGN KEY ("userAddress") REFERENCES "User"("walletAddress") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionLog" ADD CONSTRAINT "ExecutionLog_activeRecipeId_fkey" FOREIGN KEY ("activeRecipeId") REFERENCES "ActiveRecipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;
