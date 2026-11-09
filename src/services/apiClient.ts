import { appConfig } from '../config'
import type { ApiErrorShape } from '../types'

export class ApiClientError extends Error implements ApiErrorShape {
  status: number
  code: ApiErrorShape['code']
  constructor(status: number, code: ApiErrorShape['code'], message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export interface TokenProvider {
  getAccessToken(): Promise<string | null>
}

export class ApiClient {
  constructor(private readonly tokenProvider: TokenProvider, private readonly baseUrl = appConfig.apiBaseUrl) {}

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.baseUrl) throw new ApiClientError(0, 'network', 'API ще не підключено.')
    const token = await this.tokenProvider.getAccessToken()
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
      })
      if (!response.ok) {
        const code = response.status === 401 ? 'unauthorized' : response.status === 403 ? 'forbidden' : response.status >= 500 ? 'server' : 'validation'
        throw new ApiClientError(response.status, code, 'Не вдалося виконати запит.')
      }
      return response.status === 204 ? undefined as T : response.json()
    } catch (error) {
      if (error instanceof ApiClientError) throw error
      throw new ApiClientError(0, 'network', 'Перевірте з’єднання з мережею.')
    }
  }
}
