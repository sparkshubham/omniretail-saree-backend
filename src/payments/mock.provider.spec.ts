import { MockPaymentProvider } from './mock.provider';

describe('MockPaymentProvider', () => {
  const provider = new MockPaymentProvider();

  it('creates a mock payment id and verifies it', async () => {
    const created = await provider.createPayment({
      amount: 100,
      currency: 'INR',
      orderId: 'ord_1',
      orderNumber: 'GA1001',
      idempotencyKey: 'k1',
    });
    expect(created.providerPaymentId.startsWith('mock_ord_1_')).toBe(true);
    await expect(provider.verifyPayment({ providerPaymentId: created.providerPaymentId })).resolves.toEqual({
      success: true,
    });
  });

  it('rejects unknown provider ids', async () => {
    await expect(provider.verifyPayment({ providerPaymentId: 'rzp_123' })).resolves.toEqual({ success: false });
  });
});
