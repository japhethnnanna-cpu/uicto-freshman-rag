import yauzl from "yauzl";
import { parse } from "node-html-parser";

export const MAX_UPLOAD = 3 * 1024 * 1024;
const MAX_XML = 2 * 1024 * 1024;

function docxXml(bytes) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      bytes,
      { lazyEntries: true, validateEntrySizes: true },
      (error, zip) => {
        if (error) return reject(Error("Invalid DOCX archive."));
        let entries = 0,
          settled = false;
        const finish = (err, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          zip.close();
          if (err) reject(err);
          else resolve(value);
        };
        const timer = setTimeout(
          () => finish(Error("Document extraction timed out.")),
          5000,
        );
        zip.on("error", () => finish(Error("Invalid DOCX archive.")));
        zip.on("end", () => finish(Error("DOCX has no document body.")));
        zip.on("entry", (entry) => {
          if (++entries > 1000)
            return finish(Error("Document contains too many archive entries."));
          if (entry.fileName !== "word/document.xml") return zip.readEntry();
          if (
            entry.uncompressedSize > MAX_XML ||
            entry.generalPurposeBitFlag & 1
          )
            return finish(
              Error("Document is encrypted or too large after extraction."),
            );
          zip.openReadStream(entry, (err, stream) => {
            if (err) return finish(Error("Cannot read DOCX text."));
            const chunks = [];
            let size = 0;
            stream.on("data", (chunk) => {
              size += chunk.length;
              if (size > MAX_XML) {
                stream.destroy();
                finish(Error("Document text is too large."));
              } else chunks.push(chunk);
            });
            stream.on("error", () => finish(Error("Cannot read DOCX text.")));
            stream.on("end", () =>
              finish(null, Buffer.concat(chunks).toString("utf8")),
            );
          });
        });
        zip.readEntry();
      },
    );
  });
}
export async function extractDocument(bytes, filename) {
  if (!bytes.length || bytes.length > MAX_UPLOAD)
    throw Error("Upload a file of up to 3 MB.");
  const ext = filename.toLowerCase().split(".").pop();
  let text;
  if (ext === "docx") {
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b)
      throw Error("This file is not a DOCX document.");
    const xml = await docxXml(bytes);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml))
      throw Error("Document contains unsupported XML declarations.");
    const root = parse(xml);
    // Text only: never execute embedded objects, relationships, macros or links.
    text = root
      .getElementsByTagName("w:p")
      .map((p) =>
        p
          .getElementsByTagName("w:t")
          .map((t) => t.textContent)
          .join(""),
      )
      .join("\n");
  } else if (["txt", "md"].includes(ext)) {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw Error("Save text files as UTF-8 before uploading.");
    }
    if (/[\u0000-\u0008\u000e-\u001f]/.test(text))
      throw Error("This is not a plain text file.");
  } else
    throw Error(
      "Upload a DOCX, TXT or Markdown file. Export PDFs to one of these formats first.",
    );
  text = text.trim();
  if (text.length < 20 || text.length > 60000)
    throw Error(
      "Extracted text must contain 20–60,000 characters. Split large documents into smaller files.",
    );
  return text;
}
