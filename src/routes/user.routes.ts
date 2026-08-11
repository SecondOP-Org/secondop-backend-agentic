import { Router } from 'express';
import {
  getProfile,
  updateProfile,
  uploadAvatar,
  deleteAvatar,
  getPatientProfile,
  updatePatientProfile,
  getDoctorProfile,
  updateDoctorProfile,
} from '../controllers/user.controller';
import { authenticate, authorize } from '../middleware/auth';
import { upload } from '../middleware/upload';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Common user routes
router.get('/profile', getProfile);
router.put('/profile', updateProfile);
router.post('/avatar', upload.single('avatar'), uploadAvatar);
router.delete('/avatar', deleteAvatar);

// Patient-specific routes
router.get('/patient/profile', authorize('patient'), getPatientProfile);
router.put('/patient/profile', authorize('patient'), updatePatientProfile);

// Doctor-specific routes
router.get('/doctor/profile', authorize('doctor'), getDoctorProfile);
router.put('/doctor/profile', authorize('doctor'), updateDoctorProfile);

export default router;

