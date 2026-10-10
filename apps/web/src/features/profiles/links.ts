export function isProfileUsername(username: string): boolean {
  return (
    /^[a-zA-Z0-9_.]{1,30}$/.test(username) &&
    username !== "." &&
    username !== ".."
  );
}

export function profilePath(username: string): string {
  return `/profiles/${encodeURIComponent(username)}`;
}
