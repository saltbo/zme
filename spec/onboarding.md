# Onboarding

How a fresh deployment gets its first administrator.

### `onboarding/first-admin`
The first run has no users; the operator creates the first administrator account.

- **Given** a deployment with no users
- **When** the operator submits the administrator name, email, and password
- **Then** the account is created with the `admin` role and setup reports initialized

_Verified at: api_

### `onboarding/locked-after-init`
Once an administrator exists, onboarding can no longer create another one.

- **Given** a deployment that already has an administrator
- **When** the onboarding screen is opened again
- **Then** the create-administrator step is no longer offered

_Verified at: e2e_
