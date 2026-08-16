const DUMMY_REVIEWER = Object.freeze({
  uid: "local-dummy-reviewer",
  email: "dummy.reviewer@local.test",
});

function validateAuthEmulatorHost(value) {
  let url;
  try {
    url = new URL(`http://${value}`);
  } catch {
    throw new Error("FIREBASE_AUTH_EMULATOR_HOST must be a loopback host and port");
  }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (
    !loopback ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("FIREBASE_AUTH_EMULATOR_HOST must be a loopback host and port");
  }
  return value;
}

export function readDummyReviewerConfig(environment) {
  if (environment.NODE_ENV !== "development") {
    throw new Error("Dummy reviewer seeding requires NODE_ENV=development");
  }
  if (environment.FIREBASE_PROJECT_ID !== "demo-department-voting") {
    throw new Error("Dummy reviewer seeding requires demo-department-voting");
  }

  const password = environment.DUMMY_REVIEWER_PASSWORD;
  if (!password || password.length < 12) {
    throw new Error("DUMMY_REVIEWER_PASSWORD must contain at least 12 characters");
  }

  return {
    ...DUMMY_REVIEWER,
    password,
    projectId: environment.FIREBASE_PROJECT_ID,
    authEmulatorHost: validateAuthEmulatorHost(
      environment.FIREBASE_AUTH_EMULATOR_HOST,
    ),
  };
}

export async function seedDummyReviewer(auth, config) {
  const user = {
    email: config.email,
    password: config.password,
    emailVerified: true,
    disabled: false,
  };

  try {
    await auth.getUser(config.uid);
    await auth.updateUser(config.uid, user);
  } catch (error) {
    if (error?.code !== "auth/user-not-found") throw error;
    await auth.createUser({ uid: config.uid, ...user });
  }

  await auth.setCustomUserClaims(config.uid, {
    verificationReviewer: true,
    verificationAdmin: false,
    developmentFixture: true,
  });

  return { uid: config.uid, email: config.email };
}
