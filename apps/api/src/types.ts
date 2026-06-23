export type Env = {
  DATABASE_URL: string;
  JWT_ACCESS_SECRET: string;
};

export type Scope = {
  scope_type: 'global' | 'company' | 'brand' | 'outlet' | 'department' | 'own' | 'assigned' | 'audit_view';
  scope_id: string | null;
};

export type AuthCtx = {
  userId: string;
  companyId: string;
  roles: string[];
  scopes: Scope[];
  firstLoginRequired: boolean;
};
