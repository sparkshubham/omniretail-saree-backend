import { PurchaseStatus } from '@prisma/client';

export function purchaseStatusAfterReceive(ordered: number, received: number): PurchaseStatus {
  if (received <= 0) return PurchaseStatus.SENT;
  if (received < ordered) return PurchaseStatus.PARTIALLY_RECEIVED;
  return PurchaseStatus.RECEIVED;
}
