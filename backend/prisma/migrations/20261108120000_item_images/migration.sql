-- Item pictures, kept in their own table for the same reason the profile photo
-- is: listing the catalogue must not drag image bytes with it.
--
-- Additive only. No existing row is read or rewritten, and every item simply
-- starts without a picture. The bytes live inside the database rather than on
-- disk so they travel in the same backup file as the rest of the catalogue.
CREATE TABLE "item_images" (
  "itemId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "data" BYTEA NOT NULL,
  "mime" VARCHAR(64) NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "item_images_pkey" PRIMARY KEY ("itemId"),
  CONSTRAINT "item_images_itemId_fkey" FOREIGN KEY ("itemId")
    REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "item_images_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "item_images_companyId_idx" ON "item_images"("companyId");
