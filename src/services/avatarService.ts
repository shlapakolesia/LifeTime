const MAX_IMAGE_SIZE = 5 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export function validateImage(file: File) {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) return 'Підтримуються лише JPEG, PNG та WebP.'
  if (file.size > MAX_IMAGE_SIZE) return 'Файл завеликий. Максимальний розмір — 5 МБ.'
  return null
}

export interface AvatarUploadService {
  save(userId: string, file: File): Promise<string>
  load(userId: string): Promise<string | undefined>
  remove(userId: string): Promise<void>
}

class LocalAvatarUploadService implements AvatarUploadService {
  async save(userId: string, file: File) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error('Не вдалося прочитати файл.'))
      reader.readAsDataURL(file)
    })
    await browserFileStore.set(`avatar:${userId}`, dataUrl)
    return dataUrl
  }
  load(userId: string) { return browserFileStore.get(`avatar:${userId}`) }
  remove(userId: string) { return browserFileStore.remove(`avatar:${userId}`) }
}

// The production implementation will request a short-lived S3 presigned URL
// from the authenticated API and upload the file without exposing AWS keys.
export const avatarUploadService: AvatarUploadService = new LocalAvatarUploadService()
import { browserFileStore } from './browserFileStore'
