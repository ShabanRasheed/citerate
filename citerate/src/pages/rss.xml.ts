import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import type { APIContext } from "astro";

export async function GET(context: APIContext) {
  const posts = await getCollection("blog", ({ data }) => !data.draft);
  const changes = await getCollection("changelog");

  const items = [
    ...posts.map((p) => ({
      title: p.data.title,
      description: p.data.dek,
      pubDate: p.data.date,
      link: `/blog/${p.id.replace(/\.mdx?$/, "")}/`,
      categories: [p.data.category]
    })),
    ...changes.map((c) => ({
      title: `Changelog: ${c.data.title}`,
      description: c.data.summary ?? c.data.title,
      pubDate: c.data.date,
      link: "/changelog/",
      categories: ["changelog", c.data.kind]
    }))
  ].sort((a, b) => b.pubDate.valueOf() - a.pubDate.valueOf());

  return rss({
    title: "Citerate — field notes & changelog",
    description:
      "Research, playbooks, and method notes on AI visibility, plus every product change that affects your data.",
    site: context.site ?? "https://citerate.com",
    items,
    customData: "<language>en-us</language>"
  });
}
