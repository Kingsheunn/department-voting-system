import assert from "node:assert/strict";
import test from "node:test";

import { createDojahResolver } from "../src/dojah.js";

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
