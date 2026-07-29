-- SEC-173: Hybrid §1 — partner organizations + membership (owner/member).
-- Distinct from practices (017 clinical team model). Solo doctors keep organization_id NULL.

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  contact_first_name VARCHAR(100) NOT NULL,
  contact_last_name VARCHAR(100) NOT NULL,
  contact_email VARCHAR(255) NOT NULL,
  contact_phone VARCHAR(50),
  address_line1 VARCHAR(255) NOT NULL,
  address_line2 VARCHAR(255),
  city VARCHAR(100) NOT NULL,
  state VARCHAR(100),
  postal_code VARCHAR(30),
  country VARCHAR(100) NOT NULL,
  logo_url TEXT,
  verification_status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending', 'verified', 'rejected')),
  verification_reason TEXT,
  verified_at TIMESTAMP,
  verified_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_organizations_verification_status
  ON organizations(verification_status);

CREATE INDEX IF NOT EXISTS idx_organizations_contact_email
  ON organizations(contact_email);

CREATE TABLE IF NOT EXISTS organization_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('owner', 'member')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_organization_members_user_id
  ON organization_members(user_id);

CREATE INDEX IF NOT EXISTS idx_organization_members_organization_id
  ON organization_members(organization_id);

-- Expand users.user_type to include organization contact accounts.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_user_type_check;
ALTER TABLE users
  ADD CONSTRAINT users_user_type_check
  CHECK (user_type IN ('patient', 'doctor', 'organization'));

-- Wire nullable doctors.organization_id (added in 029) to organizations.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'doctors_organization_id_fkey'
  ) THEN
    ALTER TABLE doctors
      ADD CONSTRAINT doctors_organization_id_fkey
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_doctors_organization_id
  ON doctors(organization_id);
