// src/trustDeclaration.ts

type TrustDeclarationEval = {
  present: boolean;              // at least one manifest is a Trust Declaration *candidate* (created-only actions)
  conforming: boolean;           // meets §4.4.4 requirements we can observe from extracted data
  manifestLabel: string | null;  // which manifest was evaluated as best candidate (null if none)
  reasons: string[];             // why non-conforming / missing
  details?: {
    digitalSourceType?: string | null;
    createdTime?: string | null;
    hashAssertionLabel?: string | null; // one of c2pa.hash.data|c2pa.hash.boxes|c2pa.hash.bmff.v2
    actionCount?: number;
    actionsSeen?: string[];
  };
};

function pickFirstString(x: any, keys: string[]): string | null {
  for (const k of keys) {
    const v = x?.[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

function asArray(x: any): any[] {
  return Array.isArray(x) ? x : [];
}

function getActions(assertions: Record<string, any>): any[] {
  // Common shapes we might see post-processAssertions():
  // - assertions["c2pa.actions.v2"] = { actions: [...] }
  // - assertions["c2pa.actions"]    = { actions: [...] }
  const a2 = assertions?.["c2pa.actions.v2"]?.actions;
  const a1 = assertions?.["c2pa.actions"]?.actions;
  return asArray(a2 ?? a1);
}

function getHashAssertionLabel(assertions: Record<string, any>): string | null {
  // §4.4.4: either c2pa.hash.data OR c2pa.hash.boxes OR c2pa.hash.bmff.v2 (exactly one, depending on asset/container)
  const candidates = ["c2pa.hash.data", "c2pa.hash.boxes", "c2pa.hash.bmff.v2"];
  const present = candidates.filter((k) => assertions?.[k] != null);
  if (present.length === 1) return present[0];
  return null;
}

function isCreatedOnlyActions(actions: any[]): boolean {
  if (actions.length !== 1) return false;
  return String(actions[0]?.action ?? "") === "c2pa.created";
}

export function evaluateTrustDeclarationFromManifests(
  manifests: Array<{ label?: string | null; assertions?: any }>
): TrustDeclarationEval {
  // Strict spec-aligned approach:
  // - "present" means: at least one manifest has an actions assertion with exactly one action: c2pa.created.
  // - Only such manifests are "candidates" for Trust Declaration evaluation.

  // Keep a best-effort diagnostic view for non-candidate cases (no label attribution).
  let bestDiag: { score: number; details: TrustDeclarationEval["details"] } | null = null;

  // Candidate tracking
  let bestCandidate: { score: number; label: string | null; eval: TrustDeclarationEval } | null = null;

  for (const m of manifests) {
    const label = (m?.label ?? null) as string | null;
    const assertions =
      m?.assertions && typeof m.assertions === "object"
        ? (m.assertions as Record<string, any>)
        : {};

    const actions = getActions(assertions);
    const actionsSeen = actions.map((a) => String(a?.action ?? "")).filter(Boolean);

    // Build diagnostics (used even when no strict candidate exists)
    const createdAction = actions.length === 1 ? actions[0] : null;

    // For diagnostics, try to read digitalSourceType/time from either the action or action.parameters
    const diagCreatedTime =
      pickFirstString(createdAction, ["when", "created", "time", "timestamp"]) ??
      pickFirstString(createdAction?.parameters, ["when", "created", "time", "timestamp"]);

    const diagDigitalSourceType =
      pickFirstString(createdAction, ["digitalSourceType"]) ??
      pickFirstString(createdAction?.parameters, ["digitalSourceType"]);

    const diagHashLabel = getHashAssertionLabel(assertions);

    // Simple diagnostic score: prefer manifests that look "closest" to created-only + include fields
    const diagScore =
      (actions.length === 1 ? 2 : 0) +
      (actionsSeen.includes("c2pa.created") ? 5 : 0) +
      (diagDigitalSourceType ? 1 : 0) +
      (diagCreatedTime ? 1 : 0) +
      (diagHashLabel ? 1 : 0);

    const diagDetails: TrustDeclarationEval["details"] = {
      digitalSourceType: diagDigitalSourceType ?? null,
      createdTime: diagCreatedTime ?? null,
      hashAssertionLabel: diagHashLabel ?? null,
      actionCount: actions.length,
      actionsSeen,
    };

    if (!bestDiag || diagScore > bestDiag.score) bestDiag = { score: diagScore, details: diagDetails };

    // ---- Strict candidate gate ----
    // Must have actions assertion and it must be created-only (exactly one action: c2pa.created)
    if (!isCreatedOnlyActions(actions)) continue;

    // Now we evaluate conformance requirements we can observe
    const reasons: string[] = [];

    const created = actions[0];

    const createdTime =
      pickFirstString(created, ["when", "created", "time", "timestamp"]) ??
      pickFirstString(created?.parameters, ["when", "created", "time", "timestamp"]);

    const digitalSourceType =
      pickFirstString(created, ["digitalSourceType"]) ??
      pickFirstString(created?.parameters, ["digitalSourceType"]);

    if (!createdTime) reasons.push("c2pa.created missing creation time (expected action.when or equivalent)");
    if (!digitalSourceType) reasons.push("c2pa.created missing digitalSourceType");

    const hashAssertionLabel = getHashAssertionLabel(assertions);
    if (!hashAssertionLabel) {
      const candidates = ["c2pa.hash.data", "c2pa.hash.boxes", "c2pa.hash.bmff.v2"];
      const present = candidates.filter((k) => assertions?.[k] != null);
      if (present.length === 0) {
        reasons.push(
          "missing hard binding hash assertion (expected one of c2pa.hash.data|c2pa.hash.boxes|c2pa.hash.bmff.v2)"
        );
      } else {
        reasons.push(
          `hard binding hash assertion must be exactly one of c2pa.hash.data|c2pa.hash.boxes|c2pa.hash.bmff.v2 (found ${present.length}: ${present.join(", ")})`
        );
      }
    }

    // Candidate score: prefer those that satisfy more of §4.4.4 observable requirements
    const score =
      10 + // base for passing strict candidate gate (created-only actions)
      (digitalSourceType ? 3 : 0) +
      (createdTime ? 3 : 0) +
      (hashAssertionLabel ? 4 : 0);

    const currentEval: TrustDeclarationEval = {
      present: true,
      conforming: reasons.length === 0,
      manifestLabel: label,
      reasons,
      details: {
        digitalSourceType: digitalSourceType ?? null,
        createdTime: createdTime ?? null,
        hashAssertionLabel: hashAssertionLabel ?? null,
        actionCount: actions.length,
        actionsSeen,
      },
    };

    if (!bestCandidate || score > bestCandidate.score) {
      bestCandidate = { score, label, eval: currentEval };
    }
  }

  // No manifests at all
  if (!manifests || manifests.length === 0) {
    return {
      present: false,
      conforming: false,
      manifestLabel: null,
      reasons: ["no manifests available to evaluate"],
    };
  }

  // No strict candidate → clean “absent” result (no misleading manifestLabel)
  if (!bestCandidate) {
    return {
      present: false,
      conforming: false,
      manifestLabel: null,
      reasons: [
        "no Trust Declaration candidate found (requires exactly one action and it must be c2pa.created)",
      ],
      details: bestDiag?.details,
    };
  }

  return bestCandidate.eval;
}
