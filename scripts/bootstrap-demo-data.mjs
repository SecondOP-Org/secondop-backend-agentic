#!/usr/bin/env node

import pg from 'pg';

const { Pool } = pg;

const DEMO_PASSWORD_HASH = '$2a$10$HZhiAofIrWgvSqU1K3zyleIKzWYJyY1saS1YSAp6JxJUYQincV1u.';

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' } : false,
});

const run = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO users (email, phone, password_hash, user_type, is_verified, is_active)
       VALUES
         ('dr.smith@secondop.com', '+1234567890', $1, 'doctor', true, true),
         ('dr.johnson@secondop.com', '+1234567891', $1, 'doctor', true, true),
         ('dr.williams@secondop.com', '+1234567892', $1, 'doctor', true, true),
         ('patient@example.com', '+1234567899', $1, 'patient', true, true)
       ON CONFLICT (email) DO UPDATE
       SET phone = EXCLUDED.phone,
           password_hash = EXCLUDED.password_hash,
           user_type = EXCLUDED.user_type,
           is_verified = EXCLUDED.is_verified,
           is_active = EXCLUDED.is_active`,
      [DEMO_PASSWORD_HASH]
    );

    await client.query(
      `INSERT INTO doctors (
         user_id, first_name, last_name, specialty, sub_specialties, license_number,
         years_of_experience, hospital_affiliation, education, certifications, languages,
         bio, consultation_fee, rating, review_count, country, city, is_verified, is_available
       )
       SELECT u.id, profile.first_name, profile.last_name, profile.specialty, profile.sub_specialties,
              profile.license_number, profile.years_of_experience, profile.hospital_affiliation,
              profile.education, profile.certifications, profile.languages, profile.bio,
              profile.consultation_fee, profile.rating, profile.review_count, profile.country,
              profile.city, true, true
       FROM users u
       JOIN (
         VALUES
           ('dr.smith@secondop.com', 'John', 'Smith', 'Cardiology', ARRAY['Interventional Cardiology', 'Heart Failure']::text[], 'MD123456', 15, 'Mayo Clinic', ARRAY['MD - Harvard Medical School', 'Residency - Johns Hopkins']::text[], ARRAY['Board Certified Cardiologist', 'FACC']::text[], ARRAY['English', 'Spanish']::text[], 'Dr. Smith is a board-certified cardiologist with over 15 years of experience in treating complex cardiac conditions.', 150.00::numeric, 4.8::numeric, 127, 'United States', 'Rochester, MN'),
           ('dr.johnson@secondop.com', 'Emily', 'Johnson', 'Oncology', ARRAY['Breast Cancer', 'Lung Cancer']::text[], 'MD789012', 12, 'MD Anderson Cancer Center', ARRAY['MD - Stanford University', 'Fellowship - Memorial Sloan Kettering']::text[], ARRAY['Board Certified Oncologist', 'ASCO Member']::text[], ARRAY['English', 'French']::text[], 'Dr. Johnson specializes in personalized cancer treatment with a focus on breast and lung cancers.', 175.00::numeric, 4.9::numeric, 203, 'United States', 'Houston, TX'),
           ('dr.williams@secondop.com', 'Michael', 'Williams', 'Neurology', ARRAY['Stroke', 'Epilepsy', 'Movement Disorders']::text[], 'MD345678', 20, 'Cleveland Clinic', ARRAY['MD - Yale School of Medicine', 'Residency - Massachusetts General Hospital']::text[], ARRAY['Board Certified Neurologist', 'FAAN']::text[], ARRAY['English', 'German', 'Italian']::text[], 'Dr. Williams is a renowned neurologist with expertise in stroke management and movement disorders.', 200.00::numeric, 4.7::numeric, 156, 'United States', 'Cleveland, OH')
       ) AS profile(email, first_name, last_name, specialty, sub_specialties, license_number, years_of_experience, hospital_affiliation, education, certifications, languages, bio, consultation_fee, rating, review_count, country, city)
         ON profile.email = u.email
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
           updated_at = CURRENT_TIMESTAMP`
    );

    await client.query(
      `INSERT INTO patients (user_id, first_name, last_name, date_of_birth, gender, address, city, state, country, postal_code, blood_type)
       SELECT u.id, 'Jane', 'Doe', '1985-06-15', 'female', '123 Main St', 'New York', 'NY', 'United States', '10001', 'O+'
       FROM users u
       WHERE u.email = 'patient@example.com'
       ON CONFLICT (user_id) DO UPDATE
       SET first_name = EXCLUDED.first_name,
           last_name = EXCLUDED.last_name,
           updated_at = CURRENT_TIMESTAMP`
    );

    const assignments = await client.query(
      `INSERT INTO case_assignments (case_id, doctor_id, status)
       SELECT c.id, d.id, 'assigned'
       FROM cases c
       JOIN patients p ON p.id = c.patient_id
       JOIN users patient_user ON patient_user.id = p.user_id
       JOIN doctors d ON d.user_id = (SELECT id FROM users WHERE email = 'dr.smith@secondop.com' LIMIT 1)
       WHERE patient_user.email = 'patient@example.com'
         AND NOT EXISTS (
           SELECT 1 FROM case_assignments existing WHERE existing.case_id = c.id
         )
       ON CONFLICT (case_id, doctor_id) DO NOTHING
       RETURNING case_id`
    );

    await client.query('COMMIT');

    const doctorCount = await pool.query(
      `SELECT COUNT(*)::int AS count FROM doctors d JOIN users u ON u.id = d.user_id WHERE u.email LIKE 'dr.%@secondop.com'`
    );
    const smithCases = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM case_assignments ca
       JOIN doctors d ON d.id = ca.doctor_id
       JOIN users u ON u.id = d.user_id
       WHERE u.email = 'dr.smith@secondop.com'`
    );

    console.log(
      JSON.stringify({
        assignmentsCreated: assignments.rowCount ?? 0,
        demoDoctorProfiles: doctorCount.rows[0]?.count ?? 0,
        smithAssignedCases: smithCases.rows[0]?.count ?? 0,
      })
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
