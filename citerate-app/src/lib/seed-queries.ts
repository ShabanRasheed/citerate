/**
 * Category-pattern queries — one of the three sources `lib/query-generator.ts`
 * blends (crawl · Search Console · category). These are the floor: they
 * guarantee a defensible set even when the crawl fails and GSC is not
 * connected, and rows built from them stay labelled `source: 'category'` in
 * the database so nothing pretends to be crawl-derived.
 */
export interface SeedQuery {
  text: string;
  intent: "informational" | "commercial" | "navigational" | "transactional";
  cluster: string;
}

export const brandFrom = (hostname: string): string => {
  const [name] = hostname.replace(/^www\./, "").split(".");
  return (name ?? hostname).replace(/[-_]/g, " ");
};

export const SEED_QUERIES = (hostname: string): SeedQuery[] => {
  const brand = brandFrom(hostname);

  return [
    { text: `what is ${brand}`, intent: "informational", cluster: "brand" },
    { text: `${brand} reviews`, intent: "commercial", cluster: "brand" },
    { text: `is ${brand} any good`, intent: "commercial", cluster: "brand" },
    { text: `${brand} pricing`, intent: "commercial", cluster: "pricing" },
    { text: `how much does ${brand} cost`, intent: "commercial", cluster: "pricing" },
    { text: `${brand} free plan`, intent: "commercial", cluster: "pricing" },
    { text: `${brand} alternatives`, intent: "commercial", cluster: "alternatives" },
    { text: `${brand} vs competitors`, intent: "commercial", cluster: "alternatives" },
    { text: `best alternative to ${brand}`, intent: "commercial", cluster: "alternatives" },
    { text: `${brand} competitors compared`, intent: "commercial", cluster: "alternatives" },
    { text: `best tools in ${brand}'s category`, intent: "commercial", cluster: "category-pick" },
    { text: `top rated options for ${brand}'s use case`, intent: "commercial", cluster: "category-pick" },
    { text: `which tool should I choose for ${brand}'s job`, intent: "commercial", cluster: "category-pick" },
    { text: `recommended software like ${brand}`, intent: "commercial", cluster: "category-pick" },
    { text: `how to migrate to ${brand}`, intent: "transactional", cluster: "migration" },
    { text: `switching from a competitor to ${brand}`, intent: "transactional", cluster: "migration" },
    { text: `${brand} onboarding`, intent: "informational", cluster: "migration" },
    { text: `${brand} integrations`, intent: "informational", cluster: "capabilities" },
    { text: `does ${brand} have an API`, intent: "informational", cluster: "capabilities" },
    { text: `${brand} security and compliance`, intent: "informational", cluster: "capabilities" },
    { text: `${brand} for small teams`, intent: "commercial", cluster: "segments" },
    { text: `${brand} for enterprise`, intent: "commercial", cluster: "segments" },
    { text: `${brand} for agencies`, intent: "commercial", cluster: "segments" },
    { text: `${brand} support quality`, intent: "informational", cluster: "brand" },
    { text: `${brand} customer complaints`, intent: "informational", cluster: "brand" }
  ];
};
