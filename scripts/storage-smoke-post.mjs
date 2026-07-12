#!/usr/bin/env node

const API_BASE_URL = (process.env.E2E_API_BASE_URL || 'https://secondop-backend-production.up.railway.app').replace(/\/+$/, '');
const API_VERSION = process.env.E2E_API_VERSION || 'v1';
const FILE_ID = process.env.STORAGE_SMOKE_FILE_ID;
const DOCTOR_EMAIL = process.env.STORAGE_SMOKE_DOCTOR_EMAIL || 'dr.smith@secondop.com';
const DOCTOR_PASSWORD = process.env.STORAGE_SMOKE_DOCTOR_PASSWORD || 'password123';
const PATIENT_EMAIL = process.env.STORAGE_SMOKE_PATIENT_EMAIL;
const PATIENT_PASSWORD = process.env.STORAGE_SMOKE_PATIENT_PASSWORD || 'SmokeTest#123';

if (!FILE_ID || !PATIENT_EMAIL) {
  console.error('STORAGE_SMOKE_FILE_ID and STORAGE_SMOKE_PATIENT_EMAIL are required');
  process.exit(1);
}

const requiredStatus = (res, expected, label) => {
  if (res.status !== expected) {
    throw new Error(`${label} failed: expected ${expected}, got ${res.status}`);
  }
};

const login = async (email, password, label) => {
  const res = await fetch(`${API_BASE_URL}/api/${API_VERSION}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  requiredStatus(res, 200, label);
  const token = data?.data?.token;
  if (!token) throw new Error(`${label} missing token`);
  return token;
};

const downloadFile = async (token, label) => {
  const res = await fetch(`${API_BASE_URL}/api/${API_VERSION}/files/${FILE_ID}/download`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  requiredStatus(res, 200, label);
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength < 100) {
    throw new Error(`${label}: downloaded file too small (${bytes.byteLength} bytes)`);
  }
};

const run = async () => {
  const patientToken = await login(PATIENT_EMAIL, PATIENT_PASSWORD, 'Patient login');
  const doctorToken = await login(DOCTOR_EMAIL, DOCTOR_PASSWORD, 'Doctor login');
  await downloadFile(patientToken, 'Patient download after redeploy');
  await downloadFile(doctorToken, 'Doctor download after redeploy');
  console.log('[storage-smoke-post] PASS');
};

run().catch((error) => {
  console.error('[storage-smoke-post] FAIL');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
