-- Allow hashed email/password-reset tokens (sha256 hex) in otp_verifications.
-- Phone OTPs remain short; password_reset / email_verify use 64-char digests.
ALTER TABLE otp_verifications
  ALTER COLUMN otp_code TYPE VARCHAR(128);
