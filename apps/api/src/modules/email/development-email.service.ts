import nodemailer from 'nodemailer';
import { EmailService, type EmailMessage } from './email.service.js';

export class DevelopmentEmailService extends EmailService {
  private readonly transport;
  constructor(port = 1025) {
    super();
    // Deliberately loopback only: this provider cannot contact a real mail server.
    this.transport = nodemailer.createTransport({ host: '127.0.0.1', port, secure: false, connectionTimeout: 5000 });
  }
  async send(message: EmailMessage): Promise<void> {
    await this.transport.sendMail({ from: 'Movie Tracker <tracker@example.test>', ...message });
  }
}
