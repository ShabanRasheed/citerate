import { defineCollection, z } from "astro:content";

const blog = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    dek: z.string(),
    date: z.date(),
    author: z.string(),
    category: z.enum(["research", "playbook", "method"]),
    readingTime: z.string(),
    draft: z.boolean().default(false),
    /** every data post states its methodology — this is not optional in practice */
    methodology: z.string().optional(),
    ctaHeadline: z.string().optional(),
    /** small figure rendered on the index lead card */
    figure: z
      .object({
        label: z.string(),
        note: z.string().optional(),
        rows: z.array(z.object({ label: z.string(), value: z.number() }))
      })
      .optional()
  })
});

const changelog = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    date: z.date(),
    kind: z.enum(["engine-coverage", "new", "improved", "fixed"]),
    /** true when history was recomputed: charts show a flagged discontinuity */
    affectsHistory: z.boolean().default(false),
    summary: z.string().optional()
  })
});

const legal = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    description: z.string(),
    updated: z.string(),
    version: z.string(),
    summary: z.string().optional(),
    draft: z.boolean().default(true),
    history: z.array(z.string()).default([])
  })
});

const compare = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    description: z.string(),
    kicker: z.string(),
    headline: z.string(),
    dek: z.string(),
    alternativeLabel: z.string(),
    ctaHeadline: z.string(),
    tableNote: z.string().optional(),
    rows: z.array(z.object({ label: z.string(), them: z.string(), us: z.string() }))
  })
});

const docs = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    description: z.string(),
    group: z.enum(["getting-started", "concepts", "api"]),
    order: z.number().default(0),
    published: z.boolean().default(false)
  })
});

export const collections = { blog, changelog, legal, compare, docs };
