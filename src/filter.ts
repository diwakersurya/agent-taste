const PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}/, // OpenAI / Anthropic style keys
  /\bgh[pousr]_[A-Za-z0-9]{20,}/, // GitHub tokens
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/, // Slack tokens
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./, // JWT
  /\b[A-Za-z0-9+/_-]{40,}={0,2}(?![A-Za-z0-9])/, // long base64-ish blobs
  /\b[a-f0-9]{32,}\b/i, // long hex
  /[\w.+-]+@[\w-]+\.[\w.-]+/, // email
  /\d{8,}/, // account / phone / id numbers
  /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/, // IBAN
  /\b(?:\d[ -]?){13,19}\b/, // card numbers
];

export const isSensitive = (t: string) => PATTERNS.some((r) => r.test(t));
