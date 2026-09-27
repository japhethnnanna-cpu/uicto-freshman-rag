import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

export async function POST(request) {
  try {
    const body = await request.json();
    const userQuestion = body.question?.trim();

    if (!userQuestion) {
      return Response.json(
        {
          error: "Question is required.",
        },
        {
          status: 400,
        }
      );
    }

    // 1. Generate embedding for the student's question
    const embeddingResponse =
      await ai.models.embedContent({
        model: "gemini-embedding-2",
        contents: userQuestion,
        config: {
          outputDimensionality: 768,
        },
      });

    const queryEmbedding =
      embeddingResponse.embeddings?.[0]?.values;

    if (
      !queryEmbedding ||
      queryEmbedding.length !== 768
    ) {
      throw new Error(
        "Failed to generate question embedding."
      );
    }

    // 2. Search the UICTO knowledge base
    const {
      data: matches,
      error: searchError,
    } = await supabase.rpc(
      "match_school_knowledge",
      {
        query_embedding: queryEmbedding,
        match_threshold: 0.75,
        match_count: 5,
      }
    );

    if (searchError) {
      throw new Error(
        `Knowledge search failed: ${searchError.message}`
      );
    }

    // 3. No sufficiently relevant knowledge
    if (!matches || matches.length === 0) {
      return Response.json({
        answer:
          "I don't have enough information to answer that from the UICTO knowledge base.",
        sources: [],
      });
    }

    // 4. Build grounded context
    const context = matches
      .map(
        (item, index) =>
          `SOURCE ${index + 1}
Category: ${item.category}
Question: ${item.question}
Answer: ${item.answer}`
      )
      .join("\n\n");

    // 5. Ask Gemini to answer ONLY from the retrieved knowledge
    const prompt = `
You are the official UICTO Freshman Assistant.

Answer the student's question using ONLY the UICTO knowledge provided below.

STRICT RULES:
- Do not invent information.
- Do not use outside knowledge.
- Do not assume facts that are not present in the sources.
- If the sources do not contain enough information to answer the question, say:
  "I don't have enough information about that in the UICTO knowledge base."
- Keep the answer clear and useful for a freshman.
- Do not mention embeddings, vectors, similarity scores, RAG, or internal systems.

UICTO KNOWLEDGE:
${context}

STUDENT QUESTION:
${userQuestion}
`;

    const response =
      await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
      });

    const answer =
      response.text?.trim();

    if (!answer) {
      throw new Error(
        "Gemini returned an empty answer."
      );
    }

    // 6. Return answer and source information
    return Response.json({
      answer,
      sources: matches.map((item) => ({
        id: item.external_id,
        category: item.category,
        question: item.question,
        similarity: item.similarity,
      })),
    });
  } catch (error) {
    console.error("Chat API error:", error);

    return Response.json(
      {
        error:
          "Something went wrong while processing your question.",
      },
      {
        status: 500,
      }
    );
  }
}