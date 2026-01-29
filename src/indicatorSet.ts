// src/indicatorSet.ts
import { createHash } from "crypto";

import { evaluateTrustDeclarationFromManifests } from "./trustDeclaration.js";
import { extractMetadata } from "./extractMetadata.js";
import { formatMetadata } from "./formatMetadata.js";
import { moveMetadataKeysToContent } from "./moveMetadataKeysToContent.js";
import { processAssertions } from "./processAssertions.js";
import { processHashedURIs } from "./hashUris.js";
import { getSignatureAlgoName } from "./getSignatureAlgoName.js";
import { parseDistinguishedName } from "./parseDistinguishedName.js";
import { getResultCodeValue, getAssertionStatus } from "./statuses.js";

type DN = Record<string, string>;

type ManifestEntry = {
  label: string | null;
  assertions: Record<string, unknown> | unknown[];
  claim_signature: {
    algorithm: string | null;
    serial_number: unknown;
    issuer: DN;
    subject: DN;
    validity: { not_before: unknown; not_after: unknown };
  };
  status: {
    signature: string;
    assertion: Record<string, string> | "unknown";
    content: string;
    trust: string;
  };
} & Record<string, unknown>;

type ValidationStatus = {
  isValid: boolean;
  error: unknown;
  validationErrors: string[];
  entries: Array<{
    code: string;
    message: string;
    url: string | null;
    severity: string;
  }>;
};

type IndicatorSet = {
  "@context": {
    "@vocab": string;
    extras: string;
  };
  asset_info: Record<string, unknown>;
  manifests: ManifestEntry[];
  content: Record<string, unknown>;
  metadata: Record<string, unknown>;
  "extras:validation_status"?: ValidationStatus;
  "extras:trust_declaration"?: {
    present: boolean;
    conforming: boolean;
    manifestLabel: string | null;
    reasons: string[];
    details?: Record<string, unknown>;
  };
};

type ValEntry = { code: string; message: string; url: string | null; severity: string };

function isTrustNxtManifestStore(manifestStore: any): boolean {
  return Boolean(manifestStore && Array.isArray(manifestStore.manifests));
}

function isC2paNodeJsonStore(manifestStore: any): boolean {
  const m = manifestStore?.manifests;
  return Boolean(m && typeof m === "object" && !Array.isArray(m));
}

function dnFromMaybeString(x: any): DN {
  if (!x) return {};
  if (typeof x === "string") {
    try {
      const parsed = parseDistinguishedName(x);
      // ✅ c2pa-node sometimes provides bare issuer strings like "Adobe Inc."
      // parseDistinguishedName intentionally ignores bare tokens, so fallback to CN.
      if (!parsed || Object.keys(parsed).length === 0) return { CN: x };
      return parsed;
    } catch {
      return { CN: x };
    }
  }
  if (typeof x === "object") return x as DN;
  return { CN: String(x) };
}

/**
 * Normalizes a trustnxt-style ValidationResult (or similar) into
 * extras:validation_status. For c2pa-node JSON stores, we do a richer
 * extraction elsewhere and should avoid overwriting it with an "empty" fallback.
 */
function normalizeValidationStatus(validationResult: any): ValidationStatus | null {
  if (!validationResult) return null;

  if (typeof validationResult?.toRepresentation === "function") {
    const entries = Array.isArray(validationResult.statusEntries)
      ? validationResult.statusEntries.map((entry: any) => ({
          code: String(entry.code ?? ""),
          message: String(entry.message ?? ""),
          url: entry.url ? String(entry.url) : null,
          severity: String(entry.severity ?? "info"),
        }))
      : [];

    return {
      isValid: Boolean(validationResult.isValid),
      error: validationResult.error ?? null,
      validationErrors: Array.isArray(validationResult.validationErrors)
        ? validationResult.validationErrors.map((err: any) => String(err))
        : [],
      entries,
    };
  }

  return null;
}

/**
 * Flattens c2pa-node validation_results nodes into a uniform entries list.
 * Accepts any node with { success|informational|failure: [] } arrays.
 */
function flattenC2paNodeValidationResultsToEntries(validationNode: any): ValEntry[] {
  const entries: ValEntry[] = [];

  const push = (severity: string, item: any) => {
    if (!item || typeof item !== "object") return;
    entries.push({
      code: String(item.code ?? ""),
      message: String(item.explanation ?? item.message ?? ""),
      url: item.url ? String(item.url) : null,
      severity,
    });
  };

  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;

    if (Array.isArray(node.success)) node.success.forEach((x: any) => push("success", x));
    if (Array.isArray(node.informational)) node.informational.forEach((x: any) => push("info", x));
    if (Array.isArray(node.failure)) node.failure.forEach((x: any) => push("failure", x));

    for (const v of Object.values(node)) walk(v);
  };

  walk(validationNode);
  return entries;
}

/**
 * Spec-neutral selection: choose the most informative validation node across the store.
 * We score by volume, weighting failures higher because they’re decisive.
 */
function scoreValidationNode(node: any): number {
  if (!node || typeof node !== "object") return -1;

  const hasArrays =
    Array.isArray(node.success) || Array.isArray(node.informational) || Array.isArray(node.failure);

  if (!hasArrays) return -1;

  const successN = Array.isArray(node.success) ? node.success.length : 0;
  const infoN = Array.isArray(node.informational) ? node.informational.length : 0;
  const failN = Array.isArray(node.failure) ? node.failure.length : 0;

  return successN + infoN + failN * 3;
}

function collectAllValidationNodes(manifestsObj: Record<string, any>): any[] {
  const nodes: any[] = [];

  const add = (n: any) => {
    if (n && typeof n === "object") nodes.push(n);
  };

  const collectFromManifest = (m: any) => {
    const vr = m?.validation_results;
    if (vr?.activeManifest) add(vr.activeManifest);

    // ingredient validation_results live under each ingredient entry
    const ingredients = Array.isArray(m?.ingredients) ? m.ingredients : [];
    for (const ing of ingredients) {
      const ivr = ing?.validation_results;
      if (ivr?.activeManifest) add(ivr.activeManifest);

      // deltas often carry the richest failure info
      const deltas = Array.isArray(ing?.ingredientDeltas) ? ing.ingredientDeltas : [];
      for (const d of deltas) if (d?.validationDeltas) add(d.validationDeltas);
    }

    const ingredientDeltas = Array.isArray(m?.ingredientDeltas) ? m.ingredientDeltas : [];
    for (const d of ingredientDeltas) if (d?.validationDeltas) add(d.validationDeltas);
  };

  for (const m of Object.values(manifestsObj)) collectFromManifest(m);
  return nodes;
}

function pickBestValidationNode(nodes: any[]): any | null {
  let best: any | null = null;
  let bestScore = -1;

  for (const n of nodes) {
    const s = scoreValidationNode(n);
    if (s > bestScore) {
      bestScore = s;
      best = n;
    }
  }
  return best;
}

function mapC2paNodeAssertionsToTrustNxtShape(assertions: any): { assertions: any[] } {
  if (!Array.isArray(assertions)) return { assertions: [] };
  return {
    assertions: assertions.map((a: any) => {
      const label = a?.label ?? "unknown";
      const data = a?.data && typeof a.data === "object" ? a.data : {};
      return { label, ...data };
    }),
  };
}

function normalizeC2paNodeState(x: any): "valid" | "invalid" | "" {
  const raw = String(x ?? "").trim().toLowerCase();
  if (raw === "valid") return "valid";
  if (raw === "invalid") return "invalid";
  return "";
}

async function generateIndicatorSet(
  manifestStore: any,
  validationResult: any,
  fileBuffer: Buffer | undefined | null
): Promise<IndicatorSet> {
  const indicatorSet: IndicatorSet = {
    "@context": {
      "@vocab": "https://jpeg.org/jpegtrust",
      extras: "https://jpeg.org/jpegtrust/extras",
    },
    asset_info: {},
    manifests: [],
    content: {},
    metadata: {},
  };

  if (fileBuffer) {
    const fHash = createHash("sha256").update(fileBuffer).digest("base64");
    indicatorSet.asset_info = { alg: "sha256", hash: fHash };
  }

  indicatorSet.metadata = await extractMetadata(fileBuffer as any);
  formatMetadata(indicatorSet.metadata);
  moveMetadataKeysToContent(indicatorSet as any);

  // --- trustnxt/c2pa-ts shape ---
  if (isTrustNxtManifestStore(manifestStore)) {
    const valStatusCodes = validationResult?.toRepresentation ? validationResult.toRepresentation() : null;

    for (const manifest of manifestStore.manifests) {
      const claimKey = manifest.claim?.version === 1 ? "claim.v2" : "claim";

      indicatorSet.manifests.push({
        label: manifest.label || null,
        assertions: processAssertions(manifest.assertions),
        [claimKey]: {
          "dc:title": manifest.claim?.title || null,
          instanceID: manifest.claim?.instanceID || null,
          claim_generator: manifest.claim?.claimGeneratorInfo
            ? manifest.claim.claimGeneratorInfo
            : manifest.claim?.claimGeneratorName || null,
          alg: manifest.claim?.defaultAlgorithm || null,
          signature: manifest.claim?.signatureRef || null,
          created_assertions: processHashedURIs(manifest.claim?.assertions),
          gathered_assertions: processHashedURIs(manifest.claim?.gatheredAssertions),
          redacted_assertions: processHashedURIs(manifest.claim?.redactedAssertions),
        },
        claim_signature: {
          algorithm: getSignatureAlgoName(manifest.signature?.signatureData?.algorithm) || null,
          serial_number: manifest.signature?.signatureData?.certificate?.serialNumber || null,
          issuer: dnFromMaybeString(manifest.signature?.signatureData?.certificate?.issuer),
          subject: dnFromMaybeString(manifest.signature?.signatureData?.certificate?.subject),
          validity: {
            not_before: manifest.signature?.signatureData?.certificate?.notBefore || null,
            not_after: manifest.signature?.signatureData?.certificate?.notAfter || null,
          },
        },
        status: {
          signature: valStatusCodes ? getResultCodeValue(valStatusCodes, "claimSignature.") || "unknown" : "unknown",
          assertion: valStatusCodes ? getAssertionStatus(valStatusCodes) || "unknown" : "unknown",
          content: valStatusCodes
            ? getResultCodeValue(valStatusCodes, "assertion.dataHash") ||
              getResultCodeValue(valStatusCodes, "assertion.hash.bmff") ||
              "unknown"
            : "unknown",
          trust: valStatusCodes ? getResultCodeValue(valStatusCodes, "signingCredential") || "" : "",
        },
      });
    }

    // If provided, use normalized trustnxt validation status
    const normalized = normalizeValidationStatus(validationResult);
    if (normalized) indicatorSet["extras:validation_status"] = normalized;
  }

  // --- c2pa-node JSON store shape ---
  else if (isC2paNodeJsonStore(manifestStore)) {
    const manifestsObj: Record<string, any> = manifestStore?.manifests ?? {};
    const state = normalizeC2paNodeState(manifestStore?.validation_state);

    for (const [label, m] of Object.entries(manifestsObj) as Array<[string, any]>) {
      const sigInfo = m?.signature_info ?? {};
      const claimGenerator = m?.claim_generator_info ?? m?.claim_generator ?? null;
      const claimKey = Number(m?.claim_version) === 1 ? "claim.v2" : "claim";

      const claimBlock = {
        "dc:title": m?.title ?? null,
        instanceID: m?.instance_id ?? null,
        claim_generator: claimGenerator,
        alg: null,
        signature: null,
        created_assertions: [],
        gathered_assertions: [],
        redacted_assertions: [],
      };

      const assertionsWrapped = mapC2paNodeAssertionsToTrustNxtShape(m?.assertions);
      const assertionsProcessed = processAssertions(assertionsWrapped as any);

      indicatorSet.manifests.push({
        label: label || m?.label || null,
        assertions: assertionsProcessed,
        [claimKey]: claimBlock,
        claim_signature: {
          algorithm: sigInfo?.alg ? String(sigInfo.alg) : null,
          serial_number: sigInfo?.cert_serial_number ?? null,
          issuer: dnFromMaybeString(sigInfo?.issuer),
          subject: dnFromMaybeString(sigInfo?.common_name),
          validity: {
            not_before: sigInfo?.time ?? null,
            not_after: null,
          },
        },
        status: {
          signature: state === "valid" ? "validated" : state === "invalid" ? "invalid" : "unknown",
          assertion: "unknown",
          content: "unknown",
          trust: "unknown",
        },
      });
    }

    // ✅ Pull the richest validation node anywhere in the store, not just the top-level state.
    const bestNode = pickBestValidationNode(collectAllValidationNodes(manifestsObj));
    const entries: ValEntry[] = bestNode ? flattenC2paNodeValidationResultsToEntries(bestNode) : [];
    const hasFailure = entries.some((e) => e.severity === "failure");

    indicatorSet["extras:validation_status"] = {
      isValid: entries.length > 0 ? !hasFailure : state === "valid",
      error: null,
      validationErrors: [],
      entries,
    };

    const td = evaluateTrustDeclarationFromManifests(
      indicatorSet.manifests.map((m) => ({
        label: m.label ?? null,
        assertions: (m as any).assertions ?? {},
      }))
    );

    indicatorSet["extras:trust_declaration"] = {
      present: td.present,
      conforming: td.conforming,
      manifestLabel: td.manifestLabel,
      reasons: td.reasons,
      details: td.details ?? {},
    };
  };
  
  return indicatorSet;
}

export { generateIndicatorSet };
