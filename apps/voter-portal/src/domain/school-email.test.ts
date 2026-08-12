import { describe, expect, it } from "vitest";

import { validateSchoolEmail } from "./school-email";

describe("validateSchoolEmail", () => {
  it("normalizes an address on the exact school domain", () => {
    expect(validateSchoolEmail(" Student.One@Students.Unilorin.Edu.Ng ")).toEqual({
      ok: true,
      email: "student.one@students.unilorin.edu.ng",
    });
  });

  it.each([
    ["", "required"],
    ["not-an-email", "invalid-format"],
    ["student@gmail.com", "wrong-domain"],
    ["student@dept.students.unilorin.edu.ng", "wrong-domain"],
    ["student@students.unilorin.edu.ng.attacker.test", "wrong-domain"],
  ])("rejects %j with %s", (email, code) => {
    expect(validateSchoolEmail(email)).toEqual({ ok: false, code });
  });
});
