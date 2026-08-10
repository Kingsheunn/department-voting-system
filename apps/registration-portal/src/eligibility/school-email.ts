export const SCHOOL_EMAIL_DOMAIN = "students.unilorin.edu.ng";

export type SchoolEmailValidation =
  | { ok: true; email: string }
  | { ok: false; code: "required" | "invalid-format" | "wrong-domain" };

export const validateSchoolEmail = (value: string): SchoolEmailValidation => {
  const email = value.trim().toLowerCase();

  if (!email) {
    return { ok: false, code: "required" };
  }

  if (!/^[^\s@]+@[^\s@]+$/.test(email)) {
    return { ok: false, code: "invalid-format" };
  }

  const domain = email.slice(email.lastIndexOf("@") + 1);
  if (domain !== SCHOOL_EMAIL_DOMAIN) {
    return { ok: false, code: "wrong-domain" };
  }

  return { ok: true, email };
};
