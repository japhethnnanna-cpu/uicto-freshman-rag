import dotenv from "dotenv";
import XLSX from "xlsx";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });

const geminiKey = process.env.GEMINI_API_KEY;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey =
  process.env.SUPABASE_SECRET_KEY;

if (!geminiKey) {
  throw new Error(
    "GEMINI_API_KEY is missing."
  );
}

if (!supabaseUrl) {
  throw new Error(
    "SUPABASE_URL is missing."
  );
}

if (!supabaseSecretKey) {
  throw new Error(
    "SUPABASE_SECRET_KEY is missing."
  );
}

const ai = new GoogleGenAI({
  apiKey: geminiKey,
});

const supabase = createClient(
  supabaseUrl,
  supabaseSecretKey
);

const filePath =
  "./data/UICTO_Freshman_QnA_Demo.xlsx";

console.log("Reading Excel file...");

const workbook = XLSX.readFile(filePath);

const sheetName =
  workbook.SheetNames[0];

const worksheet =
  workbook.Sheets[sheetName];

const rows =
  XLSX.utils.sheet_to_json(
    worksheet
  );

console.log(
  `Found ${rows.length} records.`
);

for (
  let i = 0;
  i < rows.length;
  i++
) {
  const row = rows[i];

  const externalId =
    String(row.ID ?? "").trim();

  const category =
    String(row.Category ?? "").trim();

  const question =
    String(
      row["Expected User Query"] ?? ""
    ).trim();

  const answer =
    String(
      row[
        "Chatbot Response (Ground Truth)"
      ] ?? ""
    ).trim();

  if (
    !externalId ||
    !category ||
    !question ||
    !answer
  ) {
    console.warn(
      `Skipping incomplete row ${i + 2}`
    );

    continue;
  }

  console.log(
    `[${i + 1}/${rows.length}] ${externalId}`
  );

  const embeddingText = `
Category: ${category}
Question: ${question}
`.trim();

  const response =
    await ai.models.embedContent({
      model: "gemini-embedding-2",
      contents: embeddingText,
      config: {
        outputDimensionality: 768,
      },
    });

  const embedding =
    response.embeddings?.[0]?.values;

  if (
    !embedding ||
    embedding.length !== 768
  ) {
    throw new Error(
      `Invalid embedding for ${externalId}`
    );
  }

  const record = {
    external_id: externalId,
    category,
    question,
    answer,
    source:
      "UICTO Freshman Q&A Demo.xlsx",
    last_updated: null,
    embedding,
  };

  const { error } =
    await supabase
      .from("school_knowledge")
      .insert(record);

  if (error) {
    throw new Error(
      `Failed storing ${externalId}: ${error.message}`
    );
  }

  console.log(
    `✓ Stored ${externalId}`
  );
}

console.log("");
console.log(
  "================================"
);
console.log(
  "IMPORT COMPLETE"
);
console.log(
  "================================"
);