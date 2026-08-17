const DUMMY_REVIEWER = Object.freeze({
  uid: "local-dummy-reviewer",
  email: "dummy.reviewer@local.test",
});
const DUMMY_ADMIN = Object.freeze({
  uid: "local-dummy-admin",
  email: "dummy.admin@local.test",
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

async function seedDummyStaff(auth, config, identity, claims) {
  const user = {
    email: identity.email,
    password: config.password,
    emailVerified: true,
    disabled: false,
  };

  try {
    await auth.getUser(identity.uid);
    await auth.updateUser(identity.uid, user);
  } catch (error) {
    if (error?.code !== "auth/user-not-found") throw error;
    await auth.createUser({ uid: identity.uid, ...user });
  }

  await auth.setCustomUserClaims(identity.uid, {
    ...claims,
    developmentFixture: true,
  });

  return identity;
}

export function seedDummyReviewer(auth, config) {
  return seedDummyStaff(auth, config, DUMMY_REVIEWER, {
    verificationReviewer: true,
    verificationAdmin: false,
  });
}

export function seedDummyAdmin(auth, config) {
  return seedDummyStaff(auth, config, DUMMY_ADMIN, {
    verificationReviewer: false,
    verificationAdmin: true,
  });
}
