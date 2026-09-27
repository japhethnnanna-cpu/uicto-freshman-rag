import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";

dotenv.config({
  path: ".env.local",
});

const geminiKey =
  process.env.GEMINI_API_KEY;

const supabaseUrl =
  process.env.SUPABASE_URL;

const supabaseSecretKey =
  process.env.SUPABASE_SECRET_KEY;

if (!geminiKey) {
  throw new Error("GEMINI_API_KEY is missing.");
}

if (!supabaseUrl) {
  throw new Error("SUPABASE_URL is missing.");
}

if (!supabaseSecretKey) {
  throw new Error("SUPABASE_SECRET_KEY is missing.");
}

const ai = new GoogleGenAI({
  apiKey: geminiKey,
});

const supabase = createClient(
  supabaseUrl,
  supabaseSecretKey
);

const userQuestion =
  "What is the best laptop for computer engineering students?";

console.log("");
console.log("User question:");
console.log(userQuestion);

console.log("");
console.log("Generating query embedding...");

const response =
  await ai.models.embedContent({
    model: "gemini-embedding-2",
    contents: userQuestion,
    config: {
      outputDimensionality: 768,
    },
  });

const queryEmbedding =
  response.embeddings?.[0]?.values;

if (
  !queryEmbedding ||
  queryEmbedding.length !== 768
) {
  throw new Error("Invalid query embedding.");
}

console.log(
  `Embedding dimensions: ${queryEmbedding.length}`
);

console.log("");
console.log("Searching school knowledge...");

const {
  data,
  error,
} = await supabase.rpc(
  "match_school_knowledge",
  {
    query_embedding:
      queryEmbedding,

    match_threshold: 0.75,

    match_count: 5,
  }
);

if (error) {
  throw new Error(
    `Retrieval failed: ${error.message}`
  );
}

console.log("");
console.log("================================");
console.log(
  `Found ${data.length} matching records.`
);
console.log("================================");

for (
  let i = 0;
  i < data.length;
  i++
) {
  const result = data[i];

  console.log("");
  console.log(`#${i + 1}`);
  console.log(`ID: ${result.external_id}`);
  console.log(`Category: ${result.category}`);
  console.log(`Question: ${result.question}`);
  console.log(`Answer: ${result.answer}`);
  console.log(
    `Similarity: ${result.similarity.toFixed(4)}`
  );
}