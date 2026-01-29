import { Reader, type SourceAsset } from "@contentauth/c2pa-node";
import { extractMetadata } from "./extractMetadata.js";
import { formatMetadata } from "./formatMetadata.js";
import { generateIndicatorSet } from "./indicatorSet.js";

export interface C2PAManifestInfo {
  hasManifest: boolean;
  manifestCount: number;
  validationStatus: "valid" | "invalid" | "error" | "";
  manifests: any[];
  error: string | null;
  fileFormat: "JPEG" | "PNG" | "BMFF" | "unknown" | "";
  indicatorSet: any;
  manifestStore?: any;
}

const DEFAULT_READER_SETTINGS = {
  verify: {
    verify_after_reading: false,
    verify_trust: true,
  },
} as const;

function detectFileFormat(buf: Buffer): "JPEG" | "PNG" | "BMFF" | "unknown" {
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "PNG";
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8) return "JPEG";
  if (buf.length >= 12 && buf.toString("ascii", 4, 8) === "ftyp") return "BMFF";
  return "unknown";
}

function normalizeValidationState(x: any): "valid" | "invalid" | "" {
  const raw = String(x ?? "").trim().toLowerCase();
  if (raw === "valid") return "valid";
  if (raw === "invalid") return "invalid";
  return "";
}

export async function processManifestStore(
  asset: SourceAsset,
  asIndicatorSet: boolean,
  fileBuffer?: Buffer | null
): Promise<C2PAManifestInfo> {
  const fileFormatDetected = fileBuffer ? detectFileFormat(fileBuffer) : "unknown";

  const c2paInfo: C2PAManifestInfo = {
    hasManifest: false,
    manifestCount: 0,
    validationStatus: "",
    manifests: [],
    error: null,
    fileFormat: fileFormatDetected === "unknown" ? "" : fileFormatDetected,
    indicatorSet: null,
  };

  try {
    const reader = await Reader.fromAsset(asset, DEFAULT_READER_SETTINGS);
    if (!reader) throw new Error("c2pa-node: failed to create Reader from asset");

    const manifestStoreJson: any = await reader.json();
    c2paInfo.manifestStore = manifestStoreJson;

    const manifestsObj: Record<string, any> = manifestStoreJson?.manifests ?? {};
    const manifestCount = Object.keys(manifestsObj).length;

    c2paInfo.hasManifest = manifestCount > 0;
    c2paInfo.manifestCount = manifestCount;

    const state = normalizeValidationState(manifestStoreJson?.validation_state);
    c2paInfo.validationStatus = state;

    if (asIndicatorSet) {
      c2paInfo.indicatorSet = await generateIndicatorSet(
        manifestStoreJson,
        manifestStoreJson,
        fileBuffer ?? null
      );
    } else {
      c2paInfo.manifests = Object.entries(manifestsObj).map(([id, m]: [string, any]) => ({
        label: id ?? m?.label ?? null,
        claim: {
          title: m?.title ?? null,
          instanceID: m?.instance_id ?? null,
          claim_generator: m?.claim_generator_info ?? m?.claim_generator ?? null,
        },
        signature: m?.signature_info ?? null,
        assertionCount: Array.isArray(m?.assertions) ? m.assertions.length : 0,
      }));
    }

    if (!c2paInfo.hasManifest && fileBuffer) {
      const metadata = await extractMetadata(fileBuffer);
      formatMetadata(metadata);
      if (asIndicatorSet) {
        c2paInfo.indicatorSet = {
          "@context": ["https://jpeg.org/jpegtrust"],
          manifests: [],
          content: {},
          metadata,
        };
      }
    }

    return c2paInfo;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    c2paInfo.error = message;
    c2paInfo.validationStatus = "error";

    if (fileBuffer) {
      try {
        const metadata = await extractMetadata(fileBuffer);
        formatMetadata(metadata);
        if (asIndicatorSet) {
          c2paInfo.indicatorSet = {
            "@context": ["https://jpeg.org/jpegtrust"],
            manifests: [],
            content: {},
            metadata,
          };
        }
      } catch {}
    }

    return c2paInfo;
  }
}
