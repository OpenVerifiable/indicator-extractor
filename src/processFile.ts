// src/processFile.ts
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

import { processManifestStore } from "./processManifestStore.js";

export type ProcessOptions = {
  pretty?: boolean;
  basic?: boolean;
};

export type ProcessResult = {
  metadata: {
    inputFile?: string;
    fileName?: string;
    fileSize?: number;
    processedAt: string;
    fileExtension?: string;
  };
  content: any;
  c2pa: any;
  processing: {
    status: "completed";
    version: string;
  };
  indicatorSet?: any;
  notes?: string[];
};

const TEXT_EXTS = new Set([
  ".txt",
  ".md",
  ".json",
  ".xml",
  ".html",
  ".css",
  ".js",
  ".ts",
]);

function isTextFileByExt(filePath: string) {
  return TEXT_EXTS.has(path.extname(filePath).toLowerCase());
}

function baseResultMetadata(meta: {
  inputPath?: string;
  fileName?: string;
  fileSize?: number;
  fileExtension?: string;
}) {
  return {
    inputFile: meta.inputPath,
    fileName: meta.fileName,
    fileSize: meta.fileSize,
    processedAt: new Date().toISOString(),
    fileExtension: meta.fileExtension,
  };
}

function processTextContent(
  fileContent: string,
  meta: { inputPath?: string; fileName?: string; fileSize?: number; fileExtension?: string }
): ProcessResult {
  return {
    metadata: baseResultMetadata(meta),
    content: {
      rawContent: fileContent,
      lineCount: fileContent.split("\n").length,
      characterCount: fileContent.length,
      wordCount: fileContent
        .trim()
        .split(/\s+/)
        .filter((w) => w.length > 0).length,
    },
    c2pa: null,
    processing: { status: "completed", version: "1.0.0" },
  };
}

async function writeTempAsset(
  fileBuffer: Buffer,
  meta: { fileName?: string; fileExtension?: string } = {}
): Promise<{ tmpPath: string; cleanup: () => Promise<void> }> {
  const ext = (meta.fileExtension || "").toLowerCase();
  const suffix = ext && ext.startsWith(".") ? ext : "";
  const base =
    (meta.fileName ? path.basename(meta.fileName, path.extname(meta.fileName)) : "upload") ||
    "upload";

  const rand = crypto.randomBytes(8).toString("hex");
  const tmpPath = path.join(os.tmpdir(), `${base}-${Date.now()}-${rand}${suffix}`);

  await fs.writeFile(tmpPath, fileBuffer);

  const cleanup = async () => {
    try {
      await fs.remove(tmpPath);
    } catch {
      // noop
    }
  };

  return { tmpPath, cleanup };
}

export async function processFilePath(
  inputFile: string,
  options: ProcessOptions = {}
): Promise<ProcessResult> {
  if (!(await fs.pathExists(inputFile))) {
    throw new Error(`Input file does not exist: ${inputFile}`);
  }

  const inputPath = path.resolve(inputFile);
  const fileStats = await fs.stat(inputPath);
  const ext = path.extname(inputPath);
  const text = isTextFileByExt(inputPath);

  if (text) {
    const fileContent = await fs.readFile(inputPath, "utf8");
    return processTextContent(fileContent, {
      inputPath,
      fileName: path.basename(inputPath),
      fileSize: fileStats.size,
      fileExtension: ext,
    });
  }

  return processBinaryAsset(
    { path: inputPath },
    {
      inputPath,
      fileName: path.basename(inputPath),
      fileSize: fileStats.size,
      fileExtension: ext,
      basic: !!options.basic,
    }
  );
}

export async function processFileBuffer(
  fileBuffer: Buffer,
  meta: { fileName?: string; fileExtension?: string } = {},
  options: ProcessOptions = {}
): Promise<ProcessResult> {
  const processedAt = new Date().toISOString();
  const ext = meta.fileExtension?.toLowerCase() || "";
  const isText = ext ? TEXT_EXTS.has(ext) : false;

  if (isText) {
    const fileContent = fileBuffer.toString("utf8");
    return {
      metadata: {
        fileName: meta.fileName,
        processedAt,
        fileExtension: ext,
      },
      content: {
        rawContent: fileContent,
        lineCount: fileContent.split("\n").length,
        characterCount: fileContent.length,
        wordCount: fileContent
          .trim()
          .split(/\s+/)
          .filter((w) => w.length > 0).length,
      },
      c2pa: null,
      processing: { status: "completed", version: "1.0.0" },
    };
  }

  const { tmpPath, cleanup } = await writeTempAsset(fileBuffer, meta);
  try {
    return await processBinaryAsset(
      { path: tmpPath },
      {
        fileName: meta.fileName,
        fileSize: fileBuffer.length,
        fileExtension: ext,
        basic: !!options.basic,
        // ✅ pass bytes down so exifr/hash never sees undefined
        fileBuffer,
      }
    );
  } finally {
    await cleanup();
  }
}

async function processBinaryAsset(
  asset: { path: string },
  meta: {
    inputPath?: string;
    fileName?: string;
    fileSize?: number;
    fileExtension?: string;
    basic: boolean;
    fileBuffer?: Buffer; // ✅ optional but recommended
  }
): Promise<ProcessResult> {
  const notes: string[] = [];

  // ✅ processManifestStore can now use fileBuffer for metadata/hash
  // and still fall back to reading from asset.path if needed.
  const c2paInfo = await processManifestStore(
    asset,
    !meta.basic,
    meta.fileBuffer
  );

  const result: ProcessResult = {
    metadata: baseResultMetadata(meta),
    content: meta.basic
      ? {
          type: "binary",
          size: meta.fileSize,
          note: "Basic mode: indicator set generation skipped",
        }
      : {},
    c2pa: c2paInfo,
    processing: { status: "completed", version: "1.0.0" },
    notes,
  };

  if (!meta.basic) {
    const fallback = {
      "@context": ["https://jpeg.org/jpegtrust"],
      manifests: [],
      content: {},
      metadata: {},
    };

    const mergeIndicatorSetMetadata = (info: any, indicatorSet: any) => {
      const m = info?.indicatorSet?.metadata;
      if (m && typeof m === "object") Object.assign(indicatorSet.metadata, m);
    };

    if (c2paInfo?.indicatorSet) {
      result.indicatorSet = c2paInfo.indicatorSet;
    } else if (c2paInfo?.manifestCount === 0) {
      notes.push("C2PA: No manifests found in file");
      mergeIndicatorSetMetadata(c2paInfo, fallback);
      result.indicatorSet = fallback;
    } else if (c2paInfo?.error) {
      notes.push(`C2PA: Error - ${c2paInfo.error}`);
      mergeIndicatorSetMetadata(c2paInfo, fallback);
      result.indicatorSet = fallback;
    } else {
      result.indicatorSet = fallback;
    }
  } else {
    if (c2paInfo?.error) {
      notes.push(`C2PA: Error - ${c2paInfo.error}`);
    } else {
      notes.push("C2PA: No manifests found in file");
    }
  }

  return result;
}
