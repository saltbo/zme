# Authentication & access

Session-based auth; the SPA talks to the API with a session cookie.

### `auth/login-redirect`
A logged-out visitor to a protected page is sent to the login screen.

- **Given** a visitor without a session
- **When** they open a protected route
- **Then** they are redirected to the login screen

_Verified at: e2e_

### `auth/sign-in`
Valid credentials start a session and return the user to the app.

- **Given** a registered user on the login screen
- **When** they submit valid credentials
- **Then** they are signed in and leave the login screen

_Verified at: e2e_

### `auth/reject-bad-credentials`
Invalid credentials do not start a session.

- **Given** a user on the login screen
- **When** they submit a wrong password
- **Then** they stay on the login screen, unauthenticated

_Verified at: e2e_

### `auth/session-persists`
A session survives a full page reload.

- **Given** a signed-in user
- **When** they reload the page
- **Then** they remain signed in

_Verified at: e2e_

### `auth/api-requires-session`
The API refuses unauthenticated requests to protected endpoints.

- **Given** a request without a session
- **When** it calls a protected API endpoint
- **Then** the API responds 401

_Verified at: api_

### `auth/admin-only`
Admin-only endpoints are hidden from non-admin users.

- **Given** a signed-in user without the admin role
- **When** they call an admin-only endpoint
- **Then** the API responds 403

_Verified at: api_
