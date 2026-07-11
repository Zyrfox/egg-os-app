export type Env = {
  DATABASE_URL: string;
  JWT_ACCESS_SECRET: string;
  EVIDENCE_BUCKET: R2Bucket;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
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
