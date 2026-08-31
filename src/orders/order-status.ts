import { OrderStatus } from '@prisma/client';

export const ORDER_FLOW: Partial<Record<OrderStatus, OrderStatus[]>> = {
  [OrderStatus.NEW]: [OrderStatus.PENDING_PAYMENT, OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  [OrderStatus.PENDING_PAYMENT]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  [OrderStatus.CONFIRMED]: [OrderStatus.PROCESSING, OrderStatus.CANCELLED],
  [OrderStatus.PROCESSING]: [OrderStatus.PACKING, OrderStatus.CANCELLED],
  [OrderStatus.PACKING]: [OrderStatus.READY_TO_SHIP],
  [OrderStatus.READY_TO_SHIP]: [OrderStatus.SHIPPED],
  [OrderStatus.SHIPPED]: [OrderStatus.DELIVERED],
  [OrderStatus.DELIVERED]: [OrderStatus.RETURN_REQUESTED],
  [OrderStatus.RETURN_REQUESTED]: [OrderStatus.RETURN_APPROVED, OrderStatus.CANCELLED],
  [OrderStatus.RETURN_APPROVED]: [OrderStatus.RETURN_RECEIVED],
  [OrderStatus.RETURN_RECEIVED]: [OrderStatus.REFUNDED],
};

export const PACK_STATUSES: OrderStatus[] = [OrderStatus.PACKING, OrderStatus.READY_TO_SHIP];
export const DISPATCH_STATUSES: OrderStatus[] = [OrderStatus.SHIPPED, OrderStatus.DELIVERED];

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_FLOW[from]?.includes(to) === true;
}

export function nextStatuses(from: OrderStatus): OrderStatus[] {
  return ORDER_FLOW[from] ?? [];
}
