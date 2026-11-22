import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { CommandArgs, CommandName, CommandResult } from "./commands";

/** The structured error a backend command fails with (`hexdesk-diag`'s `DiagError`). */
export interface CommandError {
  source: string;
  kind: string;
  /** `source.kind`, for example `market.denied`. */
  code: string;
  message: string;
  fields: Record<string, string>;
  causes: string[];
}

/**
 * Every failed command rejects with an `AppError`. Commands that already return
 * a structured error fill in `code`, `source` and the details; older commands
 * that still fail with a plain string only carry the message.
 */
export class AppError extends Error {
  readonly code: string | undefined;
  readonly source: string | undefined;
  readonly kind: string | undefined;
  readonly fields: Record<string, string>;
  readonly causes: string[];

  constructor(message: string, detail?: Partial<CommandError>, options?: ErrorOptions) {
    super(message, options);
    this.name = "AppError";
    this.code = detail?.code;
    this.source = detail?.source;
    this.kind = detail?.kind;
    this.fields = detail?.fields ?? {};
    this.causes = detail?.causes ?? [];
  }

  /** The message alone, so `String(error)` reads the same as before. */
  override toString(): string {
    return this.message;
  }
}

function isCommandError(value: unknown): value is CommandError {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as CommandError).message === "string" &&
    typeof (value as CommandError).code === "string"
  );
}

/** Normalises whatever a command rejected with into an `AppError`. */
export function toAppError(raw: unknown): AppError {
  if (raw instanceof AppError) return raw;
  if (isCommandError(raw)) return new AppError(raw.message, raw);
  if (raw instanceof Error) return new AppError(raw.message, undefined, { cause: raw });
  return new AppError(typeof raw === "string" ? raw : JSON.stringify(raw));
}

/** Typed wrapper around Tauri's invoke. The only place the app calls IPC. */
export function invoke<C extends CommandName>(
  command: C,
  ...args: CommandArgs<C> extends undefined ? [] : [CommandArgs<C>]
): Promise<CommandResult<C>> {
  return tauriInvoke<CommandResult<C>>(command, args[0]).catch((raw: unknown) => {
    throw toAppError(raw);
  });
}
