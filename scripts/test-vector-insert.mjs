import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";

dotenv.config({
  path: ".env.local",
});

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

console.log("Creating test embedding...");

const response = await ai.models.embedContent({
  model: "gemini-embedding-2",
  contents: "This is a temporary test question.",
  config: {
    outputDimensionality: 768,
  },
});

const embedding =
  response.embeddings?.[0]?.values;

if (!embedding) {
  throw new Error(
    "Gemini did not return an embedding."
  );
}

console.log(
  "Embedding dimensions:",
  embedding.length
);

console.log("Testing vector INSERT...");

const testRecord = {
  external_id: "TEST-VECTOR-001",
  category: "TEST",
  question: "This is a vector test.",
  answer: "This is a temporary vector test.",
  source: "vector-test",
  embedding,
};

const { data, error } = await supabase
  .from("school_knowledge")
  .insert(testRecord)
  .select();

if (error) {
  console.error("VECTOR INSERT FAILED");
  console.error(error);
  process.exit(1);
}

console.log("VECTOR INSERT SUCCESSFUL");
console.log(data);