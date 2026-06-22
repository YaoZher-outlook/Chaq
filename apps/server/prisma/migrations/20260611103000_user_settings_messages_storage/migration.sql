ALTER TABLE "UserSetting"
  ADD COLUMN "notificationSound" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "iconFlash" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "localChatDataPath" TEXT,
  ADD COLUMN "fileStoragePath" TEXT;
