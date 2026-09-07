-- Remove deprecated legacy recipe type from persisted data and enum definition.
-- This migration is idempotent and safe to run on environments that already removed the value.

DO $$
DECLARE
  legacy_recipe_type text := 'SMART_' || 'YIELD_' || 'REBALANCER';
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_type t
    WHERE t.typname = 'RecipeType'
  ) THEN
    -- Purge deprecated recipes first so enum cast can succeed.
    DELETE FROM "ExecutionLog"
    WHERE "activeRecipeId" IN (
      SELECT "id"
      FROM "ActiveRecipe"
      WHERE "recipeType"::text = legacy_recipe_type
    );

    DELETE FROM "ActiveRecipe"
    WHERE "recipeType"::text = legacy_recipe_type;

    IF EXISTS (
      SELECT 1
      FROM pg_enum e
      INNER JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'RecipeType'
        AND e.enumlabel = legacy_recipe_type
    ) THEN
      ALTER TYPE "RecipeType" RENAME TO "RecipeType_old";
      CREATE TYPE "RecipeType" AS ENUM ('AUTO_COMPOUNDER', 'RECURRING_DCA', 'SAFETY_NET', 'SAVINGS_STREAM');

      ALTER TABLE "ActiveRecipe"
      ALTER COLUMN "recipeType" TYPE "RecipeType"
      USING ("recipeType"::text::"RecipeType");

      DROP TYPE "RecipeType_old";
    END IF;
  END IF;
END $$;