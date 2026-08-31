import { InventoryTxnType } from '@prisma/client';
import { assertSufficientStock, availableStock, physicalDelta, reservedDelta } from './inventory.math';

describe('inventory ledger math', () => {
  it('computes the spec example: opening + purchase - sales + return - damage', () => {
    const movements: Array<[InventoryTxnType, number]> = [
      [InventoryTxnType.OPENING_STOCK, 100],
      [InventoryTxnType.PURCHASE, 50],
      [InventoryTxnType.SALE, 10],
      [InventoryTxnType.SALE, 5],
      [InventoryTxnType.SALE, 5],
      [InventoryTxnType.CUSTOMER_RETURN, 2],
      [InventoryTxnType.DAMAGE, 1],
    ];
    const physical = movements.reduce((sum, [type, qty]) => sum + physicalDelta(type, qty), 0);
    expect(physical).toBe(131);
    expect(availableStock(physical, 0)).toBe(131);
  });

  it('treats available as physical minus reserved', () => {
    expect(availableStock(100, 10)).toBe(90);
  });

  it('reservation reduces available without changing physical', () => {
    const physical = physicalDelta(InventoryTxnType.RESERVATION, 10);
    const reserved = reservedDelta(InventoryTxnType.RESERVATION, 10);
    expect(physical).toBe(0);
    expect(reserved).toBe(10);
    expect(availableStock(100, 10)).toBe(90);
  });

  it('blocks overselling when available would go negative', () => {
    expect(() =>
      assertSufficientStock({
        physicalQty: 1,
        reservedQty: 0,
        physicalDelta: physicalDelta(InventoryTxnType.SALE, 2),
        reservedDelta: 0,
        allowNegative: false,
      }),
    ).toThrow('INSUFFICIENT_STOCK');
  });

  it('blocks overselling when a reservation would consume remaining available stock', () => {
    expect(() =>
      assertSufficientStock({
        physicalQty: 40,
        reservedQty: 0,
        physicalDelta: 0,
        reservedDelta: 41,
        allowNegative: false,
      }),
    ).toThrow('INSUFFICIENT_STOCK');
  });

  it('reservation then confirm: available drops, then physical drops, reserved returns to zero', () => {
    let physical = 40;
    let reserved = 0;
    physical += physicalDelta(InventoryTxnType.RESERVATION, 1);
    reserved += reservedDelta(InventoryTxnType.RESERVATION, 1);
    expect(physical).toBe(40);
    expect(availableStock(physical, reserved)).toBe(39);

    physical += physicalDelta(InventoryTxnType.RESERVATION_RELEASE, 1);
    reserved += reservedDelta(InventoryTxnType.RESERVATION_RELEASE, 1);
    physical += physicalDelta(InventoryTxnType.SALE, 1);
    reserved += reservedDelta(InventoryTxnType.SALE, 1);
    expect(physical).toBe(39);
    expect(reserved).toBe(0);
    expect(availableStock(physical, reserved)).toBe(39);
  });

  it('cancel while reserved restores available without changing physical', () => {
    let physical = 40;
    let reserved = 0;
    physical += physicalDelta(InventoryTxnType.RESERVATION, 2);
    reserved += reservedDelta(InventoryTxnType.RESERVATION, 2);
    physical += physicalDelta(InventoryTxnType.RESERVATION_RELEASE, 2);
    reserved += reservedDelta(InventoryTxnType.RESERVATION_RELEASE, 2);
    expect(physical).toBe(40);
    expect(reserved).toBe(0);
  });

  it('allows negative stock only when configured', () => {
    expect(() =>
      assertSufficientStock({
        physicalQty: 0,
        reservedQty: 0,
        physicalDelta: physicalDelta(InventoryTxnType.SALE, 1),
        reservedDelta: 0,
        allowNegative: true,
      }),
    ).not.toThrow();
  });
});
