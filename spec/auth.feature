Feature: Authentication & access
  Session-based auth; the SPA talks to the API with a session cookie.

  @auth/login-redirect @e2e
  Scenario: A logged-out visitor is sent to the login screen
    Given a visitor without a session
    When they open a protected route
    Then they are redirected to the login screen

  @auth/sign-in @e2e
  Scenario: Valid credentials start a session
    Given a registered user on the login screen
    When they submit valid credentials
    Then they are signed in and leave the login screen

  @auth/reject-bad-credentials @e2e
  Scenario: Invalid credentials do not start a session
    Given a user on the login screen
    When they submit a wrong password
    Then they stay on the login screen, unauthenticated

  @auth/session-persists @e2e
  Scenario: A session survives a full page reload
    Given a signed-in user
    When they reload the page
    Then they remain signed in

  @auth/api-requires-session @api
  Scenario: The API refuses unauthenticated requests to protected endpoints
    Given a request without a session
    When it calls a protected API endpoint
    Then the API responds 401

  @auth/admin-only @api
  Scenario: Admin-only endpoints are hidden from non-admin users
    Given a signed-in user without the admin role
    When they call an admin-only endpoint
    Then the API responds 403
