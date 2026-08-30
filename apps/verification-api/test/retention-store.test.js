import assert from "node:assert/strict";
import test from "node:test";

import { createFirestoreStore } from "../src/firestore-store.js";

const TARGETS = [
  "verificationAttempts",
  "verificationReferences",
  "verificationReviewAudits",
  "electionConfigurationAudits",
];

function createRetentionFirestore({ failCollection } = {}) {
  const records = new Map();
  const queries = [];

  function query(name, filters = [], ordering, maximum = Infinity) {
    return {
      where(field, operator, value) {
        return query(name, [...filters, { field, operator, value }], ordering, maximum);
      },
      orderBy(field, direction) {
        return query(name, filters, { field, direction }, maximum);
      },
      limit(value) {
        return query(name, filters, ordering, value);
      },
      async get() {
        if (name === failCollection) throw new Error("sensitive failure details");
        queries.push({ name, filters, ordering, maximum });
        let values = [...records.entries()]
          .filter(([path]) => path.startsWith(`${name}/`))
          .map(([path, value]) => ({ path, value }));
        for (const filter of filters) {
          assert.equal(filter.operator, "<=");
          values = values.filter(({ value }) => {
            const candidate = value[filter.field];
            return candidate instanceof Date ? candidate <= filter.value : candidate !== undefined;
          });
        }
        if (ordering) {
          values.sort((left, right) => {
            const leftTime = left.value[ordering.field] instanceof Date
              ? left.value[ordering.field].getTime()
              : Number.NEGATIVE_INFINITY;
            const rightTime = right.value[ordering.field] instanceof Date
              ? right.value[ordering.field].getTime()
              : Number.NEGATIVE_INFINITY;
            return leftTime - rightTime;
          });
        }
        return {
          docs: values.slice(0, maximum).map(({ path, value }) => ({
            ref: { path },
            data: () => structuredClone(value),
          })),
        };
      },
    };
  }

  return {
    records,
    queries,
    collection(name) {
      return {
        doc: (id) => ({ path: `${name}/${id}` }),
        ...query(name),
      };
    },
    batch() {
      const deletions = [];
      return {
        delete(reference) {
          deletions.push(reference.path);
        },
        async commit() {
          for (const path of deletions) records.delete(path);
        },
      };
    },
    async runTransaction() {
      throw new Error("not used by retention tests");
    },
  };
}

function seedRetentionFixtures(firestore, cutoff) {
  for (const collection of TARGETS) {
    firestore.records.set(`${collection}/expired`, {
      deleteAfter: new Date(cutoff.getTime() - 1),
    });
    firestore.records.set(`${collection}/boundary`, { deleteAfter: cutoff });
    firestore.records.set(`${collection}/future`, {
      deleteAfter: new Date(cutoff.getTime() + 1),
    });
    firestore.records.set(`${collection}/missing`, {});
    firestore.records.set(`${collection}/malformed`, { deleteAfter: "yesterday" });
  }
  firestore.records.set("verificationEmailUids/stable", { firebaseUid: "stable-uid" });
  firestore.records.set("electionMetadata/current", { revision: 7 });
}

test("retention cleanup deletes only due records from the four retention collections", async () => {
  const cutoff = new Date("2026-08-30T02:00:00.000Z");
  const firestore = createRetentionFirestore();
  seedRetentionFixtures(firestore, cutoff);

  const result = await createFirestoreStore(firestore).cleanupExpired({ cutoff, limit: 100 });

  assert.deepEqual(result, {
    status: "complete",
    deletedTotal: 8,
    deletedByCollection: Object.fromEntries(TARGETS.map((name) => [name, 2])),
    hasMore: false,
    failedCollections: [],
  });
  for (const collection of TARGETS) {
    assert.equal(firestore.records.has(`${collection}/expired`), false);
    assert.equal(firestore.records.has(`${collection}/boundary`), false);
    assert.equal(firestore.records.has(`${collection}/future`), true);
    assert.equal(firestore.records.has(`${collection}/missing`), true);
    assert.equal(firestore.records.has(`${collection}/malformed`), true);
  }
  assert.equal(firestore.records.has("verificationEmailUids/stable"), true);
  assert.equal(firestore.records.has("electionMetadata/current"), true);
});

test("retention cleanup caps every collection and reports a backlog", async () => {
  const cutoff = new Date("2026-08-30T02:00:00.000Z");
  const firestore = createRetentionFirestore();
  for (const collection of TARGETS) {
    for (let index = 0; index < 101; index += 1) {
      firestore.records.set(`${collection}/${String(index).padStart(3, "0")}`, {
        deleteAfter: new Date(cutoff.getTime() - index),
      });
    }
  }

  const result = await createFirestoreStore(firestore).cleanupExpired({ cutoff, limit: 100 });

  assert.equal(result.deletedTotal, 400);
  assert.equal(result.hasMore, true);
  assert.deepEqual(
    firestore.queries,
    TARGETS.map((name) => ({
      name,
      filters: [{ field: "deleteAfter", operator: "<=", value: cutoff }],
      ordering: { field: "deleteAfter", direction: "asc" },
      maximum: 101,
    })),
  );
  for (const collection of TARGETS) {
    const remaining = [...firestore.records.keys()].filter((path) =>
      path.startsWith(`${collection}/`),
    );
    assert.equal(remaining.length, 1);
  }
});

test("retention cleanup continues after a collection failure without leaking its error", async () => {
  const cutoff = new Date("2026-08-30T02:00:00.000Z");
  const firestore = createRetentionFirestore({ failCollection: "verificationReferences" });
  seedRetentionFixtures(firestore, cutoff);

  const result = await createFirestoreStore(firestore).cleanupExpired({ cutoff, limit: 100 });

  assert.equal(result.status, "partial");
  assert.equal(result.deletedTotal, 6);
  assert.deepEqual(result.failedCollections, ["verificationReferences"]);
  assert.equal(JSON.stringify(result).includes("sensitive failure details"), false);
  assert.equal(firestore.records.has("verificationAttempts/expired"), false);
  assert.equal(firestore.records.has("verificationReferences/expired"), true);
  assert.equal(firestore.records.has("electionConfigurationAudits/expired"), false);
});
