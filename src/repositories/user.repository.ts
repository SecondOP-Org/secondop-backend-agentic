import { QueryResultRow } from 'pg';
import { dbQuery } from './db';

export const findPatientProfileByUserId = async (userId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    `SELECT u.id, u.email, u.phone, u.user_type, u.is_verified,
           p.first_name, p.last_name, p.date_of_birth, p.gender,
           p.address, p.city, p.state, p.country, p.postal_code,
           p.emergency_contact_name, p.emergency_contact_phone,
           p.avatar_url, p.blood_type, p.allergies, p.current_medications,
           p.medical_conditions
    FROM users u
    JOIN patients p ON u.id = p.user_id
    WHERE u.id = $1`,
    [userId]
  );
  return result.rows;
};

export const findDoctorProfileByUserId = async (userId: string): Promise<QueryResultRow[]> => {
  const result = await dbQuery(
    `SELECT u.id, u.email, u.phone, u.user_type, u.is_verified,
           d.first_name, d.last_name, d.specialty, d.sub_specialties,
           d.license_number, d.years_of_experience, d.hospital_affiliation,
           d.education, d.certifications, d.languages, d.bio,
           d.consultation_fee, d.rating, d.review_count, d.avatar_url,
           d.country, d.city, d.is_verified as doctor_verified, d.is_available,
           d.registration_council, d.npi, d.verification_status, d.verification_reason,
           d.verified_at
    FROM users u
    JOIN doctors d ON u.id = d.user_id
    WHERE u.id = $1`,
    [userId]
  );
  return result.rows;
};

export interface UpdateUserContactInput {
  userId: string;
  email?: string;
  phone?: string;
}

export const updateUserContact = async (input: UpdateUserContactInput): Promise<void> => {
  await dbQuery(
    'UPDATE users SET email = COALESCE($1, email), phone = COALESCE($2, phone), updated_at = CURRENT_TIMESTAMP WHERE id = $3',
    [input.email, input.phone, input.userId]
  );
};

export const updateUserPhone = async (userId: string, phone: string): Promise<void> => {
  await dbQuery(
    'UPDATE users SET phone = COALESCE($1, phone), updated_at = CURRENT_TIMESTAMP WHERE id = $2',
    [phone, userId]
  );
};

export interface UpdatePatientProfileInput {
  userId: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  gender?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  allergies?: string;
  currentMedications?: string;
  medicalConditions?: string;
}

export const updatePatientProfile = async (input: UpdatePatientProfileInput): Promise<void> => {
  await dbQuery(
    `UPDATE patients SET 
     first_name = COALESCE($1, first_name),
     last_name = COALESCE($2, last_name),
     date_of_birth = COALESCE($3, date_of_birth),
     gender = COALESCE($4, gender),
     address = COALESCE($5, address),
     city = COALESCE($6, city),
     state = COALESCE($7, state),
     country = COALESCE($8, country),
     postal_code = COALESCE($9, postal_code),
     emergency_contact_name = COALESCE($10, emergency_contact_name),
     emergency_contact_phone = COALESCE($11, emergency_contact_phone),
     allergies = COALESCE($12, allergies),
     current_medications = COALESCE($13, current_medications),
     medical_conditions = COALESCE($14, medical_conditions),
     updated_at = CURRENT_TIMESTAMP
     WHERE user_id = $15`,
    [
      input.firstName,
      input.lastName,
      input.dateOfBirth,
      input.gender,
      input.address,
      input.city,
      input.state,
      input.country,
      input.postalCode,
      input.emergencyContactName,
      input.emergencyContactPhone,
      input.allergies,
      input.currentMedications,
      input.medicalConditions,
      input.userId,
    ]
  );
};

export interface UpdateDoctorProfileInput {
  userId: string;
  firstName?: string;
  lastName?: string;
  specialty?: string;
  bio?: string;
  consultationFee?: number;
  languages?: string;
  subSpecialties?: string;
  licenseNumber?: string;
  yearsOfExperience?: number;
  hospitalAffiliation?: string;
  education?: string;
  certifications?: string;
  city?: string;
  country?: string;
}

export const updateDoctorProfile = async (input: UpdateDoctorProfileInput): Promise<void> => {
  await dbQuery(
    `UPDATE doctors SET 
     first_name = COALESCE($1, first_name),
     last_name = COALESCE($2, last_name),
     specialty = COALESCE($3, specialty),
     bio = COALESCE($4, bio),
     consultation_fee = COALESCE($5, consultation_fee),
     languages = COALESCE($6, languages),
     sub_specialties = COALESCE($7, sub_specialties),
     license_number = COALESCE($8, license_number),
     years_of_experience = COALESCE($9, years_of_experience),
     hospital_affiliation = COALESCE($10, hospital_affiliation),
     education = COALESCE($11, education),
     certifications = COALESCE($12, certifications),
     city = COALESCE($13, city),
     country = COALESCE($14, country),
     updated_at = CURRENT_TIMESTAMP
     WHERE user_id = $15`,
    [
      input.firstName,
      input.lastName,
      input.specialty,
      input.bio,
      input.consultationFee,
      input.languages,
      input.subSpecialties,
      input.licenseNumber,
      input.yearsOfExperience,
      input.hospitalAffiliation,
      input.education,
      input.certifications,
      input.city,
      input.country,
      input.userId,
    ]
  );
};

export const updatePatientAvatar = async (userId: string, avatarUrl: string | null): Promise<void> => {
  await dbQuery(
    'UPDATE patients SET avatar_url = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2',
    [avatarUrl, userId]
  );
};

export const updateDoctorAvatar = async (userId: string, avatarUrl: string | null): Promise<void> => {
  await dbQuery(
    'UPDATE doctors SET avatar_url = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2',
    [avatarUrl, userId]
  );
};

export const getPatientAvatarUrl = async (userId: string): Promise<string | null> => {
  const result = await dbQuery<{ avatar_url: string | null }>(
    'SELECT avatar_url FROM patients WHERE user_id = $1 LIMIT 1',
    [userId]
  );
  return result.rows[0]?.avatar_url ?? null;
};

export const getDoctorAvatarUrl = async (userId: string): Promise<string | null> => {
  const result = await dbQuery<{ avatar_url: string | null }>(
    'SELECT avatar_url FROM doctors WHERE user_id = $1 LIMIT 1',
    [userId]
  );
  return result.rows[0]?.avatar_url ?? null;
};
