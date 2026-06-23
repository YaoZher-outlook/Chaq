CREATE TYPE "ModelProviderScope" AS ENUM ('PLATFORM', 'USER_PRIVATE');

ALTER TABLE "ModelProviderConfig"
ADD COLUMN "scope" "ModelProviderScope" NOT NULL DEFAULT 'PLATFORM',
ADD COLUMN "ownerId" TEXT;

ALTER TABLE "ModelProviderConfig"
ADD CONSTRAINT "ModelProviderConfig_ownerId_fkey"
FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ModelProviderConfig"
ADD CONSTRAINT "ModelProviderConfig_scope_owner_check"
CHECK (
  ("scope" = 'PLATFORM' AND "ownerId" IS NULL)
  OR ("scope" = 'USER_PRIVATE' AND "ownerId" IS NOT NULL)
);

CREATE INDEX "ModelProviderConfig_scope_ownerId_enabled_idx"
ON "ModelProviderConfig"("scope", "ownerId", "enabled");
