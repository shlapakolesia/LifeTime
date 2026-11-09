import { db } from "./database.js";
export interface EmailMessage {
  recipient: string;
  subject: string;
  text: string;
}
export interface EmailService {
  enqueue(message: EmailMessage): Promise<void>;
}
/** Durable outbox; local adapter does not deliver mail. SES worker can consume queued rows. */
export const emailService: EmailService = {
  async enqueue(message) {
    await db.outgoingEmail.create({ data: message });
  },
};
