---
title: "ADR-0002: Shared Firebase Project Sandbox Transition"
status: "Accepted"
date: "2026-08-25"
authors: "Department election product owner and engineering"
tags: ["architecture", "identity", "firebase", "dojah", "deployment"]
supersedes: ""
superseded_by: ""
---

# ADR-0002: Shared Firebase Project Sandbox Transition

## Context

The hosted pilot uses DoJah sandbox verification but creates real Firebase Auth
accounts. The same Firebase project will later serve production. A boolean
eligibility claim cannot distinguish sandbox evidence from live evidence.

## Decision

- Hosted sandbox provisioning requires production runtime hardening, Firestore,
  edge ingress protection, and an explicit Firebase project ID that exactly
  matches the configured Firebase project.
- Every verified voter claim includes the verification provider environment.
  The API accepts a voter only when that claim matches its current provider
  environment.
- Re-verification may update the same stable Firebase identity from `sandbox`
  to `production`. Switching the API to production immediately rejects old
  sandbox ID tokens, including tokens that have not yet expired.
- Staff authorization claims remain separate and are never inferred from voter
  eligibility.

## Consequences

- Pilot accounts can exist in the future production project without retaining
  production voting access automatically.
- Every pilot voter must complete live re-verification before a production
  election.
- Operators must remove the hosted-sandbox project binding when DoJah switches
  live and verify that production tokens carry the production environment.

## Alternatives considered

- A separate Firebase project would provide stronger isolation, but the product
  owner explicitly selected one shared project.
- Keeping only `identityVerified: true` was rejected because it cannot revoke
  sandbox trust at the environment transition boundary.
