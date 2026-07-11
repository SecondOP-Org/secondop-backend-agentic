import { Router } from 'express';
import {
  createCase,
  updateCaseIntake,
  queueCaseAnalysis,
  getCaseAnalysis,
  getCaseAnalysisTrace,
  submitCase,
  getCases,
  getCaseById,
  updateCase,
  deleteCase,
  assignDoctorToCase,
  getDoctorCases,
  updateCaseStatus,
  sendDoctorOpinion,
} from '../controllers/case.controller';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate);

// Patient routes
router.post('/', authorize('patient'), createCase);
router.get('/my-cases', authorize('patient'), getCases);
router.put('/:caseId/intake', authorize('patient'), updateCaseIntake);
router.post('/:caseId/analysis', authorize('patient'), queueCaseAnalysis);
router.get('/:caseId/analysis', getCaseAnalysis);
router.get('/:caseId/analysis/trace', getCaseAnalysisTrace);
router.post('/:caseId/submit', authorize('patient'), submitCase);

// Doctor routes
router.get('/doctor/cases', authorize('doctor'), getDoctorCases);
router.post('/:caseId/assign', authorize('patient'), assignDoctorToCase);
router.put('/:caseId/status', authorize('doctor'), updateCaseStatus);
router.post('/:caseId/doctor-opinion', authorize('doctor'), sendDoctorOpinion);

// Common routes
router.get('/:caseId', getCaseById);
router.put('/:caseId', updateCase);
router.delete('/:caseId', deleteCase);

export default router;
