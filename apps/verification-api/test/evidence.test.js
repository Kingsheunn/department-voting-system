import assert from "node:assert/strict";
import test from "node:test";

import { createDojahEvidenceService } from "../src/evidence.js";

const referenceId = "VR_reference-value";
const evidenceHost = "evidence.example.test";

function details(overrides = {}) {
  return {
    reference_id: referenceId,
    verification_url: "https://app.dojah.io/easy-onboard/verifications/example",
    data: {
      additional_document: [
        {
          document_type: "Student ID",
          document_url: `https://${evidenceHost}/student-card.jpg?temporary=1`,
        },
      ],
    },
    ...overrides,
  };
}

test("returns only sanitized review metadata and the DoJah dashboard option", async () => {
  const service = createDojahEvidenceService({
    resolveVerification: async () => details(),
    evidenceHosts: [evidenceHost],
    fetchImpl: async () => {
      throw new Error("image fetch is not needed for metadata");
    },
  });

  assert.deepEqual(await service.getReviewMetadata(referenceId), {
    dashboardUrl: "https://app.dojah.io/easy-onboard/verifications/example",
    studentCardAvailable: true,
  });
});

test("fetches a bounded allowlisted student-card image without exposing its URL", async () => {
  const service = createDojahEvidenceService({
    resolveVerification: async () => details(),
    evidenceHosts: [evidenceHost],
    fetchImpl: async (url, options) => {
      assert.equal(url.hostname, evidenceHost);
      assert.equal(options.redirect, "manual");
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/jpeg", "content-length": "3" },
      });
    },
  });

  const evidence = await service.fetchStudentCard(referenceId);
  assert.equal(evidence.contentType, "image/jpeg");
  assert.deepEqual(evidence.body, Buffer.from([1, 2, 3]));
  assert.equal(JSON.stringify(evidence).includes(evidenceHost), false);
});

test("rejects unapproved evidence hosts before fetching", async () => {
  let fetchCalls = 0;
  const service = createDojahEvidenceService({
    resolveVerification: async () =>
      details({
        data: {
          additional_document: [
            { document_type: "Student ID", document_url: "https://attacker.test/id.jpg" },
          ],
        },
      }),
    evidenceHosts: [evidenceHost],
    fetchImpl: async () => {
      fetchCalls += 1;
    },
  });

  await assert.rejects(() => service.fetchStudentCard(referenceId), /evidence url/i);
  assert.equal(fetchCalls, 0);
});

test("rejects a custom port on an evidence URL", async () => {
  let fetchCalls = 0;
  const evidenceService = createDojahEvidenceService({
    resolveVerification: async () =>
      details({
        data: {
          additional_document: [
            {
              document_type: "Student ID",
              document_url: `https://${evidenceHost}:8443/student-card.jpg`,
            },
          ],
        },
      }),
    evidenceHosts: [evidenceHost],
    fetchImpl: async () => {
      fetchCalls += 1;
    },
  });
  await assert.rejects(
    () => evidenceService.fetchStudentCard(referenceId),
    /evidence url/i,
  );
  assert.equal(fetchCalls, 0);
});

test("rejects a custom port on the dashboard URL", async () => {
  const dashboardService = createDojahEvidenceService({
    resolveVerification: async () =>
      details({
        verification_url:
          "https://app.dojah.io:8443/easy-onboard/verifications/example",
      }),
    evidenceHosts: [evidenceHost],
  });
  await assert.rejects(
    () => dashboardService.getReviewMetadata(referenceId),
    /dashboard url/i,
  );
});

test("rejects redirects instead of following a new destination", async () => {
  const service = createDojahEvidenceService({
    resolveVerification: async () => details(),
    evidenceHosts: [evidenceHost],
    fetchImpl: async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://attacker.test/copy.jpg" },
      }),
  });

  await assert.rejects(() => service.fetchStudentCard(referenceId), /redirect/i);
});

test("rejects unsupported media and oversized responses", async () => {
  const serviceFor = (response) =>
    createDojahEvidenceService({
      resolveVerification: async () => details(),
      evidenceHosts: [evidenceHost],
      fetchImpl: async () => response,
      maxBytes: 3,
    });

  await assert.rejects(
    () =>
      serviceFor(
        new Response("not an image", {
          headers: { "content-type": "text/html" },
        }),
      ).fetchStudentCard(referenceId),
    /content type/i,
  );
  await assert.rejects(
    () =>
      serviceFor(
        new Response(new Uint8Array([1, 2, 3, 4]), {
          headers: { "content-type": "image/png" },
        }),
      ).fetchStudentCard(referenceId),
    /too large/i,
  );
});

test("cancels oversized chunked evidence despite a dishonest content length", async () => {
  let cancelled = false;
  let chunkIndex = 0;
  const chunks = [new Uint8Array([1, 2]), new Uint8Array([3, 4])];
  const service = createDojahEvidenceService({
    resolveVerification: async () => details(),
    evidenceHosts: [evidenceHost],
    maxBytes: 3,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: new Headers({
        "content-type": "image/png",
        "content-length": "2",
      }),
      body: new ReadableStream({
        pull(controller) {
          if (chunkIndex < chunks.length) {
            controller.enqueue(chunks[chunkIndex]);
            chunkIndex += 1;
            return;
          }
          // Keep the source open so cancellation is observable at the hard cap.
        },
        cancel() {
          cancelled = true;
        },
      }),
      arrayBuffer: async () => {
        throw new Error("arrayBuffer must not be called");
      },
    }),
  });

  await assert.rejects(() => service.fetchStudentCard(referenceId), /too large/i);
  assert.equal(cancelled, true);
});

test("rejects malformed provider detail instead of guessing", async () => {
  const service = createDojahEvidenceService({
    resolveVerification: async () => ({ reference_id: "VR_other" }),
    evidenceHosts: [evidenceHost],
  });

  await assert.rejects(() => service.getReviewMetadata(referenceId), /reference/i);
  await assert.rejects(() => service.fetchStudentCard(referenceId), /reference/i);
});
