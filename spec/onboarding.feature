Feature: Onboarding
  How a fresh deployment gets its first administrator.

  # The id is the @<capability>/<slug> tag; the second tag is the layer that proves it.

  @onboarding/first-admin @api
  Scenario: First run creates the first administrator
    Given a deployment with no users
    When the operator submits the administrator name, email, and password
    Then the account is created with the admin role and setup reports initialized

  @onboarding/locked-after-init @e2e
  Scenario: Onboarding is locked once an administrator exists
    Given a deployment that already has an administrator
    When the onboarding screen is opened again
    Then the create-administrator step is no longer offered
