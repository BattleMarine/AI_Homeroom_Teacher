import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export class StudentBindingError extends Error {
  readonly code = "STUDENT_BINDING_INVALID";
  readonly status = 401;
  constructor() { super("학생 선택이 만료되었거나 유효하지 않습니다. 학생을 다시 선택해주세요."); }
}

/** 로컬 대상 결속일 뿐 인증이 아니다. 기록·비밀키는 클라이언트나 모델에 반환하지 않는다. */
export function createStudentBinding(now: () => number = Date.now) {
  const secret = randomBytes(32);
  const sign = (value: string) => createHmac("sha256", secret).update(value).digest();
  return {
    issue(studentId: string) {
      const expiresAt = now() + 60 * 60 * 1000;
      const payload = Buffer.from(JSON.stringify({ studentId, expiresAt, nonce: randomBytes(16).toString("hex") })).toString("base64url");
      return { bindingToken: `${payload}.${sign(payload).toString("base64url")}`, studentId, expiresAt: new Date(expiresAt).toISOString() };
    },
    verify(token: string): string {
      if (typeof token !== "string" || token.length > 1000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new StudentBindingError();
      const [payload, signature] = token.split(".");
      const supplied = Buffer.from(signature, "base64url");
      const expected = sign(payload);
      if (supplied.length !== expected.length || supplied.toString("base64url") !== signature || !timingSafeEqual(supplied, expected)) throw new StudentBindingError();
      try {
        const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        if (typeof value.studentId !== "string" || !value.studentId || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= now()) throw new StudentBindingError();
        return value.studentId;
      } catch { throw new StudentBindingError(); }
    },
  };
}
export type StudentBinding = ReturnType<typeof createStudentBinding>;
