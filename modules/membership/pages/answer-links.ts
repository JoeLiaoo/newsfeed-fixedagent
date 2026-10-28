type PageAnswer = {
  answerMd: string;
  citations: Array<{ pageSlug: string; title: string }>;
};

/** Link only bare page slugs in the model's page list, using verified citation titles. */
export function answerWithPageLinks(answer: PageAnswer): string {
  const heading = answer.answerMd.indexOf("本次参考的知识页列表");
  if (heading < 0) return answer.answerMd;
  const before = answer.answerMd.slice(0, heading);
  let references = answer.answerMd.slice(heading);
  const linked = new Set<string>();
  for (const citation of answer.citations) {
    if (!citation.pageSlug || !citation.title || linked.has(citation.pageSlug)) continue;
    linked.add(citation.pageSlug);
    const slug = citation.pageSlug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const title = citation.title.replace(/[\\\[\]]/g, "\\$&");
    const item = new RegExp(`^(\\s*(?:[-*+]\\s+|\\d+[.)]\\s+)?)\x60?${slug}\x60?(?=\\s|$)`, "gm");
    references = references.replace(item, (_, prefix: string) => `${prefix}[${title}](/knowledge/targets/${encodeURIComponent(citation.pageSlug)})`);
  }
  return before + references;
}
