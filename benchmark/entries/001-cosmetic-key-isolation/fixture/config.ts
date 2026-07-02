function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

// Bulk and critical email were split onto two API keys so the two traffic
// streams are distinguishable in the provider dashboard. Both keys are issued
// under the same provider account (account id "acct_7fb2").
export const BULK_KEY = requireEnv("MAIL_BULK_KEY");
export const CRITICAL_KEY = requireEnv("MAIL_CRITICAL_KEY");
export const PROVIDER_ACCOUNT = "acct_7fb2";
