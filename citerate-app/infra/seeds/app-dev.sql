-- ---------------------------------------------------------------------------
-- Dashboard dev seed. Creates one signed-in-able user, an agency workspace with
-- one client workspace, a domain with 12 queries, two scans (so a delta exists),
-- rollups with a confidence band and one flagged discontinuity, findings in
-- every state including a verified one, and usage counters near the limit.
--
--   pnpm db:seed:local
--   then sign in as founder@northline.co (the code prints to the console)
-- ---------------------------------------------------------------------------

DELETE FROM report_snapshots;
DELETE FROM invites;
DELETE FROM join_requests;
DELETE FROM notification_prefs;
DELETE FROM usage_counters;
DELETE FROM fix_states;
DELETE FROM findings;
DELETE FROM daily_rollups;
DELETE FROM citations;
DELETE FROM observations;
DELETE FROM scan_jobs;
DELETE FROM scans;
DELETE FROM competitors;
DELETE FROM queries;
DELETE FROM query_sets;
DELETE FROM domains;
DELETE FROM memberships;
DELETE FROM workspaces;
DELETE FROM sessions;
DELETE FROM auth_tokens;
DELETE FROM users;

INSERT INTO users (id, email, name, created_at, last_seen_at) VALUES
  ('usr_founder', 'founder@northline.co', 'Sam Okafor', unixepoch() - 5184000, unixepoch() - 3600),
  ('usr_editor',  'lee@northline.co',    'Lee Marsh',  unixepoch() - 2592000, unixepoch() - 86400),
  ('usr_client',  'ops@acmeclient.com',  'Dana Reyes', unixepoch() - 1296000, unixepoch() - 172800);

INSERT INTO workspaces (id, name, slug, parent_id, plan, brand_accent, created_at) VALUES
  ('wsp_agency', 'Northline', 'northline-ag01', NULL, 'agency', '#3E5C8A', unixepoch() - 5184000),
  ('wsp_client', 'Acme Client', 'acme-client-cl02', 'wsp_agency', 'agency', NULL, unixepoch() - 1296000);

INSERT INTO memberships (workspace_id, user_id, role, created_at) VALUES
  ('wsp_agency', 'usr_founder', 'owner',  unixepoch() - 5184000),
  ('wsp_agency', 'usr_editor',  'editor', unixepoch() - 2592000),
  ('wsp_client', 'usr_founder', 'owner',  unixepoch() - 1296000),
  ('wsp_client', 'usr_client',  'client', unixepoch() - 1296000);

INSERT INTO domains (id, workspace_id, hostname, label, gsc_connected, created_at) VALUES
  ('dom_northline', 'wsp_agency', 'northline.co', 'Northline', 1, unixepoch() - 5184000),
  ('dom_acme',      'wsp_client', 'acmeclient.com', 'Acme', 0, unixepoch() - 1296000);

INSERT INTO query_sets (id, domain_id, name, created_at) VALUES
  ('qst_northline', 'dom_northline', 'Seeded set', unixepoch() - 5184000);

INSERT INTO queries (id, query_set_id, text, intent, cluster, source, active, created_at) VALUES
  ('qry_01','qst_northline','best savings accounts for freelancers','commercial','category-pick','category',1,unixepoch() - 5184000),
  ('qry_02','qst_northline','northline reviews','commercial','brand','site',1,unixepoch() - 5184000),
  ('qry_03','qst_northline','northline pricing','commercial','pricing','site',1,unixepoch() - 5184000),
  ('qry_04','qst_northline','northline alternatives','commercial','alternatives','category',1,unixepoch() - 5184000),
  ('qry_05','qst_northline','how do business savings accounts work','informational','category-pick','search_console',1,unixepoch() - 5184000),
  ('qry_06','qst_northline','switching business bank account','transactional','migration','search_console',1,unixepoch() - 5184000),
  ('qry_07','qst_northline','northline vs high street banks','commercial','alternatives','category',1,unixepoch() - 5184000),
  ('qry_08','qst_northline','best interest rate for business savings','commercial','category-pick','category',1,unixepoch() - 5184000),
  ('qry_09','qst_northline','is northline fscs protected','informational','brand','user',1,unixepoch() - 5184000),
  ('qry_10','qst_northline','northline api documentation','informational','capabilities','site',1,unixepoch() - 5184000),
  ('qry_11','qst_northline','business savings account for agencies','commercial','segments','category',1,unixepoch() - 5184000),
  ('qry_12','qst_northline','northline customer complaints','informational','brand','category',1,unixepoch() - 5184000);

INSERT INTO competitors (id, domain_id, hostname, discovered, created_at) VALUES
  ('cmp_01','dom_northline','moneyfacts.co.uk',1,unixepoch() - 2592000),
  ('cmp_02','dom_northline','starlingbank.com',1,unixepoch() - 2592000),
  ('cmp_03','dom_northline','tide.co',1,unixepoch() - 2592000),
  ('cmp_04','dom_northline','monzo.com',0,unixepoch() - 604800);

-- Two completed scans, so the readout has a delta and a "previous" reading.
INSERT INTO scans (id, domain_id, workspace_id, kind, status, engines, runs_per_engine, queries_total, queries_done, citation_rate, created_at, started_at, completed_at) VALUES
  ('scn_prev', 'dom_northline','wsp_agency','scheduled','complete','["chatgpt","perplexity","gemini","google_aio"]',3,12,12,0.29,unixepoch() - 691200,unixepoch() - 691000,unixepoch() - 690000),
  ('scn_last', 'dom_northline','wsp_agency','scheduled','complete','["chatgpt","perplexity","gemini","google_aio"]',3,12,12,0.36,unixepoch() - 86400,unixepoch() - 86300,unixepoch() - 85000);

-- Latest scan observations: one row per query per engine (4 engines × 3 runs).
INSERT INTO observations (id, scan_id, query_id, engine, runs, cited_runs, citation_rate, mention_runs, organic_rank, aio_present, tech_pass, cause, cause_confidence, scanned_at) VALUES
  ('obs_01','scn_last','qry_01','chatgpt',3,0,0.0,2,4,1,1,'aio_displacement',0.85,unixepoch() - 85000),
  ('obs_02','scn_last','qry_01','perplexity',3,1,0.3333,1,4,1,1,'aio_displacement',0.72,unixepoch() - 85000),
  ('obs_03','scn_last','qry_01','gemini',3,0,0.0,1,4,1,1,'aio_displacement',0.80,unixepoch() - 85000),
  ('obs_04','scn_last','qry_01','google_aio',3,0,0.0,0,4,1,1,'aio_displacement',0.88,unixepoch() - 85000),
  ('obs_05','scn_last','qry_02','chatgpt',3,3,1.0,0,1,0,1,NULL,NULL,unixepoch() - 85000),
  ('obs_06','scn_last','qry_02','perplexity',3,3,1.0,0,1,0,1,NULL,NULL,unixepoch() - 85000),
  ('obs_07','scn_last','qry_03','chatgpt',3,2,0.6667,1,2,1,1,'aio_displacement',0.64,unixepoch() - 85000),
  ('obs_08','scn_last','qry_04','chatgpt',3,0,0.0,0,14,0,1,'ranking_decline',0.79,unixepoch() - 85000),
  ('obs_09','scn_last','qry_05','perplexity',3,1,0.3333,2,9,1,1,'ranking_decline',0.68,unixepoch() - 85000),
  ('obs_10','scn_last','qry_06','gemini',3,0,0.0,0,22,0,0,'technical_decay',0.91,unixepoch() - 85000),
  ('obs_11','scn_last','qry_07','chatgpt',3,1,0.3333,1,6,1,1,'aio_displacement',0.66,unixepoch() - 85000),
  ('obs_12','scn_last','qry_08','google_aio',3,0,0.0,1,11,1,1,'ranking_decline',0.74,unixepoch() - 85000),
  ('obs_13','scn_last','qry_09','chatgpt',3,2,0.6667,0,3,0,1,'unexplained',0.42,unixepoch() - 85000),
  ('obs_14','scn_last','qry_10','gemini',3,0,0.0,0,5,0,0,'technical_decay',0.83,unixepoch() - 85000),
  ('obs_15','scn_last','qry_11','perplexity',3,1,0.3333,1,7,1,1,'aio_displacement',0.61,unixepoch() - 85000),
  ('obs_16','scn_last','qry_12','chatgpt',3,0,0.0,2,2,0,1,'unexplained',0.38,unixepoch() - 85000);

INSERT INTO citations (id, observation_id, run_index, url, resolved_url, hostname, is_subject, excerpt) VALUES
  ('cit_01','obs_02',1,'https://northline.co/business-savings','https://northline.co/business-savings','northline.co',1,'Northline pays 4.1% on instant-access business savings.'),
  ('cit_02','obs_01',0,'https://moneyfacts.co.uk/savings/business','https://moneyfacts.co.uk/savings/business','moneyfacts.co.uk',0,'Best business savings rates, updated weekly.'),
  ('cit_03','obs_01',1,'https://starlingbank.com/business','https://starlingbank.com/business','starlingbank.com',0,NULL),
  ('cit_04','obs_03',2,'https://tide.co/guides/savings','https://tide.co/guides/savings','tide.co',0,NULL),
  ('cit_05','obs_04',0,'https://moneyfacts.co.uk/savings/business','https://moneyfacts.co.uk/savings/business','moneyfacts.co.uk',0,NULL),
  ('cit_06','obs_05',0,'https://northline.co','https://northline.co','northline.co',1,NULL),
  ('cit_07','obs_08',0,'https://monzo.com/business','https://monzo.com/business','monzo.com',0,NULL);

-- Rollups: 90 days of '*' plus per-engine latest. Day -21 carries a flagged
-- discontinuity so the chart's method flag is visible in dev.
INSERT INTO daily_rollups (domain_id, day, engine, cluster, citation_rate, runs, band_low, band_high, cause_aio, cause_rank, cause_tech, cause_other, discontinuity) VALUES
  ('dom_northline', date('now','-84 day'), '*','*',0.21,144,0.15,0.28,0.52,0.24,0.10,0.14,NULL),
  ('dom_northline', date('now','-70 day'), '*','*',0.24,144,0.18,0.31,0.50,0.25,0.11,0.14,NULL),
  ('dom_northline', date('now','-56 day'), '*','*',0.26,144,0.20,0.33,0.48,0.26,0.12,0.14,NULL),
  ('dom_northline', date('now','-42 day'), '*','*',0.27,144,0.21,0.34,0.47,0.26,0.13,0.14,NULL),
  ('dom_northline', date('now','-28 day'), '*','*',0.29,144,0.22,0.36,0.46,0.27,0.13,0.14,NULL),
  ('dom_northline', date('now','-21 day'), '*','*',0.31,144,0.24,0.38,0.45,0.27,0.14,0.14,'confidence-bands-on-every-chart'),
  ('dom_northline', date('now','-14 day'), '*','*',0.32,144,0.25,0.39,0.44,0.28,0.14,0.14,NULL),
  ('dom_northline', date('now','-7 day'),  '*','*',0.29,144,0.22,0.36,0.45,0.28,0.13,0.14,NULL),
  ('dom_northline', date('now','-1 day'),  '*','*',0.36,144,0.29,0.44,0.43,0.29,0.14,0.14,NULL),
  ('dom_northline', date('now','-8 day'),  'chatgpt','*',0.38,36,0.24,0.55,0,0,0,0,NULL),
  ('dom_northline', date('now','-1 day'),  'chatgpt','*',0.47,36,0.32,0.63,0,0,0,0,NULL),
  ('dom_northline', date('now','-8 day'),  'perplexity','*',0.31,36,0.18,0.48,0,0,0,0,NULL),
  ('dom_northline', date('now','-1 day'),  'perplexity','*',0.39,36,0.25,0.55,0,0,0,0,NULL),
  ('dom_northline', date('now','-8 day'),  'gemini','*',0.22,36,0.11,0.38,0,0,0,0,NULL),
  ('dom_northline', date('now','-1 day'),  'gemini','*',0.19,36,0.09,0.35,0,0,0,0,NULL),
  ('dom_northline', date('now','-8 day'),  'google_aio','*',0.14,36,0.06,0.29,0,0,0,0,NULL),
  ('dom_northline', date('now','-1 day'),  'google_aio','*',0.17,36,0.08,0.32,0,0,0,0,NULL);

INSERT INTO findings (id, domain_id, title, detail, cause, impact, cluster, query_ids, baseline_rate, created_at) VALUES
  ('fnd_01','dom_northline','Add a comparison table to /best-savings-accounts',
   'Engines cite pages that answer the comparison directly. Four competitors have a table on the equivalent page; you have prose. Affects 14 runs across the category-pick cluster.',
   'aio_displacement','high','category-pick','["qry_01","qry_08","qry_11"]',0.08,unixepoch() - 84000),
  ('fnd_02','dom_northline','Answer the question in the first 60 words on 4 pages',
   'Every one of these pages buries the answer under an introduction. AI answers quote the first direct statement they find.',
   'aio_displacement','medium','category-pick','["qry_05","qry_07"]',0.22,unixepoch() - 84000),
  ('fnd_03','dom_northline','Restore the reviewer byline on /savings-guide',
   'The byline and review date were removed in the June template change. Both engines that dropped you cite pages with visible authorship.',
   'technical_decay','high','brand','["qry_09","qry_12"]',0.31,unixepoch() - 690000),
  ('fnd_04','dom_northline','Fix two redirect chains on /business-savings',
   'Three hops to the canonical URL. Two engines never resolved it.',
   'technical_decay','medium','capabilities','["qry_06","qry_10"]',0.00,unixepoch() - 84000),
  ('fnd_05','dom_northline','Consolidate three thin pages on switching',
   'Three near-duplicate pages split the signal; none ranks above position 20.',
   'ranking_decline','low','migration','["qry_06"]',0.05,unixepoch() - 84000);

INSERT INTO fix_states (finding_id, state, owner_user_id, shipped_at, verified_rate, updated_at) VALUES
  ('fnd_01','in_progress','usr_editor',NULL,NULL,unixepoch() - 43200),
  ('fnd_02','open',NULL,NULL,NULL,unixepoch() - 84000),
  ('fnd_03','verified','usr_editor',unixepoch() - 604800,0.58,unixepoch() - 86000),
  ('fnd_04','shipped','usr_founder',unixepoch() - 172800,NULL,unixepoch() - 172800),
  ('fnd_05','dismissed','usr_founder',NULL,NULL,unixepoch() - 300000);

INSERT INTO subscriptions (id, workspace_id, provider, provider_id, plan, interval, status, current_period_end, created_at, updated_at) VALUES
  ('sub_01','wsp_agency','paddle','ctm_dev_placeholder','agency','month','active',unixepoch() + 1728000,unixepoch() - 5184000,unixepoch() - 86400);

-- Near the limit on purpose: the quota states are the ones that get skipped in dev.
INSERT INTO usage_counters (workspace_id, period, metric, used, included, overage_units) VALUES
  ('wsp_agency', strftime('%Y-%m','now'), 'tracked_queries', 4380, 5000, 0),
  ('wsp_agency', strftime('%Y-%m','now'), 'domains', 6, 25, 0),
  ('wsp_agency', strftime('%Y-%m','now'), 'seats', 2, 99, 0),
  ('wsp_agency', strftime('%Y-%m','now'), 'rescans', 7, 10, 0),
  ('wsp_client', strftime('%Y-%m','now'), 'tracked_queries', 120, 5000, 0);

INSERT INTO notification_prefs (workspace_id, user_id, weekly_digest, scan_complete, fix_verified, rate_drop, drop_threshold, quota_warning, updated_at) VALUES
  ('wsp_agency','usr_founder',1,1,1,1,0.05,1,unixepoch() - 86400);

INSERT INTO invites (id, workspace_id, email, role, token_hash, invited_by, created_at, expires_at) VALUES
  ('inv_01','wsp_agency','new.analyst@northline.co','viewer','seed-hash-not-usable','usr_founder',unixepoch() - 43200,unixepoch() + 561600);

INSERT INTO join_requests (id, workspace_id, user_id, hostname, status, created_at, expires_at) VALUES
  ('jrq_01','wsp_agency','usr_client','northline.co','pending',unixepoch() - 21600,unixepoch() + 583200);
