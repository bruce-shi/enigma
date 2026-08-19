export {};

declare global {
  interface EmailAddress {
    email: string;
    name?: string;
  }

  interface EmailMessageBuilder {
    to: string | EmailAddress | Array<string | EmailAddress>;
    from: string | EmailAddress;
    subject: string;
    html?: string;
    text?: string;
    replyTo?: string | EmailAddress;
    headers?: Record<string, string>;
  }

  interface SendEmailResult {
    messageId: string;
  }

  interface SendEmail {
    send(message: EmailMessageBuilder): Promise<SendEmailResult>;
  }

  interface Env {
    DB: D1Database;
    CRASH_REPORTS: R2Bucket;
    EMAIL: SendEmail;
    PUBLIC_ORIGIN: string;
    EMAIL_FROM: string;
    BETTER_AUTH_SECRET: string;
    STRIPE_SECRET_KEY: string;
    STRIPE_WEBHOOK_SECRET: string;
    STRIPE_MONTHLY_PRICE_ID: string;
    STRIPE_YEARLY_PRICE_ID: string;
    DESKTOP_TOKEN_SECRET: string;
    ENTITLEMENT_PRIVATE_KEY: string;
    PUBLIC_RELEASE_STATUS: string;
    PUBLIC_RELEASE_VERSION: string;
    PUBLIC_SUPPORTED_IOS_BUILDS: string;
    PUBLIC_BILLING_ENABLED: string;
    PUBLIC_MONTHLY_PRICE_LABEL: string;
    PUBLIC_YEARLY_PRICE_LABEL: string;
    PUBLIC_MACOS_ARM64_DOWNLOAD_URL: string;
    PUBLIC_MACOS_X64_DOWNLOAD_URL: string;
    PUBLIC_WINDOWS_X64_DOWNLOAD_URL: string;
  }
}
