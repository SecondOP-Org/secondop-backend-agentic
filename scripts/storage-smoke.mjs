#!/usr/bin/env node

const API_BASE_URL = (process.env.E2E_API_BASE_URL || 'https://secondop-backend-production.up.railway.app').replace(/\/+$/, '');
const API_VERSION = process.env.E2E_API_VERSION || 'v1';
const DOCTOR_EMAIL = process.env.STORAGE_SMOKE_DOCTOR_EMAIL || 'dr.smith@secondop.com';
const DOCTOR_PASSWORD = process.env.STORAGE_SMOKE_DOCTOR_PASSWORD || 'password123';
const ANALYSIS_TIMEOUT_MS = Number(process.env.E2E_ANALYSIS_TIMEOUT_MS || 180000);
const ANALYSIS_POLL_MS = Number(process.env.E2E_ANALYSIS_POLL_MS || 5000);

const now = Date.now();
const randomSuffix = Math.floor(Math.random() * 100000);
const email = `storage-smoke+${now}-${randomSuffix}@secondop.test`;
const phone = `+1555${String(1000000 + (randomSuffix % 8999999)).padStart(7, '0')}`;
const password = 'SmokeTest#123';

const results = {
  upload: false,
  downloadBeforeRedeploy: false,
  analysis: false,
  submit: false,
  assign: false,
  doctorDownloadBeforeRedeploy: false,
  downloadAfterRedeploy: false,
  doctorDownloadAfterRedeploy: false,
};

let caseId = '';
let fileId = '';
let patientToken = '';
let doctorToken = '';

const requiredStatus = (res, expected, label) => {
  if (res.status !== expected) {
    throw new Error(`${label} failed: expected ${expected}, got ${res.status}`);
  }
};

const jsonRequest = async (path, { method = 'GET', token, body } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE_URL}/api/${API_VERSION}${path}`, {
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
BT /F1 18 Tf 50 80 Td (SecondOp Storage Smoke) Tj ET
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

const uploadPdf = async () => {
  const form = new FormData();
  form.append('caseId', caseId);
  form.append('category', 'lab-report');
  form.append('description', 'Storage smoke test upload');
  form.append('file', new Blob([minimalPdf], { type: 'application/pdf' }), 'storage-smoke.pdf');

  const res = await fetch(`${API_BASE_URL}/api/${API_VERSION}/files/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${patientToken}` },
    body: form,
  });

  const data = await res.json().catch(() => null);
  requiredStatus(res, 201, 'File upload');
  fileId = data?.data?.id;
  if (!fileId) throw new Error('Upload response missing file id');
  results.upload = true;
};

const downloadFile = async (token, label) => {
  const res = await fetch(`${API_BASE_URL}/api/${API_VERSION}/files/${fileId}/download`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  requiredStatus(res, 200, label);
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength < 100) {
    throw new Error(`${label}: downloaded file too small (${bytes.byteLength} bytes)`);
  }
  const text = new TextDecoder().decode(bytes);
  if (!text.includes('PDF')) {
    throw new Error(`${label}: response does not look like a PDF`);
  }
};

const pollAnalysis = async () => {
  const deadline = Date.now() + ANALYSIS_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { res, data } = await jsonRequest(`/cases/${caseId}/analysis`, { token: patientToken });
    requiredStatus(res, 200, 'Get case analysis');
    const status = data?.data?.analysisStatus;
    if (status === 'succeeded') {
      results.analysis = true;
      return;
    }
    if (status === 'failed') {
      throw new Error(`Analysis failed: ${data?.data?.error || 'unknown error'}`);
    }
    await new Promise((resolve) => setTimeout(resolve, ANALYSIS_POLL_MS));
  }
  throw new Error(`Analysis did not complete within ${ANALYSIS_TIMEOUT_MS}ms`);
};

const findDoctorSmithId = async () => {
  const res = await fetch(`${API_BASE_URL}/api/${API_VERSION}/doctors/search?query=Smith`);
  const data = await res.json();
  requiredStatus(res, 200, 'Search doctors');
  const doctors = data?.data || [];
  const smith = doctors.find((doctor) =>
    `${doctor.first_name || ''} ${doctor.last_name || ''}`.toLowerCase().includes('john smith')
  );
  if (!smith?.id) {
    throw new Error('Could not find Dr. John Smith in doctor search results');
  }
  return smith.id;
};

const setupCase = async () => {
  const register = await jsonRequest('/auth/register', {
    method: 'POST',
    body: {
      email,
      phone,
      password,
      userType: 'patient',
      firstName: 'Storage',
      lastName: 'Smoke',
    },
  });
  requiredStatus(register.res, 201, 'Register');
  patientToken = register.data?.data?.token;
  if (!patientToken) throw new Error('Register response missing token');

  const createCase = await jsonRequest('/cases', {
    method: 'POST',
    token: patientToken,
    body: {
      title: 'Storage Smoke Test Case',
      description: 'Validates durable Railway volume uploads',
      specialty: 'Cardiology',
      priority: 'medium',
      urgencyLevel: 'moderate',
      status: 'draft',
      intake: {
        age: 55,
        sex: 'male',
        specialtyContext: 'cardiology',
        symptoms: 'Chest discomfort on exertion',
        symptomDuration: '1 week',
        medicalHistory: 'Hypertension',
        currentMedications: 'Amlodipine',
        allergies: 'None',
      },
    },
  });
  requiredStatus(createCase.res, 201, 'Create case');
  caseId = createCase.data?.data?.id;
  if (!caseId) throw new Error('Create case response missing case id');

  await uploadPdf();
  await downloadFile(patientToken, 'Patient download before redeploy');
  results.downloadBeforeRedeploy = true;

  const queued = await jsonRequest(`/cases/${caseId}/analysis`, {
    method: 'POST',
    token: patientToken,
  });
  requiredStatus(queued.res, 200, 'Queue case analysis');
  await pollAnalysis();

  const submit = await jsonRequest(`/cases/${caseId}/submit`, {
    method: 'POST',
    token: patientToken,
    body: {
      specialistQuestions: [
        { id: 'q1', question: 'What is your assessment of the cardiac risk?' },
        { id: 'q2', question: 'Are further tests needed?' },
        { id: 'q3', question: 'What follow-up do you recommend?' },
      ],
      shareAiAnalysisWithSpecialists: true,
    },
  });
  requiredStatus(submit.res, 200, 'Submit case');
  results.submit = true;

  const doctorId = await findDoctorSmithId();
  const assign = await jsonRequest(`/cases/${caseId}/assign`, {
    method: 'POST',
    token: patientToken,
    body: { doctorId },
  });
  requiredStatus(assign.res, 200, 'Assign doctor');
  results.assign = true;

  const doctorLogin = await jsonRequest('/auth/login', {
    method: 'POST',
    body: { email: DOCTOR_EMAIL, password: DOCTOR_PASSWORD },
  });
  requiredStatus(doctorLogin.res, 200, 'Doctor login');
  doctorToken = doctorLogin.data?.data?.token;
  if (!doctorToken) throw new Error('Doctor login response missing token');

  await downloadFile(doctorToken, 'Doctor download before redeploy');
  results.doctorDownloadBeforeRedeploy = true;
};

const run = async () => {
  console.log(`[storage-smoke] API base: ${API_BASE_URL}`);
  const healthRes = await fetch(`${API_BASE_URL}/health`);
  requiredStatus(healthRes, 200, 'Health check');

  await setupCase();
  console.log('[storage-smoke] Pre-redeploy checks passed');
  console.log(JSON.stringify({ caseId, fileId, email }, null, 2));
  console.log(JSON.stringify(results, null, 2));
};

run().catch((error) => {
  console.error('[storage-smoke] FAIL');
  console.error(error instanceof Error ? error.message : String(error));
  console.error(JSON.stringify({ caseId, fileId, results }, null, 2));
  process.exit(1);
});
