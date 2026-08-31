import { Injectable } from '@nestjs/common';
import { PaymentProviderKind } from '@prisma/client';
import { PaymentProvider } from './payment-provider';
import { MockPaymentProvider } from './mock.provider';

@Injectable()
export class PaymentsService {
  private readonly mock = new MockPaymentProvider();

  getProvider(kind: PaymentProviderKind = PaymentProviderKind.MOCK): PaymentProvider {
    switch (kind) {
      case PaymentProviderKind.RAZORPAY:
      case PaymentProviderKind.STRIPE:
        // Live providers land with Phase 6 checkout. Mock keeps ERP usable today.
        return this.mock;
      default:
        return this.mock;
    }
  }
}
