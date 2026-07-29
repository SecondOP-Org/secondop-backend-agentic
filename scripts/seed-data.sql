-- SecondOp development seed data
-- Safe to run multiple times.

BEGIN;

INSERT INTO subscription_plans (name, description, price, billing_period, max_questions, max_doctors, features, is_active)
SELECT *
FROM (
  VALUES
    ('Basic', 'Perfect for occasional consultations', 29.99, 'monthly', 5, 1, '{"features": ["5 questions per month", "Email support", "Basic health tracking", "Document upload"]}'::jsonb, true),
    ('Standard', 'Great for regular health monitoring', 49.99, 'monthly', 15, 2, '{"features": ["15 questions per month", "Priority email support", "Advanced health tracking", "Unlimited document upload", "Video consultations"]}'::jsonb, true),
    ('Premium', 'Comprehensive healthcare management', 99.99, 'monthly', -1, 3, '{"features": ["Unlimited questions", "24/7 priority support", "Advanced health tracking", "Unlimited document upload", "Video consultations", "Dedicated health advisor"]}'::jsonb, true),
    ('Annual Basic', 'Basic plan with annual billing', 299.99, 'yearly', 5, 1, '{"features": ["5 questions per month", "Email support", "Basic health tracking", "Document upload", "2 months free"]}'::jsonb, true)
) AS plans(name, description, price, billing_period, max_questions, max_doctors, features, is_active)
WHERE NOT EXISTS (
  SELECT 1
  FROM subscription_plans existing
  WHERE existing.name = plans.name
);

INSERT INTO users (email, phone, password_hash, user_type, is_verified, is_active)
VALUES
  ('dr.smith@secondop.com', '+1234567890', '$2a$10$HZhiAofIrWgvSqU1K3zyleIKzWYJyY1saS1YSAp6JxJUYQincV1u.', 'doctor', true, true),
  ('dr.johnson@secondop.com', '+1234567891', '$2a$10$HZhiAofIrWgvSqU1K3zyleIKzWYJyY1saS1YSAp6JxJUYQincV1u.', 'doctor', true, true),
  ('dr.williams@secondop.com', '+1234567892', '$2a$10$HZhiAofIrWgvSqU1K3zyleIKzWYJyY1saS1YSAp6JxJUYQincV1u.', 'doctor', true, true),
  ('patient@example.com', '+1234567899', '$2a$10$HZhiAofIrWgvSqU1K3zyleIKzWYJyY1saS1YSAp6JxJUYQincV1u.', 'patient', true, true)
ON CONFLICT (email) DO UPDATE
SET phone = EXCLUDED.phone,
    password_hash = EXCLUDED.password_hash,
    user_type = EXCLUDED.user_type,
    is_verified = EXCLUDED.is_verified,
    is_active = EXCLUDED.is_active;

DO $$
DECLARE
  smith_user_id UUID;
  johnson_user_id UUID;
  williams_user_id UUID;
  patient_user_id UUID;
  patient_profile_id UUID;
BEGIN
  SELECT id INTO smith_user_id FROM users WHERE email = 'dr.smith@secondop.com';
  SELECT id INTO johnson_user_id FROM users WHERE email = 'dr.johnson@secondop.com';
  SELECT id INTO williams_user_id FROM users WHERE email = 'dr.williams@secondop.com';
  SELECT id INTO patient_user_id FROM users WHERE email = 'patient@example.com';

  INSERT INTO doctors (user_id, first_name, last_name, specialty, sub_specialties, license_number, years_of_experience, hospital_affiliation, education, certifications, languages, bio, consultation_fee, rating, review_count, country, city, is_verified, is_available, registration_council, verification_status, verified_at)
  VALUES
    (smith_user_id, 'John', 'Smith', 'Cardiology', ARRAY['Interventional Cardiology', 'Heart Failure'], 'MD123456', 15, 'Mayo Clinic', ARRAY['MD - Harvard Medical School', 'Residency - Johns Hopkins'], ARRAY['Board Certified Cardiologist', 'FACC'], ARRAY['English', 'Spanish'], 'Dr. Smith is a board-certified cardiologist with over 15 years of experience in treating complex cardiac conditions.', 150.00, 4.8, 127, 'United States', 'Rochester, MN', true, true, 'Minnesota Board of Medical Practice', 'verified', CURRENT_TIMESTAMP),
    (johnson_user_id, 'Emily', 'Johnson', 'Oncology', ARRAY['Breast Cancer', 'Lung Cancer'], 'MD789012', 12, 'MD Anderson Cancer Center', ARRAY['MD - Stanford University', 'Fellowship - Memorial Sloan Kettering'], ARRAY['Board Certified Oncologist', 'ASCO Member'], ARRAY['English', 'French'], 'Dr. Johnson specializes in personalized cancer treatment with a focus on breast and lung cancers.', 175.00, 4.9, 203, 'United States', 'Houston, TX', true, true, 'Texas Medical Board', 'verified', CURRENT_TIMESTAMP),
    (williams_user_id, 'Michael', 'Williams', 'Neurology', ARRAY['Stroke', 'Epilepsy', 'Movement Disorders'], 'MD345678', 20, 'Cleveland Clinic', ARRAY['MD - Yale School of Medicine', 'Residency - Massachusetts General Hospital'], ARRAY['Board Certified Neurologist', 'FAAN'], ARRAY['English', 'German', 'Italian'], 'Dr. Williams is a renowned neurologist with expertise in stroke management and movement disorders.', 200.00, 4.7, 156, 'United States', 'Cleveland, OH', true, true, 'State Medical Board of Ohio', 'verified', CURRENT_TIMESTAMP)
  ON CONFLICT (user_id) DO UPDATE
  SET first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      specialty = EXCLUDED.specialty,
      sub_specialties = EXCLUDED.sub_specialties,
      license_number = EXCLUDED.license_number,
      years_of_experience = EXCLUDED.years_of_experience,
      hospital_affiliation = EXCLUDED.hospital_affiliation,
      education = EXCLUDED.education,
      certifications = EXCLUDED.certifications,
      languages = EXCLUDED.languages,
      bio = EXCLUDED.bio,
      consultation_fee = EXCLUDED.consultation_fee,
      rating = EXCLUDED.rating,
      review_count = EXCLUDED.review_count,
      country = EXCLUDED.country,
      city = EXCLUDED.city,
      is_verified = EXCLUDED.is_verified,
      is_available = EXCLUDED.is_available,
      registration_council = EXCLUDED.registration_council,
      verification_status = 'verified',
      verified_at = COALESCE(doctors.verified_at, CURRENT_TIMESTAMP),
      updated_at = CURRENT_TIMESTAMP;

  INSERT INTO patients (user_id, first_name, last_name, date_of_birth, gender, address, city, state, country, postal_code, blood_type)
  VALUES (patient_user_id, 'Jane', 'Doe', '1985-06-15', 'female', '123 Main St', 'New York', 'NY', 'United States', '10001', 'O+')
  ON CONFLICT (user_id) DO UPDATE
  SET first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      date_of_birth = EXCLUDED.date_of_birth,
      gender = EXCLUDED.gender,
      address = EXCLUDED.address,
      city = EXCLUDED.city,
      state = EXCLUDED.state,
      country = EXCLUDED.country,
      postal_code = EXCLUDED.postal_code,
      blood_type = EXCLUDED.blood_type,
      updated_at = CURRENT_TIMESTAMP;

  SELECT id INTO patient_profile_id FROM patients WHERE user_id = patient_user_id;

  IF NOT EXISTS (
    SELECT 1 FROM cases WHERE patient_id = patient_profile_id AND title = 'Chest Pain Evaluation'
  ) THEN
    INSERT INTO cases (case_number, patient_id, title, description, specialty, priority, urgency_level, status)
    VALUES (
      'SO-SEED-' || EXTRACT(EPOCH FROM NOW())::BIGINT,
      patient_profile_id,
      'Chest Pain Evaluation',
      'Experiencing intermittent chest pain for the past week. Looking for a second opinion on recent cardiac tests.',
      'Cardiology',
      'high',
      'urgent',
      'pending'
    );
  END IF;

  INSERT INTO case_assignments (case_id, doctor_id, status)
  SELECT c.id, d.id, 'assigned'
  FROM cases c
  JOIN patients p ON p.id = c.patient_id
  JOIN users patient_user ON patient_user.id = p.user_id
  JOIN doctors d ON d.user_id = smith_user_id
  WHERE patient_user.email = 'patient@example.com'
    AND NOT EXISTS (
      SELECT 1 FROM case_assignments existing WHERE existing.case_id = c.id
    )
  ON CONFLICT (case_id, doctor_id) DO NOTHING;
END $$;

COMMIT;

SELECT 'Seed data inserted successfully!' AS message;
SELECT 'Subscription Plans: ' || COUNT(*) AS summary FROM subscription_plans;
SELECT 'Doctors: ' || COUNT(*) AS summary FROM doctors;
SELECT 'Patients: ' || COUNT(*) AS summary FROM patients;
SELECT 'Cases: ' || COUNT(*) AS summary FROM cases;
