-- SEC-169: Doctor credential fields + verification status machine.
-- Phase 1: manual-review gate. Nullable organization_id prepares Phase 2 (no orgs table yet).

ALTER TABLE doctors
  ADD COLUMN IF NOT EXISTS registration_council VARCHAR(255),
  ADD COLUMN IF NOT EXISTS npi VARCHAR(50),
  ADD COLUMN IF NOT EXISTS verification_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS verification_reason TEXT,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS organization_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'doctors_verification_status_check'
  ) THEN
    ALTER TABLE doctors
      ADD CONSTRAINT doctors_verification_status_check
      CHECK (verification_status IN ('pending', 'verified', 'rejected'));
  END IF;
END $$;

-- Existing/demo doctors already listed publicly keep working after the gate lands.
UPDATE doctors
SET verification_status = 'verified',
    verified_at = COALESCE(verified_at, CURRENT_TIMESTAMP)
WHERE is_verified = true
  AND verification_status = 'pending';

UPDATE doctors
SET verification_status = 'verified',
    is_verified = true,
    verified_at = COALESCE(verified_at, CURRENT_TIMESTAMP)
WHERE license_number IN ('MD123456', 'MD789012', 'MD345678')
  AND verification_status <> 'verified';

CREATE TABLE IF NOT EXISTS doctor_verification_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  actor_user_id UUID NOT NULL REFERENCES users(id),
  from_status VARCHAR(20),
  to_status VARCHAR(20) NOT NULL CHECK (to_status IN ('pending', 'verified', 'rejected')),
  reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_doctors_verification_status
  ON doctors(verification_status);

CREATE INDEX IF NOT EXISTS idx_doctor_verification_events_doctor_created
  ON doctor_verification_events(doctor_id, created_at DESC);
