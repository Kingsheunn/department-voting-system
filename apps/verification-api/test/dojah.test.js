import assert from "node:assert/strict";
import test from "node:test";

import { createDojahResolver } from "../src/dojah.js";

const MAX_SELFIE_BYTES = 5 * 1024 * 1024;

function chunkedImageResponse(
  chunks,
  { contentLength, onCancel, stayOpen = false } = {},
) {
  let index = 0;
  const headers = new Headers({ "content-type": "image/jpeg" });
  if (contentLength !== undefined) headers.set("content-length", contentLength);

  return {
    ok: true,
    headers,
    body: new ReadableStream({
      pull(controller) {
        if (index < chunks.length) {
          controller.enqueue(chunks[index]);
          index += 1;
          return;
        }
        if (!stayOpen) controller.close();
      },
      cancel() {
        onCancel?.();
      },
    }),
    arrayBuffer: async () => {
      throw new Error("arrayBuffer must not be called");
    },
  };
}

test("resolves verification details through the authenticated HTTPS DoJah API", async () => {
  const expected = { reference_id: "VR_reference-value", verification_status: "Pending" };
  const resolver = createDojahResolver({
    baseUrl: "https://sandbox.dojah.io",
    appId: "public-app-id",
    privateKey: "test-only-private-key",
    fetchImpl: async (url, options) => {
      const requestUrl = new URL(url);
      assert.equal(requestUrl.protocol, "https:");
      assert.equal(requestUrl.pathname, "/api/v1/kyc/verification");
      assert.equal(requestUrl.searchParams.get("reference_id"), "VR_reference-value");
      assert.equal(options.headers.AppId, "public-app-id");
      assert.equal(options.headers.Authorization, "test-only-private-key");
      assert.equal(options.redirect, "error");
      return { ok: true, json: async () => ({ entity: expected }) };
    },
  });

  assert.deepEqual(await resolver("VR_reference-value"), expected);
});

test("normalizes a documented liveness verdict without exposing selfie evidence", async () => {
  const selfieBytes = Buffer.from("test-only-selfie-bytes");
  const requests = [];
  const resolver = createDojahResolver({
    baseUrl: "https://sandbox.dojah.io",
    appId: "public-app-id",
    privateKey: "test-only-private-key",
    fetchImpl: async (url, options) => {
      const requestUrl = new URL(url);
      requests.push({ url: requestUrl, options });
      if (requestUrl.pathname === "/api/v1/kyc/verification") {
        return {
          ok: true,
          json: async () => ({
            entity: {
              reference_id: "VR_reference-value",
              verification_status: "Completed",
              status: true,
              selfie_url: "https://images.dojah.io/top-level-selfie.jpg",
              data: {
                email: {
                  status: true,
                  data: { email: "student.one@students.unilorin.edu.ng" },
                },
                selfie: {
                  status: true,
                  data: { selfie_url: "https://images.dojah.io/selfie.jpg" },
                },
                additional_document: [
                  {
                    document_type: "image",
                    document_url: "https://images.dojah.io/student-card.jpg",
                  },
                ],
              },
            },
          }),
        };
      }
      if (requestUrl.hostname === "images.dojah.io") {
        assert.equal(options.headers, undefined);
        assert.equal(options.redirect, "error");
        return chunkedImageResponse([selfieBytes]);
      }
      assert.equal(requestUrl.pathname, "/api/v1/ml/liveness");
      assert.equal(options.headers.AppId, "public-app-id");
      assert.equal(options.headers.Authorization, "test-only-private-key");
      assert.deepEqual(JSON.parse(options.body), {
        image: selfieBytes.toString("base64"),
      });
      return {
        ok: true,
        json: async () => ({
          entity: {
            liveness: {
              liveness_check: true,
              liveness_probability: 91.25,
            },
          },
        }),
      };
    },
  });

  const result = await resolver("VR_reference-value");

  assert.deepEqual(result.liveness, { passed: true, probability: 91.25 });
  assert.equal(JSON.stringify(result).includes("images.dojah.io"), false);
  assert.equal(JSON.stringify(result).includes(selfieBytes.toString("base64")), false);
  assert.equal(requests.length, 3);
});

test("fails closed for undocumented liveness response shapes", async () => {
  const invalidLivenessValues = [
    null,
    {},
    { liveness_check: "true", liveness_probability: 91 },
    { liveness_check: true, liveness_probability: "91" },
    { liveness_check: true, liveness_probability: -1 },
    { liveness_check: true, liveness_probability: 101 },
  ];

  for (const liveness of invalidLivenessValues) {
    const resolver = createDojahResolver({
      baseUrl: "https://sandbox.dojah.io",
      appId: "public-app-id",
      privateKey: "test-only-private-key",
      fetchImpl: async (url) => {
        const requestUrl = new URL(url);
        if (requestUrl.pathname === "/api/v1/kyc/verification") {
          return {
            ok: true,
            json: async () => ({
              entity: {
                reference_id: "VR_reference-value",
                verification_status: "Completed",
                data: {
                  selfie: {
                    status: true,
                    data: { selfie_url: "https://images.dojah.io/selfie.jpg" },
                  },
                },
              },
            }),
          };
        }
        if (requestUrl.hostname === "images.dojah.io") {
          return chunkedImageResponse([Buffer.from("selfie")]);
        }
        return {
          ok: true,
          json: async () => ({ entity: { liveness } }),
        };
      },
    });

    await assert.rejects(
      () => resolver("VR_reference-value"),
      /liveness response is invalid/i,
    );
  }
});

test("rejects a verification-details response without a valid entity envelope", async () => {
  const invalidPayloads = [{}, { entity: null }, { entity: [] }];

  for (const payload of invalidPayloads) {
    const resolver = createDojahResolver({
      baseUrl: "https://sandbox.dojah.io",
      appId: "public-app-id",
      privateKey: "test-only-private-key",
      fetchImpl: async () => ({ ok: true, json: async () => payload }),
    });

    await assert.rejects(
      () => resolver("VR_reference-value"),
      /verification response/i,
    );
  }
});

test("accepts only explicitly configured account-specific selfie hosts", async () => {
  const configuredHost = "account.r2.cloudflarestorage.com";
  let fetchedConfiguredHost = false;
  const resolver = createDojahResolver({
    baseUrl: "https://sandbox.dojah.io",
    appId: "public-app-id",
    privateKey: "test-only-private-key",
    imageHosts: [configuredHost],
    fetchImpl: async (url) => {
      const requestUrl = new URL(url);
      if (requestUrl.pathname === "/api/v1/kyc/verification") {
        return {
          ok: true,
          json: async () => ({
            entity: {
              reference_id: "VR_reference-value",
              verification_status: "Completed",
              status: true,
              data: {
                email: { status: true, data: { email: "student.one@students.unilorin.edu.ng" } },
                selfie: { status: true, data: { selfie_url: `https://${configuredHost}/selfie.jpg` } },
              },
            },
          }),
        };
      }
      if (requestUrl.hostname === configuredHost) {
        fetchedConfiguredHost = true;
        return new Response(new Uint8Array([1]), { headers: { "content-type": "image/jpeg" } });
      }
      return {
        ok: true,
        json: async () => ({ entity: { liveness: { liveness_check: true, liveness_probability: 90 } } }),
      };
    },
  });

  await resolver("VR_reference-value");
  assert.equal(fetchedConfiguredHost, true);
});

test("rejects a custom port on the DoJah API URL", () => {
  assert.throws(
    () =>
      createDojahResolver({
        baseUrl: "https://sandbox.dojah.io:8443",
        appId: "public-app-id",
        privateKey: "test-only-private-key",
      }),
    /base url/i,
  );
});

test("rejects a custom port on a selfie URL", async () => {
  let selfieFetchCalls = 0;
  const resolver = createDojahResolver({
    baseUrl: "https://sandbox.dojah.io",
    appId: "public-app-id",
    privateKey: "test-only-private-key",
    fetchImpl: async (url) => {
      const requestUrl = new URL(url);
      if (requestUrl.pathname === "/api/v1/kyc/verification") {
        return {
          ok: true,
          json: async () => ({
            entity: {
              reference_id: "VR_reference-value",
              verification_status: "Completed",
              data: {
                selfie: {
                  status: true,
                  data: {
                    selfie_url: "https://images.dojah.io:8443/selfie.jpg",
                  },
                },
              },
            },
          }),
        };
      }
      selfieFetchCalls += 1;
      throw new Error("custom-port selfie must not be fetched");
    },
  });

  await assert.rejects(() => resolver("VR_reference-value"), /selfie evidence url/i);
  assert.equal(selfieFetchCalls, 0);
});

test("cancels an oversized chunked selfie without buffering the full body", async () => {
  let cancelled = false;
  const resolver = createDojahResolver({
    baseUrl: "https://sandbox.dojah.io",
    appId: "public-app-id",
    privateKey: "test-only-private-key",
    fetchImpl: async (url) => {
      const requestUrl = new URL(url);
      if (requestUrl.pathname === "/api/v1/kyc/verification") {
        return {
          ok: true,
          json: async () => ({
            entity: {
              reference_id: "VR_reference-value",
              verification_status: "Completed",
              data: {
                selfie: {
                  status: true,
                  data: { selfie_url: "https://images.dojah.io/selfie.jpg" },
                },
              },
            },
          }),
        };
      }
      if (requestUrl.hostname === "images.dojah.io") {
        return chunkedImageResponse(
          [new Uint8Array(MAX_SELFIE_BYTES), new Uint8Array([1])],
          {
            contentLength: "1",
            onCancel: () => (cancelled = true),
            stayOpen: true,
          },
        );
      }
      throw new Error("liveness must not run for an oversized selfie");
    },
  });

  await assert.rejects(() => resolver("VR_reference-value"), /selfie evidence is invalid/i);
  assert.equal(cancelled, true);
});

test("rejects a non-HTTPS DoJah API base URL", () => {
  assert.throws(
    () =>
      createDojahResolver({
        baseUrl: "http://sandbox.dojah.io",
        appId: "public-app-id",
        privateKey: "test-only-private-key",
      }),
    /https/i,
  );
});

test("rejects credentials, query parameters, and fragments in the DoJah base URL", () => {
  const unsafeUrls = [
    "https://user:password@sandbox.dojah.io",
    "https://sandbox.dojah.io?redirect=elsewhere",
    "https://sandbox.dojah.io#fragment",
  ];

  for (const baseUrl of unsafeUrls) {
    assert.throws(
      () =>
        createDojahResolver({
          baseUrl,
          appId: "public-app-id",
          privateKey: "test-only-private-key",
        }),
      /base url/i,
    );
  }
});
