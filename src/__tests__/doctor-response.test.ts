import {
  getDoctorResponseDraft,
  previewDoctorOpinion,
  saveDoctorResponseDraftHandler,
  sendDoctorOpinion,
} from '../controllers/case.controller';
import { query } from '../database/connection';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { generateDoctorOpinionPdf, generateDoctorOpinionPdfBuffer } from '../services/doctorOpinionPdf.service';
import {
  formatKeyImageLabel,
  getDoctorResponse,
  resolveSpecialistQuestions,
  saveDoctorResponseDraft,
  validateDoctorResponseForSend,
} from '../services/doctorResponse.service';

jest.mock('../database/connection', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

jest.mock('../services/doctorOpinionPdf.service', () => ({
  generateDoctorOpinionPdf: jest.fn(),
  generateDoctorOpinionPdfBuffer: jest.fn(),
  buildDoctorOpinionOriginalName: jest.fn((caseNumber: string) => `SecondOp-Opinion-${caseNumber}.pdf`),
}));

const mockedQuery = query as jest.MockedFunction<typeof query>;
const mockedGenerateDoctorOpinionPdf = generateDoctorOpinionPdf as jest.MockedFunction<
  typeof generateDoctorOpinionPdf
>;
const mockedGenerateDoctorOpinionPdfBuffer = generateDoctorOpinionPdfBuffer as jest.MockedFunction<
  typeof generateDoctorOpinionPdfBuffer
>;

const createMockResponse = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res;
};

const createDoctorRequest = (body: any = {}, params: any = {}): AuthRequest =>
  ({
    body,
    params,
    query: {},
    user: {
      id: 'user-doctor-1',
      email: 'doctor@example.com',
      type: 'doctor',
    },
    app: {
      get: jest.fn().mockReturnValue({
        to: jest.fn().mockReturnValue({ emit: jest.fn() }),
      }),
    },
  }) as unknown as AuthRequest;

describe('doctor response workflow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGenerateDoctorOpinionPdf.mockResolvedValue({
      filePath: '/tmp/opinion.pdf',
      filename: 'opinion.pdf',
      originalName: 'SecondOp-Opinion-SO1234.pdf',
      size: 1024,
    });
    mockedGenerateDoctorOpinionPdfBuffer.mockResolvedValue(Buffer.from('%PDF-1.4 test'));
  });

  describe('resolveSpecialistQuestions', () => {
    it('prefers patient specialist_questions over AI artifact questions', () => {
      const resolved = resolveSpecialistQuestions({
        specialist_questions: ['Patient question'],
        analysis_artifact: {
          structured_summary: {
            chief_concern: 'Concern',
            key_report_findings: 'Finding',
            red_flags_to_discuss: 'Flag',
            follow_up_discussion_points: 'Follow up',
            limitations_caveats: 'Limits',
          },
          questionnaire: {
            specialist_questions: [{ id: 'ai-q-1', question: 'AI question' }],
          },
          confidence_score: 0.8,
          uncertainty_flags: [],
          disclaimer: 'Disclaimer',
          model: 'gpt-4.1-mini',
          evidence_refs: [],
          token_usage: null,
        },
        share_ai_analysis_with_specialists: true,
      });

      expect(resolved).toEqual([{ id: 'sq-1', question: 'Patient question' }]);
    });

    it('does not expose artifact questions when AI sharing is disabled', () => {
      const resolved = resolveSpecialistQuestions({
        specialist_questions: [],
        analysis_questions: ['AI fallback question'],
        analysis_artifact: {
          structured_summary: {
            chief_concern: 'Concern',
            key_report_findings: 'Finding',
            red_flags_to_discuss: 'Flag',
            follow_up_discussion_points: 'Follow up',
            limitations_caveats: 'Limits',
          },
          questionnaire: {
            specialist_questions: [{ id: 'ai-q-1', question: 'AI question' }],
          },
          confidence_score: 0.8,
          uncertainty_flags: [],
          disclaimer: 'Disclaimer',
          model: 'gpt-4.1-mini',
          evidence_refs: [],
          token_usage: null,
        },
        share_ai_analysis_with_specialists: false,
      });

      expect(resolved).toEqual([]);
    });
  });

  describe('draft save/load', () => {
    it('loads resolved questions and saved draft for assigned doctor', async () => {
      mockedQuery
        .mockResolvedValueOnce({ rows: [{ id: 'case-1' }] } as any)
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'case-1',
              specialist_questions: ['What is the diagnosis?'],
              analysis_questions: null,
              analysis_artifact: null,
              analysis_summary: null,
              analysis_model: null,
              share_ai_analysis_with_specialists: true,
              response_draft: {
                questionAnswers: [
                  {
                    questionId: 'sq-1',
                    question: 'What is the diagnosis?',
                    answer: 'Draft answer',
                  },
                ],
                summary: 'Draft summary',
              },
            },
          ],
        } as any);

      const req = createDoctorRequest({}, { caseId: 'case-1' });
      const res = createMockResponse();
      const next = jest.fn();

      await getDoctorResponseDraft(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({
        status: 'success',
        data: {
          resolvedQuestions: [{ id: 'sq-1', question: 'What is the diagnosis?' }],
          draft: {
            questionAnswers: [
              {
                questionId: 'sq-1',
                question: 'What is the diagnosis?',
                answer: 'Draft answer',
              },
            ],
            summary: 'Draft summary',
          },
        },
      });
    });

    it('merges partial draft updates on save', async () => {
      mockedQuery
        .mockResolvedValueOnce({ rows: [{ id: 'doctor-1' }] } as any)
        .mockResolvedValueOnce({
          rows: [
            {
              response_draft: {
                questionAnswers: [
                  {
                    questionId: 'sq-1',
                    question: 'Question 1',
                    answer: 'Existing answer',
                  },
                ],
                summary: 'Existing summary',
              },
            },
          ],
        } as any)
        .mockResolvedValueOnce({ rows: [] } as any);

      const draft = await saveDoctorResponseDraft('case-1', 'user-doctor-1', {
        questionAnswers: [
          {
            questionId: 'sq-2',
            question: 'Question 2',
            answer: 'New answer',
          },
        ],
        summary: '',
      });

      expect(draft.questionAnswers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ questionId: 'sq-1', answer: 'Existing answer' }),
          expect.objectContaining({ questionId: 'sq-2', answer: 'New answer' }),
        ])
      );
      expect(draft.summary).toBe('Existing summary');
    });

    it('preserves keyImages when PUT omits them', async () => {
      mockedQuery
        .mockResolvedValueOnce({ rows: [{ id: 'doctor-1' }] } as any)
        .mockResolvedValueOnce({
          rows: [
            {
              response_draft: {
                questionAnswers: [],
                summary: 'Existing summary',
                keyImages: [
                  {
                    id: 'ki-1',
                    filename: 'key.png',
                    mimeType: 'image/png',
                    seriesUid: '1.2.3',
                    seriesDescription: 'Axial',
                    instanceNumber: 12,
                    capturedAt: '2026-07-14T00:00:00.000Z',
                  },
                ],
              },
            },
          ],
        } as any)
        .mockResolvedValueOnce({ rows: [] } as any);

      const draft = await saveDoctorResponseDraft('case-1', 'user-doctor-1', {
        questionAnswers: [],
        summary: 'Updated summary',
      });

      expect(draft.summary).toBe('Updated summary');
      expect(draft.keyImages).toEqual([
        expect.objectContaining({ id: 'ki-1', seriesUid: '1.2.3', instanceNumber: 12 }),
      ]);
    });

    it('saves draft through controller handler', async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [{ id: 'case-1' }] } as any);

      const serviceSpy = jest.spyOn(
        await import('../services/doctorResponse.service'),
        'saveDoctorResponseDraft'
      );
      serviceSpy.mockResolvedValueOnce({
        questionAnswers: [],
        summary: 'Saved summary',
      });

      const req = createDoctorRequest({ summary: 'Saved summary' }, { caseId: 'case-1' });
      const res = createMockResponse();
      const next = jest.fn();

      await saveDoctorResponseDraftHandler(req, res, next);

      expect(serviceSpy).toHaveBeenCalledWith('case-1', 'user-doctor-1', { summary: 'Saved summary' });
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'success',
          data: { draft: { questionAnswers: [], summary: 'Saved summary' } },
        })
      );

      serviceSpy.mockRestore();
    });
  });

  describe('send validation', () => {
    it('rejects incomplete structured answers on send', async () => {
      mockedQuery
        .mockResolvedValueOnce({ rows: [{ id: 'case-1' }] } as any)
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'case-1',
              title: 'Cardiology case',
              case_number: 'SO-1001',
              submitted_date: '2026-01-01',
              specialist_questions: ['Question 1', 'Question 2'],
              analysis_questions: null,
              analysis_artifact: null,
              analysis_summary: null,
              analysis_model: null,
              share_ai_analysis_with_specialists: true,
              analysis_status: 'succeeded',
              patient_user_id: 'user-patient-1',
              patient_first_name: 'Pat',
              patient_last_name: 'Smith',
              doctor_first_name: 'Doc',
              doctor_last_name: 'Jones',
              doctor_specialty: 'Cardiology',
            },
          ],
        } as any);

      const req = createDoctorRequest(
        {
          questionAnswers: [
            {
              questionId: 'sq-1',
              question: 'Question 1',
              answer: 'Answer 1',
            },
          ],
          summary: 'Overall summary',
          attestationAccepted: true,
        },
        { caseId: 'case-1' }
      );
      const res = createMockResponse();
      const next = jest.fn();

      await sendDoctorOpinion(req, res, next);

      expect(mockedGenerateDoctorOpinionPdf).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.any(AppError));
      expect((next.mock.calls[0][0] as AppError).message).toMatch(/Answer required|All patient questions/);
    });

    it('validates all resolved questions must be answered', () => {
      expect(() =>
        validateDoctorResponseForSend(
          [
            { id: 'sq-1', question: 'Question 1' },
            { id: 'sq-2', question: 'Question 2' },
          ],
          {
            questionAnswers: [
              { questionId: 'sq-1', question: 'Question 1', answer: 'Answer 1' },
            ],
            summary: 'Summary',
            attestationAccepted: true as const,
          }
        )
      ).toThrow(AppError);
    });
  });

  describe('key image labels', () => {
    it('formats series and slice identifiers for PDF captions', () => {
      expect(
        formatKeyImageLabel({
          id: 'ki-1',
          filename: 'key.png',
          mimeType: 'image/png',
          seriesUid: '1.2.3',
          seriesDescription: 'Axial T2',
          instanceNumber: 42,
          capturedAt: '2026-07-14T00:00:00.000Z',
        })
      ).toBe('Series: Axial T2; slice: 42');
    });
  });

  describe('PDF preview', () => {
    it('returns a valid PDF buffer inline', async () => {
      mockedQuery
        .mockResolvedValueOnce({ rows: [{ id: 'case-1' }] } as any)
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'case-1',
              title: 'Cardiology case',
              case_number: 'SO-1001',
              submitted_date: '2026-01-01',
              specialist_questions: ['Question 1'],
              analysis_questions: null,
              analysis_artifact: null,
              analysis_summary: null,
              analysis_model: null,
              share_ai_analysis_with_specialists: true,
              analysis_status: 'succeeded',
              patient_first_name: 'Pat',
              patient_last_name: 'Smith',
              doctor_first_name: 'Doc',
              doctor_last_name: 'Jones',
              doctor_specialty: 'Cardiology',
            },
          ],
        } as any);

      const req = createDoctorRequest(
        {
          questionAnswers: [
            {
              questionId: 'sq-1',
              question: 'Question 1',
              answer: 'Answer 1',
            },
          ],
          summary: 'Overall summary',
        },
        { caseId: 'case-1' }
      );
      const res = createMockResponse();
      const next = jest.fn();

      await previewDoctorOpinion(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(mockedGenerateDoctorOpinionPdfBuffer).toHaveBeenCalled();
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringContaining('inline; filename=')
      );
      expect(res.send).toHaveBeenCalledWith(Buffer.from('%PDF-1.4 test'));
    });
  });

  describe('getDoctorResponse service', () => {
    it('returns null draft when none is saved', async () => {
      mockedQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'case-1',
            specialist_questions: ['Question 1'],
            analysis_questions: null,
            analysis_artifact: null,
            analysis_summary: null,
            analysis_model: null,
            share_ai_analysis_with_specialists: true,
            response_draft: null,
          },
        ],
      } as any);

      const result = await getDoctorResponse('case-1', 'user-doctor-1');

      expect(result.resolvedQuestions).toEqual([{ id: 'sq-1', question: 'Question 1' }]);
      expect(result.draft).toBeNull();
    });
  });

  describe('clearDoctorResponseDraft', () => {
    it('clears draft after successful send', async () => {
      mockedQuery
        .mockResolvedValueOnce({ rows: [{ id: 'case-1' }] } as any)
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'case-1',
              title: 'Cardiology case',
              case_number: 'SO-1001',
              submitted_date: '2026-01-01',
              specialist_questions: ['Question 1'],
              analysis_questions: null,
              analysis_artifact: null,
              analysis_summary: null,
              analysis_model: null,
              share_ai_analysis_with_specialists: true,
              analysis_status: 'succeeded',
              patient_user_id: 'user-patient-1',
              patient_first_name: 'Pat',
              patient_last_name: 'Smith',
              doctor_first_name: 'Doc',
              doctor_last_name: 'Jones',
              doctor_specialty: 'Cardiology',
            },
          ],
        } as any)
        .mockResolvedValueOnce({ rows: [{ id: 'message-1' }] } as any)
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [{ id: 'doctor-1' }] } as any)
        .mockResolvedValueOnce({ rows: [] } as any);

      const req = createDoctorRequest(
        {
          questionAnswers: [
            {
              questionId: 'sq-1',
              question: 'Question 1',
              answer: 'Answer 1',
            },
          ],
          summary: 'Overall summary',
          attestationAccepted: true,
        },
        { caseId: 'case-1' }
      );
      const res = createMockResponse();
      const next = jest.fn();

      await sendDoctorOpinion(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(mockedGenerateDoctorOpinionPdf).toHaveBeenCalledWith(
        expect.objectContaining({
          questionAnswers: [
            expect.objectContaining({ questionId: 'sq-1', answer: 'Answer 1' }),
          ],
          summary: 'Overall summary',
        })
      );
      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining('response_draft = NULL'),
        ['case-1', 'doctor-1']
      );
    });
  });
});
