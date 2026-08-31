export const FEATURE_KEYS = [
  'ENABLE_WHATSAPP',
  'ENABLE_AMAZON',
  'ENABLE_FLIPKART',
  'ENABLE_SHIPPING',
  'ENABLE_MULTI_WAREHOUSE',
  'ENABLE_API_ACCESS',
  'ENABLE_CUSTOM_DOMAIN',
  'ENABLE_ADVANCED_REPORTS',
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  ENABLE_WHATSAPP: 'WhatsApp',
  ENABLE_AMAZON: 'Amazon',
  ENABLE_FLIPKART: 'Flipkart',
  ENABLE_SHIPPING: 'Shipping',
  ENABLE_MULTI_WAREHOUSE: 'Multiple warehouses',
  ENABLE_API_ACCESS: 'API access',
  ENABLE_CUSTOM_DOMAIN: 'Custom domain',
  ENABLE_ADVANCED_REPORTS: 'Advanced reports',
};
