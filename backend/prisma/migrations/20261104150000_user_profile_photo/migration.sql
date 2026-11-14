-- A separate table avoids loading image bytes with every user/permission query.
-- Existing users are untouched and start without a photo.
CREATE TABLE "user_profile_photos" (
  "userId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "data" BYTEA NOT NULL,
  "mime" VARCHAR(64) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_profile_photos_pkey" PRIMARY KEY ("userId"),
  CONSTRAINT "user_profile_photos_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "user_profile_photos_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "user_profile_photos_companyId_idx" ON "user_profile_photos"("companyId");
