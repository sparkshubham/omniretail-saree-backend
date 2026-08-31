import { SetMetadata } from '@nestjs/common';
import { FeatureKey } from '../constants/features';

export const FEATURE_KEY = 'requiredFeature';
export const RequireFeature = (feature: FeatureKey) => SetMetadata(FEATURE_KEY, feature);
