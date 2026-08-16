-- Local demo data so `pnpm dev` shows a populated readout without spending API calls.
INSERT OR REPLACE INTO users (id, email, name, created_at)
VALUES ('usr_demo', 'demo@citerate.com', 'Demo User', unixepoch());

INSERT OR REPLACE INTO workspaces (id, name, slug, plan, created_at)
VALUES ('wsp_demo', 'Acme CRM', 'acme-crm', 'growth', unixepoch());

INSERT OR REPLACE INTO memberships (workspace_id, user_id, role, created_at)
VALUES ('wsp_demo', 'usr_demo', 'owner', unixepoch());

INSERT OR REPLACE INTO domains (id, workspace_id, hostname, label, created_at)
VALUES ('dom_demo', 'wsp_demo', 'acmecrm.com', 'Acme CRM', unixepoch());

INSERT OR REPLACE INTO query_sets (id, domain_id, name, created_at)
VALUES ('qs_demo', 'dom_demo', 'Default set', unixepoch());

INSERT OR REPLACE INTO queries (id, query_set_id, text, intent, cluster, source, created_at) VALUES
 ('qry_1','qs_demo','best crm for startups','commercial','category-pick','category',unixepoch()),
 ('qry_2','qs_demo','hubspot alternatives','commercial','alternatives','search_console',unixepoch()),
 ('qry_3','qs_demo','crm with free tier','commercial','pricing','site',unixepoch()),
 ('qry_4','qs_demo','crm for a 10 person team','commercial','category-pick','category',unixepoch()),
 ('qry_5','qs_demo','how to migrate crm data','informational','migration','site',unixepoch());

INSERT OR REPLACE INTO scans
 (id, domain_id, workspace_id, kind, status, share_token, engines, queries_total, queries_done, citation_rate, created_at, completed_at)
VALUES
 ('scn_demo','dom_demo','wsp_demo','scheduled','complete',NULL,
  '["chatgpt","google_aio","perplexity","gemini"]',5,5,0.34,unixepoch(),unixepoch());

INSERT OR REPLACE INTO observations
 (id, scan_id, query_id, engine, runs, cited_runs, citation_rate, mention_runs, organic_rank, aio_present, tech_pass, cause, cause_confidence, scanned_at)
VALUES
 ('obs_1','scn_demo','qry_1','chatgpt',3,1,0.333,1,4,1,1,'aio_displacement',0.86,unixepoch()),
 ('obs_2','scn_demo','qry_1','google_aio',3,0,0.0,0,4,1,1,'aio_displacement',0.91,unixepoch()),
 ('obs_3','scn_demo','qry_2','chatgpt',3,0,0.0,0,9,1,1,'ranking_decline',0.72,unixepoch()),
 ('obs_4','scn_demo','qry_3','chatgpt',3,3,1.0,0,2,1,1,NULL,NULL,unixepoch()),
 ('obs_5','scn_demo','qry_5','chatgpt',3,1,0.333,0,6,0,0,'technical_decay',0.64,unixepoch());

INSERT OR REPLACE INTO citations (id, observation_id, run_index, url, resolved_url, hostname, is_subject, excerpt) VALUES
 ('cit_1','obs_1',2,'https://acmecrm.com/startups','https://acmecrm.com/startups','acmecrm.com',1,'noted for migration tooling'),
 ('cit_2','obs_1',0,'https://competitor-a.com','https://competitor-a.com','competitor-a.com',0,'most commonly recommended'),
 ('cit_3','obs_2',0,'https://g2.com/acme','https://g2.com/acme','g2.com',0,'third-party page about the subject');

INSERT OR REPLACE INTO competitors (id, domain_id, hostname, discovered, created_at) VALUES
 ('cmp_1','dom_demo','competitor-a.com',1,unixepoch()),
 ('cmp_2','dom_demo','competitor-b.com',1,unixepoch());

INSERT OR REPLACE INTO findings (id, domain_id, title, detail, cause, impact, cluster, query_ids, baseline_rate, created_at) VALUES
 ('fnd_1','dom_demo','Publish a comparison page answering "hubspot alternatives" directly',
  'Engines cite pages that name alternatives and state numbers.','aio_displacement','high','alternatives','["qry_2"]',0.0,unixepoch()),
 ('fnd_2','dom_demo','Add per-plan pricing detail','Answers citing pricing prefer pages with explicit figures.','aio_displacement','high','pricing','["qry_3"]',0.33,unixepoch()),
 ('fnd_3','dom_demo','Fix soft-404s on 3 documentation URLs','Engines could not fetch these pages.','technical_decay','medium','migration','["qry_5"]',0.33,unixepoch());

INSERT OR REPLACE INTO fix_states (finding_id, state, owner_user_id, updated_at) VALUES
 ('fnd_1','open','usr_demo',unixepoch()),
 ('fnd_2','in_progress','usr_demo',unixepoch()),
 ('fnd_3','open',NULL,unixepoch());

INSERT OR REPLACE INTO daily_rollups (domain_id, day, engine, cluster, citation_rate, runs, band_low, band_high, cause_aio, cause_rank, cause_tech, cause_other)
VALUES ('dom_demo', date('now'), '*', '*', 0.34, 60, 0.29, 0.39, 0.46, 0.27, 0.17, 0.10);

INSERT OR REPLACE INTO usage_counters (workspace_id, period, metric, used, included)
VALUES ('wsp_demo', strftime('%Y-%m','now'), 'tracked_queries', 412, 500);
