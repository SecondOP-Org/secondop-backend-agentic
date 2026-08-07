import { Router } from 'express';
import {
  createCase,
  updateCaseIntake,
  queueCaseAnalysis,
  getCaseAnalysis,
  getCaseAnalysisTrace,
  streamCaseAnalysisProgress,
  submitCase,
  getCases,
  getCaseById,
  updateCase,
  deleteCase,
  assignDoctorToCase,
  getDoctorCases,
  getDoctorDashboardStats,
  removeDoctorCaseAssignment,
  updateCaseStatus,
  sendDoctorOpinion,
  getDoctorResponseDraft,
  saveDoctorResponseDraftHandler,
  generatePatientFacingAiDraftHandler,
  streamPatientFacingAiDraftHandler,
  uploadDoctorKeyImageHandler,
  previewDoctorOpinion,
  startCaseReviewHandler,
} from '../controllers/case.controller';
import {
  createCaseInternalNoteHandler,
  getCaseInternalNotesHandler,
} from '../controllers/caseTeam.controller';
import { downloadImagingStudy } from '../controllers/file.controller';
import { authenticate, authorize } from '../middleware/auth';
import { authorizeCommandCenterOperator } from '../middleware/commandCenterAuth';
import { keyImageUpload } from '../middleware/upload';

const router = Router();

router.use(authenticate);

// Patient routes
router.post('/', authorize('patient'), createCase);
router.get('/my-cases', authorize('patient'), getCases);
router.put('/:caseId/intake', authorize('patient'), updateCaseIntake);
router.post('/:caseId/analysis', authorize('patient'), queueCaseAnalysis);
router.get('/:caseId/analysis', getCaseAnalysis);
router.get('/:caseId/analysis/progress', streamCaseAnalysisProgress);
// Ops-only: full run internals / shadow artifacts (SEC-110).
router.get('/:caseId/analysis/trace', authorizeCommandCenterOperator, getCaseAnalysisTrace);
router.post('/:caseId/submit', authorize('patient'), submitCase);

// Doctor routes
router.get('/doctor/cases', authorize('doctor'), getDoctorCases);
router.get('/doctor/stats', authorize('doctor'), getDoctorDashboardStats);
router.delete('/:caseId/doctor-assignment', authorize('doctor'), removeDoctorCaseAssignment);
router.post('/:caseId/assign', authorize('patient'), assignDoctorToCase);
router.put('/:caseId/status', authorize('doctor'), updateCaseStatus);
router.post('/:caseId/start-review', authorize('doctor'), startCaseReviewHandler);
router.get('/:caseId/internal-notes', authorize('doctor'), getCaseInternalNotesHandler);
router.post('/:caseId/internal-notes', authorize('doctor'), createCaseInternalNoteHandler);
router.get('/:caseId/doctor-response', authorize('doctor'), getDoctorResponseDraft);
router.put('/:caseId/doctor-response', authorize('doctor'), saveDoctorResponseDraftHandler);
router.post(
  '/:caseId/doctor-response/ai-draft',
  authorize('doctor'),
  generatePatientFacingAiDraftHandler
);
router.post(
  '/:caseId/doctor-response/ai-draft/stream',
  authorize('doctor'),
  streamPatientFacingAiDraftHandler
);
router.post(
  '/:caseId/doctor-response/key-images',
  authorize('doctor'),
  keyImageUpload.single('file'),
  uploadDoctorKeyImageHandler
);
router.post('/:caseId/doctor-opinion/preview', authorize('doctor'), previewDoctorOpinion);
router.post('/:caseId/doctor-opinion', authorize('doctor'), sendDoctorOpinion);

// Imaging study egress — assigned doctor / owning patient / operator (SEC-126)
router.get('/:caseId/studies/:studyUid/download', downloadImagingStudy);

// Common routes
router.get('/:caseId', getCaseById);
router.put('/:caseId', updateCase);
router.delete('/:caseId', authorize('patient'), deleteCase);

export default router;
