export type Env = {
  DATABASE_URL: string;
  JWT_ACCESS_SECRET: string;
};

export type Scope = {
  scope_type: 'global' | 'company' | 'brand' | 'outlet' | 'department' | 'own' | 'assigned' | 'audit_view';
  outlet_id?: string;
  brand_id?: string;
  department_id?: string;
};

export type AuthCtx = {
  userId: string;
  companyId: string;
  roles: string[];
  scopes: Scope[];
  firstLoginRequired: boolean;
};
