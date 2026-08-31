import { SetMetadata } from '@nestjs/common';

export const CUSTOMER_ACCOUNT_KEY = 'customerAccount';
export const CustomerAccount = () => SetMetadata(CUSTOMER_ACCOUNT_KEY, true);
