type ErrorDetail = { field: string; issue: string };

export function errResponse(
  code: string,
  message: string,
  details?: ErrorDetail[]
) {
  return {
    success: false as const,
    error: { code, message, ...(details ? { details } : {}) },
  };
}

export function okResponse<T>(data: T, meta?: Record<string, unknown>) {
  return { success: true as const, data, ...(meta ? { meta } : {}) };
}

// Error catalog — codes from Global Contract §2
export const ERR = {
  VALIDATION:               { code: 'ERR_VALIDATION',               message: 'Input tidak valid',                             http: 422 },
  UNAUTHENTICATED:          { code: 'ERR_UNAUTHENTICATED',          message: 'Sesi tidak valid / token kedaluwarsa',          http: 401 },
  FORBIDDEN:                { code: 'ERR_FORBIDDEN',                message: 'Akses ditolak',                                 http: 403 },
  NOT_FOUND:                { code: 'ERR_NOT_FOUND',                message: 'Data tidak ditemukan',                          http: 404 },
  DUPLICATE:                { code: 'ERR_DUPLICATE',                message: 'Data duplikat',                                  http: 409 },
  CONFLICT:                 { code: 'ERR_CONFLICT',                 message: 'Data bentrok / duplikat',                       http: 409 },
  INSUFFICIENT_STOCK:       { code: 'ERR_INSUFFICIENT_STOCK',       message: 'Stok tidak mencukupi',                          http: 422 },
  INTERNAL:                 { code: 'ERR_INTERNAL',                 message: 'Terjadi kesalahan sistem',                      http: 500 },
  INVALID_CREDENTIALS:      { code: 'ERR_INVALID_CREDENTIALS',      message: 'Email atau password tidak sesuai',              http: 401 },
  USER_INACTIVE:            { code: 'ERR_USER_INACTIVE',            message: 'Akun tidak aktif',                              http: 403 },
  PASSWORD_CHANGE_REQUIRED: { code: 'ERR_PASSWORD_CHANGE_REQUIRED', message: 'Ganti password terlebih dahulu',                http: 403 },
  TOKEN_EXPIRED:            { code: 'ERR_TOKEN_EXPIRED',            message: 'Token kedaluwarsa',                             http: 401 },
  TOKEN_USED:               { code: 'ERR_TOKEN_USED',               message: 'Token sudah digunakan',                         http: 409 },
  LOGIN_LOCKED:             { code: 'ERR_LOGIN_LOCKED',             message: 'Terlalu banyak percobaan login, coba lagi nanti', http: 429 },
} as const;
