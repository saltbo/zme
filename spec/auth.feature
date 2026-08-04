Feature: Authentication & access
  People authenticate at the deployment's external OIDC provider. ZME keeps only a secure local application session.

  @auth/login-redirect @e2e
  Scenario: A logged-out visitor is sent to the login screen
    Given a visitor without a session
    When they open a protected route
    Then they are redirected to the login screen

  @auth/sign-in @e2e
  Scenario: A valid external OIDC callback starts a session
    Given a user on the external identity login screen
    When the provider completes Authorization Code Flow with PKCE S256
    Then they are signed in and leave the login screen

  @auth/reject-invalid-callback @api
  Scenario: An invalid OIDC callback does not start a session
    Given an authorization callback with invalid state, nonce, issuer, audience, signature, algorithm, or expiry
    When ZME validates the callback
    Then the request is rejected without a session

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

  @auth/configured-admin @api
  Scenario: Administrator projection comes from an explicit subject allowlist
    Given a configured issuer and administrator subject
    When that exact identity signs in
    Then its local projection has the administrator role

  @auth/no-email-linking @api
  Scenario: Matching email does not merge identities
    Given an existing projection and a different OIDC subject with the same email
    When the different subject signs in
    Then ZME creates a separate projection

  @auth/external-only @e2e
  Scenario: The application exposes no local account credentials
    Given a visitor on the login screen
    When they inspect the available sign-in controls
    Then only the external identity provider option is available
