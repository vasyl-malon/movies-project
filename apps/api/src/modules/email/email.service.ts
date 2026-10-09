export interface EmailMessage { to: string; subject: string; text: string }
export abstract class EmailService {
  abstract send(message: EmailMessage): Promise<void>;
}
