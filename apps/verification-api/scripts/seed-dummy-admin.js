import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

import {
  readDummyReviewerConfig,
  seedDummyAdmin,
} from "./dummy-reviewer.js";

const config = readDummyReviewerConfig(process.env);
const app = initializeApp({ projectId: config.projectId }, "dummy-admin-seed");

try {
  const admin = await seedDummyAdmin(getAuth(app), config);
  console.log(`Seeded ${admin.email} in the local Firebase Auth emulator.`);
} finally {
  await deleteApp(app);
}
