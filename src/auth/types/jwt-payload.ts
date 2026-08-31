export interface JwtPayload {
  sub: string;
  tenantId: string | null;
  email: string;
  roles: string[];
  kind?: 'staff' | 'customer';
  customerId?: string;
}

export interface RequestUser {
  id: string;
  tenantId: string | null;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  permissions: string[];
  isSuperAdmin: boolean;
  isCustomer?: boolean;
  customerId?: string;
}
