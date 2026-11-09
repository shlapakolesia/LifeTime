import type { PremiumRequest } from '../types'
import { browserFileStore } from './browserFileStore'

export interface PremiumSubmission {
  userId: string
  firstName: string
  lastName: string
  accountEmail: string
  screenshotDataUrl: string
  screenshotFileName: string
}

export interface PremiumRequestService {
  submit(input: PremiumSubmission): Promise<PremiumRequest>
  getScreenshot(requestId: string): Promise<string | undefined>
}

class LocalPremiumRequestService implements PremiumRequestService {
  async submit(input: PremiumSubmission): Promise<PremiumRequest> {
    await new Promise((resolve) => window.setTimeout(resolve, 650))
    const id = `pr-${Date.now()}`
    await browserFileStore.set(`premium:${id}`, input.screenshotDataUrl)
    return {
      id,
      userId: input.userId,
      submittedFullName: `${input.firstName} ${input.lastName}`,
      accountEmail: input.accountEmail,
      screenshotDataUrl: input.screenshotDataUrl,
      screenshotFileName: input.screenshotFileName,
      status: 'pending',
      submittedAt: new Date().toISOString(),
    }
  }
  getScreenshot(requestId: string) { return browserFileStore.get(`premium:${requestId}`) }
}

// Replace with an API implementation that sends FormData to
// POST /api/premium/requests. The backend will store the image in S3 and
// trigger an administrator notification through Amazon SES.
export const premiumRequestService: PremiumRequestService = new LocalPremiumRequestService()
