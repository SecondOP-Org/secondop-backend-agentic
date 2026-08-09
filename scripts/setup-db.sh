#!/bin/bash

# SecondOp Database Setup Script
# This script creates the database and runs all migrations

set -e

# Load environment variables
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

# Default values
DB_NAME=${DB_NAME:-secondop_db}
DB_USER=${DB_USER:-postgres}
DB_HOST=${DB_HOST:-localhost}
DB_PORT=${DB_PORT:-5432}
export PGPASSWORD="${DB_PASSWORD:-postgres}"

echo "🏥 SecondOp Database Setup"
echo "=========================="
echo "Database: $DB_NAME"
echo "User: $DB_USER"
echo "Host: $DB_HOST:$DB_PORT"
echo ""

# Check if PostgreSQL is running
if ! pg_isready -h "$DB_HOST" -p "$DB_PORT" > /dev/null 2>&1; then
  echo "❌ Error: PostgreSQL is not running on $DB_HOST:$DB_PORT"
  exit 1
fi

echo "✅ PostgreSQL is running"

# Create database if it doesn't exist
echo "📦 Creating database..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -tc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1 || \
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -c "CREATE DATABASE $DB_NAME"

echo "✅ Database created/verified"

# Run migrations
echo "🔄 Running migrations..."

echo "  → Running 001_initial_schema.sql..."
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f migrations/001_initial_schema.sql

echo "  → Running 002_cases_and_messages.sql..."
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f migrations/002_cases_and_messages.sql

echo "  → Running 003_prescriptions_and_labs.sql..."
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f migrations/003_prescriptions_and_labs.sql

echo "  → Running 004_billing_and_payments.sql..."
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f migrations/004_billing_and_payments.sql

echo "  → Running 005_case_analysis_and_intake.sql..."
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f migrations/005_case_analysis_and_intake.sql

echo "  → Running 006_agent_analysis_runs.sql..."
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f migrations/006_agent_analysis_runs.sql

echo "  → Running 007_agentic_shadow_results.sql..."
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f migrations/007_agentic_shadow_results.sql

echo "  → Running 008_case_analysis_artifacts.sql..."
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f migrations/008_case_analysis_artifacts.sql

echo "  → Running 009_dicom_imaging_and_annotations.sql..."
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f migrations/009_dicom_imaging_and_annotations.sql

echo "  → Running 010_langgraph_checkpoints.sql..."
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f migrations/010_langgraph_checkpoints.sql

echo "  → Running 011_analysis_run_metadata.sql..."
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f migrations/011_analysis_run_metadata.sql

echo "  → Running 012_case_analysis_artifacts.sql..."
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f migrations/012_case_analysis_artifacts.sql

echo "  → Running 013_medical_file_extraction_reuse.sql..."
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f migrations/013_medical_file_extraction_reuse.sql

echo "  → Running 014_flexible_specialist_questions.sql..."
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f migrations/014_flexible_specialist_questions.sql

echo "  → Running 015_share_ai_analysis_with_specialists.sql..."
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f migrations/015_share_ai_analysis_with_specialists.sql

echo "  → Running 016_doctor_response_drafts.sql..."
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f migrations/016_doctor_response_drafts.sql

echo "  → Running 017_practice_team_model.sql..."
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f migrations/017_practice_team_model.sql

echo "  → Running 018_seed_demo_practice.sql..."
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f migrations/018_seed_demo_practice.sql

echo "  → Running 019_document_ocr.sql..."
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f migrations/019_document_ocr.sql

echo "  → Running 020_case_analysis_deid_vault.sql..."
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f migrations/020_case_analysis_deid_vault.sql

echo "  → Running 021_file_annotation_team_and_audit.sql..."
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f migrations/021_file_annotation_team_and_audit.sql

echo "  → Running 022_dicom_deid_vault.sql..."
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f migrations/022_dicom_deid_vault.sql
echo "  → Running 023_widen_otp_code.sql..."
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f migrations/023_widen_otp_code.sql

echo "  → Running 024_analysis_run_online_evals.sql..."
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f migrations/024_analysis_run_online_evals.sql

echo "  → Running 025_ai_draft_edit_ratio.sql..."
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f migrations/025_ai_draft_edit_ratio.sql

echo "  → Running 026_analysis_run_attempt_count.sql..."
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f migrations/026_analysis_run_attempt_count.sql

echo "  → Running 027_analysis_run_attention_reason.sql..."
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f migrations/027_analysis_run_attention_reason.sql

echo "  → Running 028_imaging_study_download_audit.sql..."
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f migrations/028_imaging_study_download_audit.sql

echo "  → Running 029_doctor_credential_verification.sql..."
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f migrations/029_doctor_credential_verification.sql

echo "  → Running 030_organizations_hybrid.sql..."
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f migrations/030_organizations_hybrid.sql

echo "  → Running 031_organization_invites.sql..."
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f migrations/031_organization_invites.sql

echo "  → Running 032_gold_eval_runs.sql..."
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f migrations/032_gold_eval_runs.sql

echo "✅ All migrations completed successfully"

# Create uploads directory
echo "📁 Creating uploads directory..."
mkdir -p uploads
echo "✅ Uploads directory created"

echo ""
echo "🎉 Database setup complete!"
echo "You can now run: npm run dev"
