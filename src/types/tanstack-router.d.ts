// router-core >= 1.171.34 tipa o erro dos errorComponent como unknown; o app assume Error.
export {};

declare module "@tanstack/router-core" {
  interface ErrorBoundaryTypes {
    error: Error;
  }
}
