import express from "express";
import multer from "multer";
import path from "node:path";
import { processFileBuffer } from "./processFile.js";

const app = express();

// You can raise this if you expect larger media
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

app.get("/healthz", (_req, res) => res.status(200).send("ok"));

/**
 * POST /v1/process
 * multipart/form-data:
 *  - file: (required) the file to analyze
 * fields:
 *  - basic: "true" | "false" (optional; default false)
 */
app.post("/v1/process", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "Missing file (field name: file)" });

    const basic = String(req.body?.basic ?? "false").toLowerCase() === "true";
    const ext = path.extname(file.originalname || "").toLowerCase();

    const result = await processFileBuffer(
      file.buffer,
      { fileName: file.originalname, fileExtension: ext },
      { basic }
    );

    res.status(200).json(result);
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "Unknown error" });
  }
});

const port = Number(process.env.PORT || 8080);
app.listen(port, "0.0.0.0", () => {
  console.log(`listening on 0.0.0.0:${port}`);
});
