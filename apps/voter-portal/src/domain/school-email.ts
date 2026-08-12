export type SchoolEmailValidation =
  | { ok: true; email: string }
  | { ok: false; code: "required" | "invalid-format" | "wrong-domain" };

const SCHOOL_EMAIL_DOMAIN = "students.unilorin.edu.ng";
const SIMPLE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;

export const validateSchoolEmail = (value: string): SchoolEmailValidation => {
  const email = value.trim().toLowerCase();

  if (!email) return { ok: false, code: "required" };
  if (!SIMPLE_EMAIL_PATTERN.test(email)) return { ok: false, code: "invalid-format" };

  const domain = email.slice(email.lastIndexOf("@") + 1);
  if (domain !== SCHOOL_EMAIL_DOMAIN) return { ok: false, code: "wrong-domain" };

  return { ok: true, email };
};
