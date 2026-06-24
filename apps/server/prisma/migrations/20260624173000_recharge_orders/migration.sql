CREATE TYPE "RechargeOrderStatus" AS ENUM ('PENDING', 'SUBMITTED', 'PAID', 'REJECTED', 'CANCELLED', 'EXPIRED');

CREATE TABLE "RechargeOrder" (
  "id" TEXT NOT NULL,
  "orderNo" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" "RechargeOrderStatus" NOT NULL DEFAULT 'PENDING',
  "amountTokens" INTEGER NOT NULL,
  "requestedAmount" DOUBLE PRECISION NOT NULL,
  "requestedUnit" TEXT NOT NULL,
  "payableCny" DOUBLE PRECISION NOT NULL,
  "paymentMethod" TEXT NOT NULL DEFAULT 'bank_transfer',
  "paymentReference" TEXT NOT NULL,
  "payerNote" TEXT NOT NULL DEFAULT '',
  "adminNote" TEXT NOT NULL DEFAULT '',
  "reviewedById" TEXT,
  "paidTransactionId" TEXT,
  "submittedAt" TIMESTAMP(3),
  "reviewedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RechargeOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RechargeOrder_orderNo_key" ON "RechargeOrder"("orderNo");
CREATE UNIQUE INDEX "RechargeOrder_paymentReference_key" ON "RechargeOrder"("paymentReference");
CREATE INDEX "RechargeOrder_userId_createdAt_idx" ON "RechargeOrder"("userId", "createdAt");
CREATE INDEX "RechargeOrder_status_createdAt_idx" ON "RechargeOrder"("status", "createdAt");
CREATE INDEX "RechargeOrder_expiresAt_idx" ON "RechargeOrder"("expiresAt");

ALTER TABLE "RechargeOrder"
  ADD CONSTRAINT "RechargeOrder_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RechargeOrder"
  ADD CONSTRAINT "RechargeOrder_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
