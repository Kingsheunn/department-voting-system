---
title: "ADR-0001: Verification, Authentication, and Ballot Boundaries"
status: "Accepted"
date: "2026-08-10"
authors: "Department election product owner and engineering"
tags: ["architecture", "identity", "firebase", "dojah", "belenios"]
supersedes: ""
superseded_by: ""
---

# ADR-0001: Verification, Authentication, and Ballot Boundaries

## Status

**Accepted**

## Context

The department election must verify a student's `@students.unilorin.edu.ng` email, school ID, and liveness before creating an application account. Firebase must remain on the free Spark plan, identity images must not be stored in Firebase, and Belenios must remain the authoritative ballot system. Browser callbacks from an identity widget are attacker-controlled and cannot grant eligibility.

## Decision

- **DEC-001**: Use DoJah EasyOnboard for school-email, student-ID, and liveness capture in sandbox first, with Prembly retained only as a documented fallback if the representative student-ID workflow cannot be proven.
- **DEC-002**: Treat the DoJah reference ID as an opaque correlation identifier. Store status, timestamps, reason codes, and audit metadata; do not copy ID or selfie images into Firebase.
- **DEC-003**: Accept eligibility only from a signature-verified webhook or a server-to-server verification lookup. The client SDK's success callback means the flow was submitted, not approved.
- **DEC-004**: Create or sign in the Firebase user only after the server confirms the permitted email domain and an approved DoJah result. The server issues a Firebase custom token with an eligibility claim; the browser cannot mint claims or call the DoJah private API.
- **DEC-005**: Keep ballots, credentials, trackers, encrypted votes, tallying, and published results in Belenios. Firebase stores no vote choice.
- **DEC-006**: Implement the registration portal and its server boundary as a modular monolith until operational evidence justifies separate services.

## Consequences

### Positive

- **POS-001**: A Firebase account cannot be created through the supported application path before identity approval.
- **POS-002**: Compromise of the registration database does not reveal ballots or copied biometric images.
- **POS-003**: DoJah and Prembly can be changed behind a small verification-provider boundary.
- **POS-004**: Belenios supplies the specialized cryptographic voting workflow instead of custom election cryptography.

### Negative

- **NEG-001**: Custom-token authentication requires a trusted server with Firebase service-account access.
- **NEG-002**: Sandbox completion does not prove production-equivalent biometric accuracy; a consented live pilot remains mandatory.
- **NEG-003**: Provider webhooks require replay protection, idempotency, monitoring, and repair tooling.
- **NEG-004**: Election operators must coordinate a separate Belenios trustee and credential-authority ceremony.

## Alternatives Considered

### Firebase email-link sign-in before verification

- **ALT-001**: **Description**: Let students create a Firebase account through email-link authentication, then restrict application access until DoJah passes.
- **ALT-002**: **Rejection Reason**: It creates the Firebase user before the required ID and liveness checks and exposes a client-callable signup path.

### Firebase Cloud Functions as the only backend

- **ALT-003**: **Description**: Process provider callbacks and create custom tokens in Firebase Functions.
- **ALT-004**: **Rejection Reason**: Deployment would require billing activation, conflicting with the approved Spark-only Firebase constraint.

### Custom ballot implementation

- **ALT-005**: **Description**: Store candidate selections and tally votes inside Firestore.
- **ALT-006**: **Rejection Reason**: It expands the security and cryptographic burden and duplicates Belenios.

### Prembly as the initial provider

- **ALT-007**: **Description**: Integrate Prembly's document-with-face workflow first.
- **ALT-008**: **Rejection Reason**: DoJah explicitly supports other documents such as student IDs and provides a configurable EasyOnboard flow. Prembly remains the fallback if sandbox evidence disproves the fit.

## Implementation Notes

- **IMP-001**: Generate an unguessable reference ID longer than ten characters for every attempt; bind it to the normalized school email server-side.
- **IMP-002**: Verify the raw webhook body with the DoJah signature before parsing or updating state, then deduplicate by provider event/reference and transition monotonically.
- **IMP-003**: Never put `DOJAH_PRIVATE_KEY` or Firebase service-account material in a browser-exposed `NEXT_PUBLIC_` or `VITE_` variable.
- **IMP-004**: Configure Belenios with independent trustees and an external credential authority before the pilot election.
- **IMP-005**: Keep provider evidence only for the approved retention period and store sanitized audit metadata for twelve months.

## References

- **REF-001**: DoJah JavaScript integration and callback security guidance: https://docs.dojah.io/sdks/javascript-library
- **REF-002**: Firebase custom authentication: https://firebase.google.com/docs/auth/web/custom-auth
- **REF-003**: Belenios: https://www.belenios.org/
