export async function gitAuthorAvatarUrl(email?: string): Promise<string | undefined> {
  const normalized = email?.trim().toLowerCase();
  if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return;
  }
  const github = /^(?:(\d+)\+)?([a-z0-9]+(?:-[a-z0-9]+)*)@users\.noreply\.github\.com$/.exec(
    normalized,
  );
  if (github) {
    return github[1]
      ? `https://avatars.githubusercontent.com/u/${github[1]}?s=64`
      : `https://github.com/${github[2]}.png?size=64`;
  }
  // Gravatar accepts SHA-256: only the normalized hash, never the raw email, leaves the app.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `https://www.gravatar.com/avatar/${hash}?s=64&d=404`;
}
