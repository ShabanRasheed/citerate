/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

import type { Env } from "./lib/env";
import type { ActiveSession, SessionUser } from "./lib/session";
import type { WorkspaceContext, DomainRow, Usage } from "./lib/data";

declare global {
  namespace App {
    interface Locals {
      runtime: { env: Env; cf?: IncomingRequestCfProperties; ctx: ExecutionContext };
      session?: ActiveSession;
      user?: SessionUser;
      workspace?: WorkspaceContext;
      domains?: DomainRow[];
      /** set by the pane so the shell can render the quota meter and freshness */
      usage?: Usage;
      lastScanAt?: number | null;
    }
  }
}
