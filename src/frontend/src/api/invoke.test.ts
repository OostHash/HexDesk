import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, expect, it } from "vitest";
import { AppError, invoke, toAppError } from "./invoke";

afterEach(() => {
  clearMocks();
});

const structured = {
  source: "market",
  kind: "denied",
  code: "market.denied",
  message: "Order could not be created: warframe.market answered 401",
  fields: { status: "401" },
  causes: ['response: {"error":"unauthorized"}'],
};

it("a structured command error becomes an AppError with its details", async () => {
  mockIPC(() => {
    // Tauri rejects with the serialized backend error, which is a plain object.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw structured;
  });
  const error = await invoke("wfm_get_orders").catch((e: unknown) => e);
  expect(error).toBeInstanceOf(AppError);
  const app = error as AppError;
  expect(app.message).toBe(structured.message);
  expect(app.code).toBe("market.denied");
  expect(app.source).toBe("market");
  expect(app.fields).toEqual({ status: "401" });
  expect(app.causes).toEqual(structured.causes);
});

it("String(error) still reads the message, so the 401 session refresh keeps working", () => {
  const error = toAppError(structured);
  expect(String(error)).toBe(structured.message);
  expect(String(error).includes("401")).toBe(true);
});

it("a plain string error keeps its text and has no code", async () => {
  mockIPC(() => {
    // Commands that still return `Result<_, String>` reject with a bare string.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw "Something failed";
  });
  const error = (await invoke("wfm_get_orders").catch((e: unknown) => e)) as AppError;
  expect(error).toBeInstanceOf(AppError);
  expect(error.message).toBe("Something failed");
  expect(error.code).toBeUndefined();
  expect(error.causes).toEqual([]);
});

it("an Error is kept as the cause", () => {
  const original = new Error("boom");
  const error = toAppError(original);
  expect(error.message).toBe("boom");
  expect(error.cause).toBe(original);
  expect(toAppError(error)).toBe(error);
});
