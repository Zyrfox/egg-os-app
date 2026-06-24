type TestListItem = {
  [key: string]: unknown
  brand_code: string
  code: string
  company_code: string
  company_name: string
  department_code: string
  id: string
  outlet_code: string
  role_code: string
  status: string
}

type TestDataObject = {
  [key: string]: unknown
  access_filter: unknown
  access_token: string
  code: string
  deleted_at: string | null
  id: string
  name: string
  permission_code: string
  permissions: TestListItem[]
  refresh_token: string
  role_code: string
  roles: TestListItem[]
  scopes: unknown[]
  success: boolean
  token_type: string
  user: { email: string; [key: string]: unknown }
}

export type TestResponseBody = {
  success: boolean
  data: TestDataObject & TestListItem[]
  error: {
    code: string
    message?: string
    details: unknown[]
    [key: string]: unknown
  }
  meta: Record<string, unknown>
}
