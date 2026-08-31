import { PurchaseStatus } from '@prisma/client';
import { purchaseStatusAfterReceive } from './purchases.status';

describe('purchaseStatusAfterReceive', () => {
  it('stays SENT when nothing arrived', () => {
    expect(purchaseStatusAfterReceive(10, 0)).toBe(PurchaseStatus.SENT);
  });

  it('marks partial receipts', () => {
    expect(purchaseStatusAfterReceive(10, 4)).toBe(PurchaseStatus.PARTIALLY_RECEIVED);
  });

  it('marks fully received', () => {
    expect(purchaseStatusAfterReceive(10, 10)).toBe(PurchaseStatus.RECEIVED);
  });
});
