import { randomUUID } from 'crypto';
import {
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentProvider,
  RefundPaymentInput,
  VerifyPaymentInput,
} from './payment-provider';

export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'MOCK';

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    return {
      providerPaymentId: `mock_${input.orderId}_${randomUUID().slice(0, 8)}`,
      checkoutUrl: null,
    };
  }

  async verifyPayment(input: VerifyPaymentInput): Promise<{ success: boolean }> {
    return { success: input.providerPaymentId.startsWith('mock_') };
  }

  async refundPayment(_input: RefundPaymentInput): Promise<{ success: boolean }> {
    return { success: true };
  }
}
