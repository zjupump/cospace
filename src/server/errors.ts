export class AppError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "AppError";
  }
}

export function ensure(condition: unknown, status: number, message: string): asserts condition {
  if (!condition) throw new AppError(status, message);
}
