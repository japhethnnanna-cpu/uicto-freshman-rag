import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config({ path: ".env.local" });

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  throw new Error(
    "GEMINI_API_KEY is missing from .env.local"
  );
}

const ai = new GoogleGenAI({
  apiKey,
});

const response = await ai.models.embedContent({
  model: "gemini-embedding-2",
  contents: "Where can I pay my school fees?",
  config: {
    outputDimensionality: 768,
  },
});

const embedding = response.embeddings?.[0]?.values;

if (!embedding) {
  throw new Error(
    "Gemini did not return an embedding."
  );
}

console.log("Gemini embedding test successful.");
console.log("Embedding dimensions:", embedding.length);
console.log(
  "First 10 values:",
  embedding.slice(0, 10)
);