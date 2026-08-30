---
title: "ADR-0003: Spark-Compatible Retention Cleanup"
status: "Accepted"
date: "2026-08-30"
authors: "Department election product owner and engineering"
tags: ["architecture", "firebase", "firestore", "cloudflare", "retention"]
supersedes: ""
superseded_by: ""
---

# ADR-0003: Spark-Compatible Retention Cleanup

## Context

Firestore TTL deletion requires billing, while this project must remain on the
Firebase Spark plan. Verification attempts and their reference indexes become
eligible for deletion after 24 hours. Sanitized review and election-configuration
audits expire after 12 calendar months.

## Decision

- The existing Cloudflare Worker runs retention cleanup hourly at 17 minutes
  past the hour and calls a non-public Render API route.
- The route requires the existing edge secret and a separate retention secret,
  rejects browser-originated requests, and accepts no caller-selected collection,
  cutoff, or limit.
- Each run uses server time and deletes at most 100 due documents from each of
  `verificationAttempts`, `verificationReferences`,
  `verificationReviewAudits`, and `electionConfigurationAudits`.
- `verificationEmailUids` and `electionMetadata` are never retention targets.
- Cleanup continues after a collection failure but reports the run as partial;
  the Worker treats every non-complete response as a failed scheduled event.
- Hosted cleanup requires a project-matched Firebase service account supplied
  only through the deployment platform.

## Consequences

- Normal deletion lag is less than one hour after the 24-hour eligibility point.
- The maximum scheduled deletion load is 9,600 documents per day, leaving more
  than half of Spark's 20,000 daily delete allowance for application traffic.
- A backlog above 100 due documents per collection per hour is visible through
  the sanitized `hasMore` receipt and requires an operational response.
- Provider outages can extend retention; scheduled failures must remain visible
  in Cloudflare and Render observability.

## Alternatives considered

- Firestore TTL was rejected because it requires billing.
- Upgrading to Blaze was rejected because the product owner requires Spark.
- Daily cleanup was rejected because normal deletion lag could approach 24
  additional hours.
- Manual cleanup was rejected because it is not reliable or auditable.
- A Firestore lock ledger was deferred because repeated deletion is idempotent
  and every invocation is strictly bounded.
