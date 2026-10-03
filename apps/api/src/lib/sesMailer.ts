/**
 * Amazon SES mailer (SES v2 `SendEmail`). Locally it talks to Floci, which
 * captures every message at `GET /_aws/ses` and relays it to Mailpit; in
 * production the same code reaches real SES.
 */
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

import { describeAwsError, type AwsClientConfig } from './aws';
import type { MailMessage, Mailer } from './mailer';

export class SesMailer implements Mailer {
  private readonly client: SESv2Client;

  constructor(
    clientConfig: AwsClientConfig,
    private readonly from: string,
  ) {
    this.client = new SESv2Client(clientConfig);
  }

  async send(msg: MailMessage): Promise<void> {
    try {
      await this.client.send(
        new SendEmailCommand({
          FromEmailAddress: this.from,
          Destination: { ToAddresses: [msg.to] },
          Content: {
            Simple: {
              Subject: { Data: msg.subject, Charset: 'UTF-8' },
              Body: {
                Html: { Data: msg.html, Charset: 'UTF-8' },
                ...(msg.text === undefined ? {} : { Text: { Data: msg.text, Charset: 'UTF-8' } }),
              },
            },
          },
        }),
      );
    } catch (err) {
      // Carry the AWS error name and message — an unverified sender, the
      // sandbox's verified-recipient rule, a throttle — which describe the
      // *sender* configuration. Never the recipient or the body: a reset link
      // in the log is a live credential (SPEC.md §12). The SDK error itself is
      // not attached as `cause`, because it holds the request it failed on.
      throw new Error(`SES refused the message (${describeAwsError(err)})`);
    }
  }
}
