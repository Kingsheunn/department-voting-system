import { describe, expect, it } from "vitest";

import { validateSchoolEmail } from "./school-email";

describe("validateSchoolEmail", () => {
  it("normalizes an address on the permitted school domain", () => {
    expect(validateSchoolEmail("  Student.One@Students.Unilorin.Edu.Ng  ")).toEqual({
      ok: true,
      email: "student.one@students.unilorin.edu.ng",
    });
  });

  it("rejects an address from another domain", () => {
    expect(validateSchoolEmail("student@gmail.com")).toEqual({
      ok: false,
      code: "wrong-domain",
    });
  });

  it("rejects a lookalike suffix domain", () => {
    expect(validateSchoolEmail("student@students.unilorin.edu.ng.attacker.test")).toEqual({
      ok: false,
      code: "wrong-domain",
    });
  });

  it("rejects a subdomain because the allowlist is exact", () => {
    expect(validateSchoolEmail("student@dept.students.unilorin.edu.ng")).toEqual({
      ok: false,
      code: "wrong-domain",
    });
  });

  it("rejects malformed or empty addresses", () => {
    expect(validateSchoolEmail("@students.unilorin.edu.ng")).toEqual({
      ok: false,
      code: "invalid-format",
    });
    expect(validateSchoolEmail(" ")).toEqual({
      ok: false,
      code: "required",
    });
  });
});
