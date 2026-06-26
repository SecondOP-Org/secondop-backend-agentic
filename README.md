# SecondOp Backend API

A comprehensive Node.js/Express/TypeScript backend for the SecondOp medical second opinion platform.

## 🏗️ Architecture

- **Framework**: Express.js with TypeScript
- **Database**: PostgreSQL
- **Authentication**: JWT (Access + Refresh Tokens)
- **Real-time**: Socket.IO for messaging
- **File Upload**: Multer with local storage
- **Payment**: Stripe integration
- **Security**: Helmet, CORS, Rate Limiting

## 📁 Project Structure

```
backend/
├── src/
│   ├── controllers/       # Request handlers
│   ├── routes/           # API route definitions
│   ├── middleware/       # Auth, error handling, upload
│   ├── database/         # Database connection & helpers
│   ├── utils/            # Logger and utilities
│   ├── types/            # TypeScript type definitions
│   └── server.ts         # Main application entry
├── migrations/           # Database schema migrations
├── uploads/             # File upload directory
├── .env.example         # Environment variables template
└── package.json         # Dependencies
```

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ and npm
- PostgreSQL 14+
- Stripe account (for payments)
- AWS S3 (optional, for file storage)

### Installation

1. **Clone and navigate to backend directory**
```bash
cd backend
```

2. **Install dependencies**
```bash
npm install
```

3. **Set up environment variables**
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. **Create PostgreSQL database**
```bash
createdb secondop_db
```

5. **Run database migrations**
```bash
psql -d secondop_db -f migrations/001_initial_schema.sql
psql -d secondop_db -f migrations/002_cases_and_messages.sql
psql -d secondop_db -f migrations/003_prescriptions_and_labs.sql
psql -d secondop_db -f migrations/004_billing_and_payments.sql
```

6. **Create uploads directory**
```bash
mkdir uploads
```

7. **Start development server**
```bash
npm run dev
```

The server will start on `http://localhost:3000` (or your configured PORT).

## 🔑 Environment Variables

See `.env.example` for all required variables:

- **Database**: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`
- **JWT**: `JWT_SECRET`, `JWT_REFRESH_SECRET`, `JWT_EXPIRES_IN`
- **Server**: `PORT`, `NODE_ENV`, `API_VERSION`
- **File Upload**: `UPLOAD_DIR`, `MAX_FILE_SIZE`
- **Stripe**: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- **Email**: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`
- **SMS**: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`

## Release Versioning

SecondOp uses one product release version plus separate frontend/backend build metadata. See `docs/RELEASE_VERSIONING.md` for the policy and follow-up implementation path.

## 🏷️ Release Metadata

The backend exposes safe release/build metadata at:

- `GET /health` - health status with compact `version` metadata.
- `GET /version` - release/build metadata only.

Set these public metadata variables in hosted environments when available:

- `SECONDOP_RELEASE_VERSION`
- `BACKEND_GIT_SHA`
- `BACKEND_BUILD_TIME`
- `BACKEND_DEPLOYMENT_ID`

## 📡 API Endpoints

### Runtime
- `GET /health` - Health check plus safe version metadata
- `GET /version` - Safe backend release/build metadata

### Authentication (`/api/v1/auth`)
- `POST /register` - Register new user (patient/doctor)
- `POST /login` - Email/password login
- `POST /login/phone` - Phone-based login (sends OTP)
- `POST /verify-otp` - Verify OTP code
- `POST /refresh-token` - Refresh access token
- `POST /logout` - Logout user
- `POST /forgot-password` - Request password reset
- `POST /reset-password` - Reset password with token
- `POST /change-password` - Change password (authenticated)

### Users (`/api/v1/users`)
- `GET /profile` - Get user profile
- `PUT /profile` - Update user profile
- `POST /avatar` - Upload avatar image

### Cases (`/api/v1/cases`)
- `POST /` - Create new case (patient)
- `GET /my-cases` - Get patient's cases
- `GET /doctor/cases` - Get doctor's assigned cases
- `GET /:caseId` - Get case details
- `PUT /:caseId` - Update case
- `DELETE /:caseId` - Delete case
- `POST /:caseId/assign` - Assign doctor to case
- `PUT /:caseId/status` - Update case status (doctor)

### Messages (`/api/v1/messages`)
- `POST /` - Send message (with attachments)
- `GET /case/:caseId` - Get case messages
- `PUT /:messageId/read` - Mark message as read
- `DELETE /:messageId` - Delete message

### Files (`/api/v1/files`)
- `POST /upload` - Upload medical file
- `GET /` - Get files (by case or patient)
- `GET /:fileId` - Get file details
- `GET /:fileId/download` - Download file
- `DELETE /:fileId` - Delete file

### Health Metrics (`/api/v1/health`)
- `POST /metrics` - Add health metric
- `GET /metrics` - Get all metrics
- `GET /metrics/:type` - Get metrics by type
- `DELETE /metrics/:metricId` - Delete metric
- `POST /goals` - Create health goal
- `GET /goals` - Get health goals
- `PUT /goals/:goalId` - Update health goal

### Prescriptions (`/api/v1/prescriptions`)
- `POST /` - Create prescription (doctor)
- `GET /` - Get prescriptions
- `GET /:prescriptionId` - Get prescription details
- `POST /:prescriptionId/medications` - Add medication
- `PUT /medications/:medicationId` - Update medication
- `POST /medications/:medicationId/adherence` - Track adherence

### Lab Results (`/api/v1/lab-results`)
- `POST /` - Add lab result
- `GET /` - Get lab results (patient)
- `GET /:labResultId` - Get lab result details
- `PUT /:labResultId` - Update lab result
- `DELETE /:labResultId` - Delete lab result

### Billing (`/api/v1/billing`)
- `GET /plans` - Get subscription plans
- `POST /subscribe` - Subscribe to plan
- `POST /cancel-subscription` - Cancel subscription
- `GET /subscription` - Get current subscription
- `POST /payment-methods` - Add payment method
- `GET /payment-methods` - Get payment methods
- `DELETE /payment-methods/:id` - Delete payment method
- `GET /invoices` - Get invoices
- `GET /payments` - Get payment history
- `POST /create-payment-intent` - Create Stripe payment intent
- `POST /webhook` - Stripe webhook handler

### Appointments (`/api/v1/appointments`)
- `POST /` - Create appointment (patient)
- `GET /` - Get appointments
- `GET /:appointmentId` - Get appointment details
- `PUT /:appointmentId` - Update appointment
- `POST /:appointmentId/cancel` - Cancel appointment
- `GET /doctor/:doctorId/availability` - Get doctor availability

### Doctors (`/api/v1/doctors`)
- `GET /` - Get all doctors (with filters)
- `GET /search` - Search doctors
- `GET /:doctorId` - Get doctor details
- `GET /:doctorId/reviews` - Get doctor reviews
- `POST /:doctorId/reviews` - Add doctor review (patient)

## 🔒 Authentication

All protected routes require a JWT token in the Authorization header:

```
Authorization: Bearer <your_jwt_token>
```

Role-based access control is implemented for patient and doctor-specific endpoints.

## 📊 Database Schema

The database consists of 20+ tables including:
- Users, Patients, Doctors
- Cases, Case Assignments
- Messages, Medical Files
- Appointments
- Health Metrics, Health Goals
- Prescriptions, Medications, Medication Adherence
- Lab Results
- Subscription Plans, User Subscriptions
- Payment Methods, Invoices, Payments
- Notifications

See migration files in `/migrations` for complete schema.

## 🧪 Development

```bash
# Run in development mode with hot reload
npm run dev

# Build for production
npm run build

# Run production build
npm start

# Run linter
npm run lint
```

## ✅ E2E Smoke Tests (Deployed API)

Use this to validate core end-to-end backend flow after deployment.

```bash
# Uses default production URL:
npm run e2e:smoke

# Or target a custom URL:
E2E_API_BASE_URL=https://your-api-domain npm run e2e:smoke
```

Optional analysis path (upload PDF + queue + poll):

```bash
E2E_API_BASE_URL=https://your-api-domain npm run e2e:smoke:analysis
```

Notes:
- The smoke script creates a unique patient account each run.
- Analysis mode may take longer and depends on analysis runtime/config.

## 📝 API Response Format

All API responses follow this format:

```json
{
  "status": "success",
  "data": { ... },
  "message": "Optional message"
}
```

Error responses:

```json
{
  "status": "error",
  "message": "Error description",
  "statusCode": 400
}
```

## 🔌 Real-time Features

Socket.IO is used for real-time messaging. Clients should connect to the Socket.IO server and join case-specific rooms:

```javascript
socket.emit('join-case', caseId);
socket.on('new-message', (message) => { ... });
```

## 🛡️ Security Features

- Password hashing with bcrypt
- JWT token authentication
- Rate limiting on auth endpoints
- CORS configuration
- Helmet security headers
- File upload validation
- SQL injection prevention (parameterized queries)

## 📦 Dependencies

Key dependencies:
- `express` - Web framework
- `pg` - PostgreSQL client
- `jsonwebtoken` - JWT authentication
- `bcryptjs` - Password hashing
- `socket.io` - Real-time communication
- `multer` - File uploads
- `stripe` - Payment processing
- `winston` - Logging

## 🚧 TODO

- [ ] Add email service integration (SendGrid/AWS SES)
- [ ] Add SMS service integration (Twilio)
- [ ] Implement AWS S3 for file storage
- [ ] Add comprehensive API tests
- [ ] Add API documentation (Swagger/OpenAPI)
- [ ] Implement caching (Redis)
- [ ] Add database seeding scripts
- [ ] Implement video call functionality
- [ ] Add doctor reviews table and functionality

## 📄 License

Proprietary - SecondOp Platform
