import { CHARACTER_LIMIT } from "./constants.js";

export type ResponseFormat = "markdown" | "json";

export function responseFor<T extends Record<string, unknown>>(
  output: T,
  responseFormat: ResponseFormat,
  markdown: string,
) {
  return {
    content: [
      {
        type: "text" as const,
        text:
          responseFormat === "json"
            ? JSON.stringify(output, null, 2)
            : truncateText(markdown).text,
      },
    ],
    structuredContent: output,
  };
}

export function truncateText(value: string): {
  text: string;
  truncated: boolean;
} {
  if (value.length <= CHARACTER_LIMIT) return { text: value, truncated: false };
  return {
    text: `${value.slice(0, CHARACTER_LIMIT - 120)}\n\n_Response truncated. Use a narrower query, lower limit, or returned cursor._`,
    truncated: true,
  };
}

export function takeWithinCharacterLimit<T>(
  items: T[],
  renderItem: (item: T) => string,
): { items: T[]; truncated: boolean } {
  const selected: T[] = [];
  let length = 0;
  for (const item of items) {
    const renderedLength = renderItem(item).length;
    if (selected.length > 0 && length + renderedLength > CHARACTER_LIMIT) break;
    selected.push(item);
    length += renderedLength;
  }
  return { items: selected, truncated: selected.length < items.length };
}
