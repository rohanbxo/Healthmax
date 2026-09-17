/**
 * The access token lives in memory for the lifetime of the tab and nowhere else
 * — no `localStorage`, no `sessionStorage`, no cookie written from JS
 * (SPEC.md §11). A reload restores the session through `POST /auth/refresh`,
 * which reads the httpOnly refresh cookie the browser holds.
 */

let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function clearAccessToken(): void {
  accessToken = null;
}

export function hasAccessToken(): boolean {
  return accessToken !== null;
}
