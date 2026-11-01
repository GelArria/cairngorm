export function previewAddress(value: string): string {
  const input = value.trim();
  if (!input || input.length > 8192) {
    throw new Error("Enter an HTTP or HTTPS address");
  }
  const local = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])(?=[:/]|$)/i.test(input);
  const address = /^[a-z][a-z\d+.-]*:\/\//i.test(input)
    ? input
    : /^(?:localhost|[^/:\s]+\.\w+|\[[^\]]+\])(?::\d+)?(?:\/|$)/i.test(input)
      ? `${local ? "http" : "https"}://${input}`
      : input;
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new Error("Invalid browser address");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password
  ) {
    throw new Error("Only HTTP and HTTPS addresses without credentials are supported");
  }
  return url.href;
}
