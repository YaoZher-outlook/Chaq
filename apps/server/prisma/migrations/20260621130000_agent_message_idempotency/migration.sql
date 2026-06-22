-- Agent actions are processed with at-least-once delivery. This key prevents
-- a retried run from sending the same message more than once.
ALTER TABLE "ConversationMessage" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "ConversationMessage_idempotencyKey_key" ON "ConversationMessage"("idempotencyKey");
