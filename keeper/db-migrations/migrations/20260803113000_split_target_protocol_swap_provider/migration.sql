-- Normalize recipe execution semantics:
-- - targetProtocol: on-chain execution target (nullable for route-resolved swaps)
-- - swapProvider: off-chain swap route provider

CREATE TYPE "SwapProvider" AS ENUM ('ARC_APP_KIT_SWAP');

ALTER TABLE "ActiveRecipe"
ALTER COLUMN "targetProtocol" DROP NOT NULL,
ADD COLUMN "swapProvider" "SwapProvider";
