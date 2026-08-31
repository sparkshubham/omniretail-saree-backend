import { InventoryTxnType } from '@prisma/client';

const INBOUND: InventoryTxnType[] = [
  InventoryTxnType.OPENING_STOCK,
  InventoryTxnType.PURCHASE,
  InventoryTxnType.SALE_RETURN,
  InventoryTxnType.CUSTOMER_RETURN,
  InventoryTxnType.TRANSFER_IN,
];

const OUTBOUND: InventoryTxnType[] = [
  InventoryTxnType.SALE,
  InventoryTxnType.DAMAGE,
  InventoryTxnType.TRANSFER_OUT,
];

export function physicalDelta(type: InventoryTxnType, quantity: number): number {
  if (type === InventoryTxnType.ADJUSTMENT) {
    return quantity;
  }
  if (INBOUND.includes(type)) {
    return Math.abs(quantity);
  }
  if (OUTBOUND.includes(type)) {
    return -Math.abs(quantity);
  }
  return 0;
}

export function reservedDelta(type: InventoryTxnType, quantity: number): number {
  if (type === InventoryTxnType.RESERVATION) {
    return Math.abs(quantity);
  }
  if (type === InventoryTxnType.RESERVATION_RELEASE) {
    return -Math.abs(quantity);
  }
  return 0;
}

export function availableStock(physicalQty: number, reservedQty: number): number {
  return physicalQty - reservedQty;
}

export function assertSufficientStock(params: {
  physicalQty: number;
  reservedQty: number;
  physicalDelta: number;
  reservedDelta: number;
  allowNegative: boolean;
}): void {
  const nextPhysical = params.physicalQty + params.physicalDelta;
  const nextReserved = params.reservedQty + params.reservedDelta;
  if (nextPhysical < 0 || nextReserved < 0) {
    if (!params.allowNegative) {
      throw new Error('INSUFFICIENT_STOCK');
    }
  }
  const nextAvailable = availableStock(nextPhysical, nextReserved);
  if (nextAvailable < 0 && !params.allowNegative) {
    throw new Error('INSUFFICIENT_STOCK');
  }
}
