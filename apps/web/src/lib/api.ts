import axios from 'axios'
import { useAuthStore } from './auth-store'

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8787/api/v1'

const api = axios.create({ baseURL: BASE_URL })

let refreshPromise: Promise<string> | null = null

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config

    if (error.response?.status !== 401 || originalRequest._retry) {
      return Promise.reject(error)
    }

    originalRequest._retry = true

    if (!refreshPromise) {
      refreshPromise = (async () => {
        try {
          const res = await axios.post(`${BASE_URL}/auth/refresh`, {}, { withCredentials: true })
          const newToken: string = res.data.data.accessToken
          useAuthStore.getState().setAuth(newToken, useAuthStore.getState().user!)
          return newToken
        } catch {
          useAuthStore.getState().clear()
          window.location.href = '/login'
          throw new Error('Refresh failed')
        } finally {
          refreshPromise = null
        }
      })()
    }

    const token = await refreshPromise
    originalRequest.headers.Authorization = `Bearer ${token}`
    return api(originalRequest)
  },
)

export default api
export { BASE_URL }
