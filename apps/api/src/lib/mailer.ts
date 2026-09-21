/**
 * Outbound email (SPEC.md §3, §9 forgot-password). Sending happens in the
 * `send-email` queue job (M10); this is the seam that job talks to.
 */
import { Resend } from 'resend';

export type MailMessage = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

export interface Mailer {
  send(msg: MailMessage): Promise<void>;
}

/** Resend-backed mailer (SPEC.md §2 "Email"). */
export class ResendMailer implements Mailer {
  private readonly client: Resend;

  constructor(
    apiKey: string,
    private readonly from: string,
  ) {
    this.client = new Resend(apiKey);
  }

  async send(msg: MailMessage): Promise<void> {
    const { error } = await this.client.emails.send({
      from: this.from,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      ...(msg.text === undefined ? {} : { text: msg.text }),
    });
    // Resend reports failures in the payload rather than by throwing. Carry
    // its message, not just the name: "validation_error" alone says nothing,
    // while the message names the actual problem — an unverified sender
    // domain, or the test sender's rule that it may only write to the account
    // owner's own address. The message describes the *sender* configuration,
    // never the recipient's content, so it is safe to log.
    if (error) {
      throw new Error(`Resend refused the message (${error.name}): ${error.message}`);
    }
  }
}

/** Test double: records everything instead of sending it. */
export class FakeMailer implements Mailer {
  readonly sent: MailMessage[] = [];

  async send(msg: MailMessage): Promise<void> {
    this.sent.push(msg);
  }

  /** Most recent message, or `undefined` when nothing was sent. */
  last(): MailMessage | undefined {
    return this.sent[this.sent.length - 1];
  }

  reset(): void {
    this.sent.length = 0;
  }
}
