import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

import {
  readDummyReviewerConfig,
  seedDummyReviewer,
} from "./dummy-reviewer.js";

const config = readDummyReviewerConfig(process.env);
const app = initializeApp({ projectId: config.projectId }, "dummy-reviewer-seed");

try {
  const reviewer = await seedDummyReviewer(getAuth(app), config);
  console.log(`Seeded ${reviewer.email} in the local Firebase Auth emulator.`);
} finally {
  await deleteApp(app);
}
