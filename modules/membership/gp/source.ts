/** Demo import URLs are not evidence links and must never be offered for verification. */
export function employeeSource(url: string | null): { url: string | null; placeholder: boolean } {
  if (!url) return { url: null, placeholder: false };
  try {
    const parsed = new URL(url);
    if (["example.org", "example.com", "example.net"].some(domain => parsed.hostname.toLowerCase() === domain || parsed.hostname.toLowerCase().endsWith(`.${domain}`))) {
      return { url: null, placeholder: true };
    }
    return parsed.protocol === "https:" ? { url, placeholder: false } : { url: null, placeholder: false };
  } catch { return { url: null, placeholder: false }; }
}
