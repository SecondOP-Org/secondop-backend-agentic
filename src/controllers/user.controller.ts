import { Response, NextFunction } from 'express';
import { query } from '../database/connection';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';

export const getProfile = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const userType = req.user!.type;

    let profileQuery = '';
    if (userType === 'patient') {
      profileQuery = `
        SELECT u.id, u.email, u.phone, u.user_type, u.is_verified,
               p.first_name, p.last_name, p.date_of_birth, p.gender,
               p.address, p.city, p.state, p.country, p.postal_code,
               p.emergency_contact_name, p.emergency_contact_phone,
               p.avatar_url, p.blood_type, p.allergies, p.current_medications,
               p.medical_conditions
        FROM users u
        JOIN patients p ON u.id = p.user_id
        WHERE u.id = $1
      `;
    } else {
      profileQuery = `
        SELECT u.id, u.email, u.phone, u.user_type, u.is_verified,
               d.first_name, d.last_name, d.specialty, d.sub_specialties,
               d.license_number, d.years_of_experience, d.hospital_affiliation,
               d.education, d.certifications, d.languages, d.bio,
               d.consultation_fee, d.rating, d.review_count, d.avatar_url,
               d.country, d.city, d.is_verified as doctor_verified, d.is_available,
               d.registration_council, d.npi, d.verification_status, d.verification_reason,
               d.verified_at
        FROM users u
        JOIN doctors d ON u.id = d.user_id
        WHERE u.id = $1
      `;
    }

    const result = await query(profileQuery, [userId]);

    if (result.rows.length === 0) {
      throw new AppError('Profile not found', 404);
    }

    res.json({
      status: 'success',
      data: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
};

export const updateProfile = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const userType = req.user!.type;
    const updates = req.body;

    // Update user table if email or phone is being updated
    if (updates.email || updates.phone) {
      await query(
        'UPDATE users SET email = COALESCE($1, email), phone = COALESCE($2, phone), updated_at = CURRENT_TIMESTAMP WHERE id = $3',
        [updates.email, updates.phone, userId]
      );
    }

    // Update profile table based on user type
    if (userType === 'patient') {
      const {
        firstName,
        lastName,
        dateOfBirth,
        gender,
        address,
        city,
        state,
        country,
        postalCode,
        emergencyContactName,
        emergencyContactPhone,
        allergies,
        currentMedications,
        medicalConditions,
      } = updates;
      await query(
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
          firstName,
          lastName,
          dateOfBirth,
          gender,
          address,
          city,
          state,
          country,
          postalCode,
          emergencyContactName,
          emergencyContactPhone,
          allergies,
          currentMedications,
          medicalConditions,
          userId,
        ]
      );
    } else {
      const {
        firstName,
        lastName,
        specialty,
        bio,
        consultationFee,
        languages,
        subSpecialties,
        licenseNumber,
        yearsOfExperience,
        hospitalAffiliation,
        education,
        certifications,
        city,
        country,
        phone,
      } = updates;

      if (phone) {
        await query(
          'UPDATE users SET phone = COALESCE($1, phone), updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [phone, userId]
        );
      }

      await query(
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
          firstName,
          lastName,
          specialty,
          bio,
          consultationFee,
          languages,
          subSpecialties,
          licenseNumber,
          yearsOfExperience,
          hospitalAffiliation,
          education,
          certifications,
          city,
          country,
          userId,
        ]
      );
    }

    res.json({
      status: 'success',
      message: 'Profile updated successfully',
    });
  } catch (error) {
    next(error);
  }
};

export const uploadAvatar = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.file) {
      throw new AppError('No file uploaded', 400);
    }

    const userId = req.user!.id;
    const userType = req.user!.type;
    const avatarUrl = `/uploads/${req.file.filename}`;

    const table = userType === 'patient' ? 'patients' : 'doctors';
    await query(
      `UPDATE ${table} SET avatar_url = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2`,
      [avatarUrl, userId]
    );

    res.json({
      status: 'success',
      message: 'Avatar uploaded successfully',
      data: { avatarUrl },
    });
  } catch (error) {
    next(error);
  }
};

export const getPatientProfile = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return getProfile(req, res, next);
  } catch (error) {
    next(error);
  }
};

export const updatePatientProfile = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return updateProfile(req, res, next);
  } catch (error) {
    next(error);
  }
};

export const getDoctorProfile = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return getProfile(req, res, next);
  } catch (error) {
    next(error);
  }
};

export const updateDoctorProfile = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    return updateProfile(req, res, next);
  } catch (error) {
    next(error);
  }
};

