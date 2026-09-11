-- SessionKey off-chain table is no longer used: session key state and spend limits
-- are now managed on-chain via SessionKeyRegistry.sol as the single source of truth.
-- This migration is idempotent and safe to run on environments that already dropped it.

ALTER TABLE IF EXISTS "SessionKey" DROP CONSTRAINT IF EXISTS "SessionKey_userAddress_fkey";

DROP TABLE IF EXISTS "SessionKey";
