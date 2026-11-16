import { reviewedSource } from "../lib/reviewed-workbook.mjs";

export type Source = {
  title: string;
  url: string | null;
  published: string | null;
  reviewed: string;
  session: string | null;
};

export function Citation({ source }: { source: Source }) {
  const url = source.url && reviewedSource(source.url);
  const dates = [
    source.session,
    source.published
      ? "Published " + source.published
      : "Publication date unknown",
    "Reviewed " + source.reviewed,
  ];
  return (
    <div className="mt-2 border-t pt-2 text-xs">
      {url ? (
        <a
          className="text-teal-800 underline"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {source.title}
        </a>
      ) : (
        <span>Reviewed knowledge · {source.title}</span>
      )}
      <div>{dates.filter(Boolean).join(" · ")}</div>
    </div>
  );
}
