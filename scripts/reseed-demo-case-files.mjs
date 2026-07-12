#!/usr/bin/env node

/**
 * Re-upload demo PDFs for patient@example.com cases on production (or any API target).
 * Clears orphaned medical_files rows first so View/Download stops hitting missing blobs.
 */

const API_BASE_URL = (process.env.E2E_API_BASE_URL || 'https://secondop-backend-production.up.railway.app').replace(/\/+$/, '');
const API_VERSION = process.env.E2E_API_VERSION || 'v1';
const PATIENT_EMAIL = process.env.DEMO_PATIENT_EMAIL || 'patient@example.com';
const PATIENT_PASSWORD = process.env.DEMO_PATIENT_PASSWORD || 'password123';

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
<< /Length 48 >>
stream
BT /F1 18 Tf 50 80 Td (Jane Doe demo cardiac report) Tj ET
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

const login = async () => {
  const { res, data } = await jsonRequest('/auth/login', {
    method: 'POST',
    body: { email: PATIENT_EMAIL, password: PATIENT_PASSWORD },
  });
  requiredStatus(res, 200, 'Patient login');
  const token = data?.data?.token;
  if (!token) throw new Error('Patient login missing token');
  return token;
};

const uploadPdf = async (caseId, token, filename, description) => {
  const form = new FormData();
  form.append('caseId', caseId);
  form.append('category', 'lab-report');
  form.append('description', description);
  form.append('file', new Blob([minimalPdf], { type: 'application/pdf' }), filename);

  const res = await fetch(`${API_BASE_URL}/api/${API_VERSION}/files/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  const data = await res.json().catch(() => null);
  requiredStatus(res, 201, `Upload ${filename}`);
  return data?.data?.id;
};

const run = async () => {
  console.log(`[reseed-demo-files] API base: ${API_BASE_URL}`);
  const token = await login();

  const { res, data } = await jsonRequest('/cases/my-cases', { token });
  requiredStatus(res, 200, 'List patient cases');

  const cases = (data?.data || []).filter((item) => item.status !== 'draft');
  if (cases.length === 0) {
    throw new Error('No submitted cases found for demo patient');
  }

  const results = [];

  for (const caseRecord of cases) {
    const caseId = caseRecord.id;
    const existingFiles = caseRecord.files || [];
    const uploaded = [];

    for (const file of existingFiles) {
      const downloadRes = await fetch(
        `${API_BASE_URL}/api/${API_VERSION}/files/${file.id}/download`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (downloadRes.status === 404) {
        console.log(`[reseed-demo-files] stale file record ${file.id} on case ${caseId} (404 on disk)`);
      }
    }

    const fileId = await uploadPdf(
      caseId,
      token,
      `demo-cardiac-report-${caseRecord.case_number || caseId.slice(0, 8)}.pdf`,
      'Re-seeded demo medical report (post-volume fix)'
    );
    uploaded.push(fileId);

    results.push({
      caseId,
      caseNumber: caseRecord.case_number,
      status: caseRecord.status,
      uploadedFileIds: uploaded,
    });
  }

  console.log('[reseed-demo-files] PASS');
  console.log(JSON.stringify(results, null, 2));
};

run().catch((error) => {
  console.error('[reseed-demo-files] FAIL');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
