"use client";

import { FormEvent, useState } from "react";

type Message = {
  role: "user" | "assistant";
  content: string;
};

const suggestedQuestions = [
  {
    icon: "💳",
    text: "How do I pay my school fees?",
  },
  {
    icon: "📚",
    text: "Where do I register for courses?",
  },
  {
    icon: "🪪",
    text: "Where can I get my student ID card?",
  },
  {
    icon: "📶",
    text: "How do I access the university WiFi?",
  },
];

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);

  async function sendQuestion(
    event?: FormEvent,
    selectedQuestion?: string
  ) {
    event?.preventDefault();

    const userQuestion =
      selectedQuestion?.trim() || question.trim();

    if (!userQuestion || loading) {
      return;
    }

    setMessages((current) => [
      ...current,
      {
        role: "user",
        content: userQuestion,
      },
    ]);

    setQuestion("");
    setLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: userQuestion,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Something went wrong."
        );
      }

      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content:
            data.answer ||
            "I couldn't generate an answer.",
        },
      ]);
    } catch (error) {
      console.error(error);

      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content:
            "Sorry, something went wrong while processing your question. Please try again.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  const hasMessages = messages.length > 0;

  return (
    <main className="min-h-screen bg-[#f7f9fc] text-slate-900">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0f766e] text-lg text-white shadow-sm">
              🎓
            </div>

            <div>
              <h1 className="text-sm font-bold tracking-tight sm:text-base">
                UICTO
              </h1>

              <p className="text-xs text-slate-500">
                Freshman Assistant
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Online
          </div>
        </div>
      </header>

      {/* Main */}
      <section className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-5xl flex-col px-4 sm:px-6">
        {!hasMessages ? (
          /* Welcome screen */
          <div className="flex flex-1 flex-col items-center justify-center py-12">
            <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-teal-100 text-3xl">
              👋
            </div>

            <h2 className="text-center text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Hello, Freshman
            </h2>

            <p className="mt-3 max-w-lg text-center text-sm leading-6 text-slate-500 sm:text-base">
              Ask me anything about UICTO and I&apos;ll
              search the university knowledge base for
              an answer.
            </p>

            {/* Suggested questions */}
            <div className="mt-10 grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
              {suggestedQuestions.map((item) => (
                <button
                  key={item.text}
                  onClick={() =>
                    sendQuestion(undefined, item.text)
                  }
                  className="group rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md"
                >
                  <div className="flex items-start gap-3">
                    <span className="text-xl">
                      {item.icon}
                    </span>

                    <span className="text-sm font-medium leading-5 text-slate-700 group-hover:text-teal-700">
                      {item.text}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Chat screen */
          <div className="flex flex-1 flex-col py-6">
            <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5">
              {messages.map((message, index) => (
                <div
                  key={`${message.role}-${index}`}
                  className={`flex ${
                    message.role === "user"
                      ? "justify-end"
                      : "justify-start"
                  }`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6 sm:max-w-[75%] ${
                      message.role === "user"
                        ? "rounded-br-md bg-teal-700 text-white"
                        : "rounded-bl-md border border-slate-200 bg-white text-slate-700 shadow-sm"
                    }`}
                  >
                    {message.content}
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex justify-start">
                  <div className="rounded-2xl rounded-bl-md border border-slate-200 bg-white px-5 py-4 shadow-sm">
                    <div className="flex items-center gap-1.5">
                      <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]" />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]" />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400" />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Input area */}
        <div className="sticky bottom-0 mx-auto w-full max-w-3xl pb-5 pt-3">
          <form
            onSubmit={sendQuestion}
            className="relative"
          >
            <input
              type="text"
              value={question}
              onChange={(event) =>
                setQuestion(event.target.value)
              }
              placeholder="Ask anything about UICTO..."
              disabled={loading}
              className="h-14 w-full rounded-2xl border border-slate-200 bg-white px-5 pr-14 text-sm text-slate-900 shadow-lg shadow-slate-200/40 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 disabled:cursor-not-allowed disabled:opacity-70"
            />

            <button
              type="submit"
              disabled={!question.trim() || loading}
              className="absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-xl bg-teal-700 text-lg text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
              aria-label="Send question"
            >
              ↑
            </button>
          </form>

          <p className="mt-3 text-center text-[11px] text-slate-400">
            Answers are generated from the UICTO
            knowledge base.
          </p>
        </div>
      </section>
    </main>
  );
}