// Reasonable-match for bank-resolved account names vs the doctor's
// profile name. The exact display order, middle names, and initials
// vary between banks, so this tolerates common reorderings:
//
//   profile: "ISAIAH ADELEKE"
//   accept : "ADELEKE ISAIAH", "ISAIAH A ADELEKE", "ADELEKE I"
//   reject : "JOHN SMITH", "MARY JOHNSON"

function tokens(name: string): string[] {
  return name
    .toUpperCase()
    .replace(/[^A-Z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function fullTokens(name: string): string[] {
  return tokens(name).filter((t) => t.length > 1);
}

function initials(name: string): string[] {
  return tokens(name)
    .filter((t) => t.length === 1)
    .map((t) => t);
}

export function isReasonableNameMatch(
  profileName: string | null | undefined,
  resolvedName: string | null | undefined,
): boolean {
  if (!profileName || !resolvedName) return false;
  const pFull = fullTokens(profileName);
  const rFull = fullTokens(resolvedName);
  const rInit = initials(resolvedName);
  if (pFull.length === 0 || rFull.length === 0) return false;

  // Count profile tokens that appear in the resolved name (either as a
  // full token, or — for a profile token — as a single-letter initial
  // matching its first character).
  const rFullSet = new Set(rFull);
  const rInitSet = new Set(rInit);
  let matched = 0;
  let initialOnly = 0;
  for (const t of pFull) {
    if (rFullSet.has(t)) {
      matched += 1;
    } else if (rInitSet.has(t[0])) {
      initialOnly += 1;
    }
  }

  // Accept when at least two profile tokens are present in full, OR
  // when the profile has 2 tokens and the resolved name carries one
  // full + the other as an initial (e.g. "ADELEKE I").
  if (matched >= 2) return true;
  if (pFull.length >= 2 && matched >= 1 && matched + initialOnly >= 2) return true;

  return false;
}
