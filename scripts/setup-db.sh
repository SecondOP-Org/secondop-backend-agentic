#!/bin/bash

# SecondOp Database Setup Script
# This script creates the database and runs all migrations

set -e

# Load environment variables
if [ -f .env ]; then
  export $(cat .env | grep -v '^#' | xargs)
fi

# Default values
DB_NAME=${DB_NAME:-secondop_db}
DB_USER=${DB_USER:-postgres}
DB_HOST=${DB_HOST:-localhost}
DB_PORT=${DB_PORT:-5432}

echo "🏥 SecondOp Database Setup"
echo "=========================="
echo "Database: $DB_NAME"
echo "User: $DB_USER"
echo "Host: $DB_HOST:$DB_PORT"
echo ""

# Check if PostgreSQL is running
if ! pg_isready -h $DB_HOST -p $DB_PORT > /dev/null 2>&1; then
  echo "❌ Error: PostgreSQL is not running on $DB_HOST:$DB_PORT"
  exit 1
fi

echo "✅ PostgreSQL is running"

# Create database if it doesn't exist
echo "📦 Creating database..."
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -tc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1 || \
  psql -h $DB_HOST -p $DB_PORT -U $DB_USER -c "CREATE DATABASE $DB_NAME"

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

echo "✅ All migrations completed successfully"

# Create uploads directory
echo "📁 Creating uploads directory..."
mkdir -p uploads
echo "✅ Uploads directory created"

echo ""
echo "🎉 Database setup complete!"
echo "You can now run: npm run dev"
