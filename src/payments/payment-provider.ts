export interface CreatePaymentInput {
  amount: number;
  currency: string;
  orderId: string;
  orderNumber: string;
  idempotencyKey: string;
  metadata?: Record<string, string>;
}

export interface CreatePaymentResult {
  providerPaymentId: string;
  checkoutUrl?: string | null;
}

export interface VerifyPaymentInput {
  providerPaymentId: string;
  payload?: Record<string, unknown>;
}

export interface RefundPaymentInput {
  providerPaymentId: string;
  amount: number;
}

export interface PaymentProvider {
  readonly name: string;
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  verifyPayment(input: VerifyPaymentInput): Promise<{ success: boolean }>;
  refundPayment(input: RefundPaymentInput): Promise<{ success: boolean }>;
}
