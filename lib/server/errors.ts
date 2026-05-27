export class AuthError extends Error {
  status = 401;
  code = "unauthenticated";

  constructor(message = "Authentication required.") {
    super(message);
    this.name = "AuthError";
  }
}

export function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError;
}
