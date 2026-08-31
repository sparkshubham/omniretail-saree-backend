import { OrderStatus } from '@prisma/client';
import { canTransition, nextStatuses } from './order-status';

describe('order status flow', () => {
  it('follows NEW → PENDING_PAYMENT → CONFIRMED → … → DELIVERED', () => {
    expect(canTransition(OrderStatus.NEW, OrderStatus.PENDING_PAYMENT)).toBe(true);
    expect(canTransition(OrderStatus.PENDING_PAYMENT, OrderStatus.CONFIRMED)).toBe(true);
    expect(canTransition(OrderStatus.CONFIRMED, OrderStatus.PROCESSING)).toBe(true);
    expect(canTransition(OrderStatus.PROCESSING, OrderStatus.PACKING)).toBe(true);
    expect(canTransition(OrderStatus.PACKING, OrderStatus.READY_TO_SHIP)).toBe(true);
    expect(canTransition(OrderStatus.READY_TO_SHIP, OrderStatus.SHIPPED)).toBe(true);
    expect(canTransition(OrderStatus.SHIPPED, OrderStatus.DELIVERED)).toBe(true);
  });

  it('blocks skipping fulfillment steps', () => {
    expect(canTransition(OrderStatus.CONFIRMED, OrderStatus.SHIPPED)).toBe(false);
    expect(canTransition(OrderStatus.NEW, OrderStatus.DELIVERED)).toBe(false);
  });

  it('allows cancel before packing', () => {
    expect(canTransition(OrderStatus.PENDING_PAYMENT, OrderStatus.CANCELLED)).toBe(true);
    expect(canTransition(OrderStatus.CONFIRMED, OrderStatus.CANCELLED)).toBe(true);
    expect(canTransition(OrderStatus.PACKING, OrderStatus.CANCELLED)).toBe(false);
  });

  it('does not allow packing to jump back to payment', () => {
    expect(canTransition(OrderStatus.PACKING, OrderStatus.PENDING_PAYMENT)).toBe(false);
  });

  it('lists the next allowed statuses for the UI', () => {
    expect(nextStatuses(OrderStatus.PACKING)).toEqual([OrderStatus.READY_TO_SHIP]);
  });
});
