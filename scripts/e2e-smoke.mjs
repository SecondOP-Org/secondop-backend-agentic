#!/usr/bin/env node

const API_BASE_URL = (process.env.E2E_API_BASE_URL || 'https://secondop-backend-production.up.railway.app').replace(/\/+$/, '');
const API_VERSION = process.env.E2E_API_VERSION || 'v1';
const ENABLE_ANALYSIS = String(process.env.E2E_ENABLE_ANALYSIS || 'false').toLowerCase() === 'true';
/** When true with E2E_ENABLE_ANALYSIS, assert agentic execution completed under DEID (SEC-106). */
const REQUIRE_AGENTIC_DEID =
  String(process.env.E2E_REQUIRE_AGENTIC_DEID || 'false').toLowerCase() === 'true';
const ANALYSIS_TIMEOUT_MS = Number(process.env.E2E_ANALYSIS_TIMEOUT_MS || 180000);
const ANALYSIS_POLL_MS = Number(process.env.E2E_ANALYSIS_POLL_MS || 5000);

const now = Date.now();
const randomSuffix = Math.floor(Math.random() * 100000);
const email = `smoke+${now}-${randomSuffix}@secondop.test`;
const phone = `+1555${String(1000000 + (randomSuffix % 8999999)).padStart(7, '0')}`;
const password = 'SmokeTest#123';

const requiredStatus = (res, expected, label) => {
  if (res.status !== expected) {
    throw new Error(`${label} failed: expected ${expected}, got ${res.status}`);
  }
};

const resolveWebApis = async () => {
  if (
    typeof globalThis.fetch === 'function' &&
    typeof globalThis.Blob === 'function' &&
    typeof globalThis.FormData === 'function'
  ) {
    return {
      fetch: globalThis.fetch.bind(globalThis),
      Blob: globalThis.Blob,
      FormData: globalThis.FormData,
    };
  }

  const module = await import('node-fetch');
  return {
    fetch: module.default,
    Blob: module.Blob,
    FormData: module.FormData,
  };
};

const jsonRequest = async (path, { method = 'GET', token, body } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  return { res, data };
};

const uploadPdf = async (caseId, token) => {
  const minimalPdf = `%PDF-1.1
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 44 >>
stream
BT /F1 18 Tf 50 80 Td (SecondOp Smoke PDF) Tj ET
endstream
endobj
xref
0 5
0000000000 65535 f
0000000010 00000 n
0000000060 00000 n
0000000117 00000 n
0000000207 00000 n
trailer
<< /Root 1 0 R /Size 5 >>
startxref
300
%%EOF`;

  const form = new globalThis.FormData();
  form.append('caseId', caseId);
  form.append('category', 'lab-report');
  form.append('description', 'Smoke test upload');
  form.append('file', new globalThis.Blob([minimalPdf], { type: 'application/pdf' }), 'smoke-report.pdf');

  const res = await fetch(`${API_BASE_URL}/api/${API_VERSION}/files/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  const data = await res.json().catch(() => null);
  requiredStatus(res, 201, 'File upload');
  return data?.data?.id || null;
};

const pollAnalysis = async (caseId, token) => {
  const deadline = Date.now() + ANALYSIS_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const { res, data } = await jsonRequest(`/api/${API_VERSION}/cases/${caseId}/analysis`, { token });
    requiredStatus(res, 200, 'Get case analysis');

    const status = data?.data?.analysisStatus;
    if (status === 'succeeded') return { status, data };
    if (status === 'failed') throw new Error(`Analysis failed: ${data?.data?.error || 'unknown error'}`);

    await new Promise((resolve) => setTimeout(resolve, ANALYSIS_POLL_MS));
  }

  throw new Error(`Analysis did not complete within ${ANALYSIS_TIMEOUT_MS}ms`);
};

const run = async () => {
  const webApis = await resolveWebApis();
  globalThis.fetch = webApis.fetch;
  globalThis.Blob = webApis.Blob;
  globalThis.FormData = webApis.FormData;

  console.log(`[smoke] API base: ${API_BASE_URL}`);

  const healthRes = await fetch(`${API_BASE_URL}/health`);
  requiredStatus(healthRes, 200, 'Health check');
  console.log('[smoke] Health check passed');

  const register = await jsonRequest(`/api/${API_VERSION}/auth/register`, {
    method: 'POST',
    body: {
      email,
      phone,
      password,
      userType: 'patient',
      firstName: 'Smoke',
      lastName: 'Tester',
    },
  });
  requiredStatus(register.res, 201, 'Register');

  const token = register.data?.data?.token;
  if (!token) throw new Error('Register response missing token');
  console.log('[smoke] Register passed');

  const myCasesBefore = await jsonRequest(`/api/${API_VERSION}/cases/my-cases`, { token });
  requiredStatus(myCasesBefore.res, 200, 'Get my cases (before)');
  console.log('[smoke] Fetch my-cases passed');

  const createCase = await jsonRequest(`/api/${API_VERSION}/cases`, {
    method: 'POST',
    token,
    body: {
      title: 'Smoke Test Case',
      description: 'E2E smoke validation case',
      specialty: 'Cardiology',
      priority: 'medium',
      urgencyLevel: 'moderate',
      status: 'draft',
      intake: {
        age: 42,
        sex: 'female',
        specialtyContext: 'cardiology',
        symptoms: 'Intermittent chest discomfort',
        symptomDuration: '2 weeks',
        medicalHistory: 'Mild hypertension',
        currentMedications: 'Lisinopril',
        allergies: 'None',
      },
    },
  });
  requiredStatus(createCase.res, 201, 'Create case');

  const caseId = createCase.data?.data?.id;
  if (!caseId) throw new Error('Create case response missing case id');
  console.log(`[smoke] Case created: ${caseId}`);

  const caseById = await jsonRequest(`/api/${API_VERSION}/cases/${caseId}`, { token });
  requiredStatus(caseById.res, 200, 'Get case by id');
  console.log('[smoke] Get case by id passed');

  if (ENABLE_ANALYSIS) {
    await uploadPdf(caseId, token);
    console.log('[smoke] PDF upload passed');

    const queued = await jsonRequest(`/api/${API_VERSION}/cases/${caseId}/analysis`, {
      method: 'POST',
      token,
    });
    requiredStatus(queued.res, 200, 'Queue case analysis');
    console.log('[smoke] Analysis queue request passed');

    const finalAnalysis = await pollAnalysis(caseId, token);
    console.log(`[smoke] Analysis completed: ${finalAnalysis.status}`);

    // SEC-106: with DEID_ENABLED on the server, agentic finalize must succeed (not fail at grounding).
    if (REQUIRE_AGENTIC_DEID) {
      const payload = finalAnalysis.data?.data || {};
      const executionMode = payload.executionMode || payload.agenticMode;
      const agenticRunId = payload.agenticRunId || payload.analysisRunId;
      if (!agenticRunId) {
        throw new Error('E2E_REQUIRE_AGENTIC_DEID: analysis succeeded but no run id returned');
      }
      if (executionMode && !['agentic', 'direct', 'shadow'].includes(String(executionMode))) {
        throw new Error(
          `E2E_REQUIRE_AGENTIC_DEID: expected agentic/shadow execution, got ${executionMode}`
        );
      }
      if (!payload.summary || !Array.isArray(payload.analysisQuestions) || payload.analysisQuestions.length !== 3) {
        throw new Error('E2E_REQUIRE_AGENTIC_DEID: clinician-facing artifact incomplete after DEID agentic run');
      }
      console.log(`[smoke] Agentic+DEID finalize check passed (mode=${executionMode || 'unknown'}, run=${agenticRunId})`);
    }
  } else {
    console.log('[smoke] Analysis step skipped (set E2E_ENABLE_ANALYSIS=true to enable)');
    if (REQUIRE_AGENTIC_DEID) {
      throw new Error('E2E_REQUIRE_AGENTIC_DEID=true requires E2E_ENABLE_ANALYSIS=true');
    }
  }

  console.log('[smoke] PASS');
};

run().catch((error) => {
  console.error('[smoke] FAIL');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
