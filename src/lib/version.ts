// Semantic-version comparison for the in-app update check. Compares the numeric major.minor.patch core;
// a build carrying a prerelease tag (e.g. 1.2.0-beta.1) sorts BELOW the same core release, matching SemVer
// precedence (a prerelease is "older" than its final release). Tolerant of a leading "v" and missing
// segments. Pure → unit-tested. Replaces an ad-hoc parseInt compare that mis-ranked any non-numeric tag.

interface ParsedVersion { core: [number, number, number]; prerelease: string }

function parseVersion(v: string): ParsedVersion {
  const cleaned = String(v ?? "").trim().replace(/^v/i, "");
  const [coreStr = "", ...preParts] = cleaned.split("-");
  const nums = coreStr.split(".").map((n) => parseInt(n, 10));
  const core: [number, number, number] = [
    Number.isFinite(nums[0]) ? nums[0] : 0,
    Number.isFinite(nums[1]) ? nums[1] : 0,
    Number.isFinite(nums[2]) ? nums[2] : 0,
  ];
  return { core, prerelease: preParts.join("-") };
}

// Returns 1 if a > b, -1 if a < b, 0 if equal.
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] > pb.core[i] ? 1 : -1;
  }
  if (pa.prerelease === pb.prerelease) return 0;
  // Equal cores: a build WITHOUT a prerelease tag outranks one with it.
  if (!pa.prerelease) return 1;
  if (!pb.prerelease) return -1;
  return pa.prerelease > pb.prerelease ? 1 : -1;
}

// "Is `latest` strictly newer than `current`?" — the update-available decision.
export function isNewerVersion(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0;
}
