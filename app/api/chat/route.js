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
  const startTime = Date.now();

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

    // 1. Create embedding for user's question
    const embeddingResponse = await ai.models.embedContent({
      model: "gemini-embedding-2",
      contents: userQuestion,
      config: {
        outputDimensionality: 768,
      },
    });

    const queryEmbedding =
      embeddingResponse.embeddings?.[0]?.values;

    if (!queryEmbedding || queryEmbedding.length !== 768) {
      throw new Error("Failed to generate a valid 768-dimensional embedding.");
    }

    console.log(
      `⏱️ Gemini embedding: ${Date.now() - startTime}ms`
    );

    // 2. Retrieve relevant knowledge from Supabase
    const { data: matches, error: matchError } = await supabase.rpc(
      "match_school_knowledge",
      {
        query_embedding: queryEmbedding,
        match_threshold: 0.75,
        match_count: 5,
      }
    );

    if (matchError) {
      throw new Error(
        `Supabase retrieval error: ${matchError.message}`
      );
    }

    console.log(
      `⏱️ Supabase retrieval: ${Date.now() - startTime}ms`
    );

    // 3. Reject questions without sufficiently relevant context
    if (!matches || matches.length === 0) {
      return Response.json({
        answer:
          "I don't have enough information to answer that from the UICTO knowledge base.",
        sources: [],
      });
    }

    const bestMatch = matches[0];

    console.log(
      `Best match: ${bestMatch.external_id} (${Number(
        bestMatch.similarity
      ).toFixed(4)})`
    );

    // 4. Assemble retrieved records into grounded context
    const context = matches
      .map(
        (item, index) => `
SOURCE ${index + 1}
Category: ${item.category ?? "Not specified"}
Question: ${item.question ?? "Not specified"}
Answer: ${item.answer ?? "Not specified"}
        `.trim()
      )
      .join("\n\n");

    // 5. Create a restricted RAG prompt
    const prompt = `
You are the UICTO Freshman Assistant.

Answer the user's question using ONLY the information contained in the supplied UICTO knowledge base context.

STRICT RULES:
1. Do not use outside knowledge.
2. Do not add facts, policies, requirements, procedures, warnings, notes, or explanations that are not explicitly supported by the context.
3. Do not make assumptions or fill in missing information.
4. Do not invent details to make the answer more complete.
5. If the context does not contain enough information to answer the question, say exactly:
"I don't have enough information to answer that from the UICTO knowledge base."
6. Keep the answer focused on the user's question.
7. You may rephrase information for clarity, but every factual statement must be supported by the context.
8. Do not add phrases such as "Note", "Important", "Generally", or "Usually" unless they are explicitly contained in the context.

UICTO KNOWLEDGE BASE CONTEXT:
${context}

USER QUESTION:
${userQuestion}
`.trim();

    // 6. Generate final answer with NVIDIA
    const nvidiaResponse = await fetch(
      "https://integrate.api.nvidia.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
        },
        body: JSON.stringify({
          model: "openai/gpt-oss-20b",
          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
          temperature: 0.2,
          reasoning_effort: "low",
          max_tokens: 300,
        }),
      }
    );

    console.log(
      `⏱️ NVIDIA response: ${Date.now() - startTime}ms`
    );

    // 7. Handle NVIDIA API error
    if (!nvidiaResponse.ok) {
      const errorText = await nvidiaResponse.text();

      throw new Error(
        `NVIDIA API error ${nvidiaResponse.status}: ${errorText}`
      );
    }

    const nvidiaData = await nvidiaResponse.json();

    // 8. Extract final generated answer
    const answer =
      nvidiaData.choices?.[0]?.message?.content?.trim();

    if (!answer) {
      throw new Error("NVIDIA returned an empty answer.");
    }

    console.log(
      `✅ Total request time: ${Date.now() - startTime}ms`
    );

    // 9. Return answer and retrieval evidence
    return Response.json({
      answer,
      sources: matches.map((item) => ({
        id: item.external_id ?? item.id,
        category: item.category,
        question: item.question,
        similarity: item.similarity,
      })),
    });
  } catch (error) {
    console.error("Chat API error:", error);

    return Response.json(
      {
        error: "Something went wrong while processing your question.",
      },
      {
        status: 500,
      }
    );
  }
}