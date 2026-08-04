# Project Notes

## Local OIDC Verification

- For automated browser verification, use the protocol-faithful fake OIDC provider started by `pnpm e2e`.
- For interactive local verification, configure an external OIDC client and exact administrator `issuer|subject` in `.dev.vars`. ZME has no local account credentials or self-service registration.
