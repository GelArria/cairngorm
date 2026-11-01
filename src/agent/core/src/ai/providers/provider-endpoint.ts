export function providerEndpoint(value: string): URL {
  const url = new URL(value);
  if (
    !["http:", "https:", "ws:", "wss:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Provider endpoint must use HTTP(S) or WS(S), without credentials, query or fragment",
    );
  }
  return url;
}
