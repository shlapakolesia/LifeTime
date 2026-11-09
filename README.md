# LifeTime frontend

LifeTime is a light-themed personal and social scheduling application. It combines a calendar, tasks, friends, groups, deterministic shared-availability search, and a Premium scheduling assistant.

This repository currently contains the React frontend and local demo adapters. It does not contain a production authentication system, backend, database, AWS credentials, or payment processing.

## Technology

- React 19 and TypeScript
- Vite
- Tailwind CSS 4 and project CSS
- Browser `localStorage` for non-sensitive demo records
- IndexedDB adapter for local avatar and Premium screenshot previews

## Local development

Requirements are defined in `.mise.toml`. With Node.js installed:

```bash
npm install
npm run dev
```

The Figma Make environment starts the development server automatically. Do not start a second server there.

Production build:

```bash
npm run build
npx tsc --noEmit
```

Environment variables are optional in demo mode. Copy `.env.example` to `.env.local` only when configuration is available.

## Current demo features

- Public landing, registration, login, callback, protected-route experience, and logout
- Calendar event creation, editing, deletion, and persistent demo records
- Tasks, friends, groups, notifications, and settings
- Deterministic Find Free Time calculations from seeded and user-created events
- Profile editing and validated avatar preview/upload through a browser storage adapter
- Premium request screenshot upload and explicitly simulated administrator review
- Rule-based Premium assistant; no LLM is connected

Demo authentication stores only a small session identity in `sessionStorage`. It does not store or verify passwords. Browser route guards demonstrate intended UX and are not a security boundary.

## Integration boundaries

### Authentication

`src/auth/AuthProvider.tsx` defines the `AuthAdapter` boundary. The production adapter should use an established OIDC library with Amazon Cognito Managed Login and Authorization Code Flow with PKCE. Cognito will own email/password registration, email verification, Google federation, tokens, callback handling, and logout.

Expected configuration:

- `VITE_COGNITO_AUTHORITY`
- `VITE_COGNITO_CLIENT_ID`
- `VITE_COGNITO_REDIRECT_URI`
- `VITE_COGNITO_LOGOUT_URI`

Never add a Google client secret, Cognito client secret, or AWS credentials to the frontend.

### API

`src/services/apiClient.ts` is the centralized HTTP boundary. A production token provider will attach the Cognito access token. Configure the API origin with `VITE_API_BASE_URL`; do not hardcode service URLs in components.

### Files

`src/services/avatarService.ts` and `src/services/premiumRequestService.ts` are replaceable adapters. Production uploads should:

1. Request authorization from the authenticated backend.
2. Receive a short-lived Amazon S3 presigned URL.
3. Upload directly to S3.
4. Let the backend persist only the object reference.

Premium submission will use `POST /api/premium/requests`. The backend should store evidence privately and trigger an Amazon SES administrator notification containing request details and a secure authenticated review link—not public image URLs.

### Premium authorization

Frontend locking is only presentational. The future API must verify Premium entitlement and administrator role independently for every protected operation.

## Planned AWS architecture

- Static frontend assets: Amazon S3 and CloudFront
- Authentication: Amazon Cognito
- Backend: independently deployable API on ECS/Fargate, Lambda, or another compatible service
- Database: selected during backend implementation
- Private file storage: Amazon S3
- Email: Amazon SES
- Infrastructure: Terraform or another agreed IaC tool

The frontend remains a static Vite build and does not require Docker for local work. Container and infrastructure files should be added only when deployment requirements are finalized.

## Project organization

```text
src/
  auth/        authentication state and adapters
  components/  reusable UI
  pages/       application screens
  services/    API, file, and Premium integration boundaries
  data.ts      seeded demo data
  store.tsx    local prototype state
  types.ts     shared domain types
  config.ts    centralized environment configuration
```

Keep secrets out of Git, preserve Ukrainian interface copy, and add backend integrations behind the existing service interfaces.
