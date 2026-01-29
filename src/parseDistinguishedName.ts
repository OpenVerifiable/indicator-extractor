export function parseDistinguishedName(dnString: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!dnString || typeof dnString !== "string") return result;

  const parts = dnString
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq === -1) continue; // ✅ ignore bare tokens like "SSL.com"
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) result[key] = value;
  }

  return result;
}
