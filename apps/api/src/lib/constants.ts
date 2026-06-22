export const AUTH = {
  ACCESS_TTL_SEC: 15 * 60,           // 15 menit
  REFRESH_TTL_SEC: 7 * 24 * 3600,    // 7 hari
  SET_PASSWORD_TTL_SEC: 72 * 3600,   // 72 jam
  RESET_PASSWORD_TTL_SEC: 24 * 3600, // 24 jam
  MAX_FAILED_LOGIN: 5,
  LOCK_DURATION_SEC: 15 * 60,        // lock 15 menit setelah 5 gagal
  PASSWORD: { minLength: 8, requireLetter: true, requireNumber: true },
} as const;
