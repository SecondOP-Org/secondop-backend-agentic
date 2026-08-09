import { AnalysisEvalFixtures } from '../analysisEvalFixtures';
import { CaseIntakeData } from '../../services/analysis.service';
import { ExtractedReport } from '../../services/reportExtraction.service';
import { GoldCase } from './schema';

export const mapGoldCaseToFixtures = (goldCase: GoldCase): AnalysisEvalFixtures => {
  const intake: CaseIntakeData = {
    age: goldCase.inputs.patientContext.age,
    sex: goldCase.inputs.patientContext.sex,
    specialtyContext: goldCase.specialty,
    symptoms: goldCase.inputs.patientContext.presenting,
    symptomDuration: 'as documented in gold case',
    medicalHistory: goldCase.inputs.reports.map((r) => r.fileName).join('; ') || 'none documented',
    currentMedications: 'none documented',
    allergies: 'none documented',
  };

  const reports: ExtractedReport[] = goldCase.inputs.reports.map((report, index) => ({
    fileId: `gold-${goldCase.id}-${index}`,
    fileName: report.fileName,
    text: report.text,
    charCount: report.text.length,
    extractionMethod: 'cache',
    extractionQuality: 'high',
    ocrConfidence: null,
    reused: false,
  }));

  return { intake, reports };
};

/** Flatten gold reference into text for score-only self-consistency checks. */
export const flattenGoldReferenceAsOutput = (goldCase: GoldCase): string =>
  [
    ...goldCase.reference.keyFindings,
    ...goldCase.reference.recommendedNextSteps,
    ...goldCase.reference.expectedQuestions,
    ...goldCase.inputs.specialistQuestions,
  ].join('\n');
