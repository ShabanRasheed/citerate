/**
 * Roles. Five of them, and the interesting one is `client`: an agency's client
 * seat is read-only, free, and unlimited, so it must never be able to spend
 * money or change tracking.
 */
export type Role = "owner" | "admin" | "editor" | "viewer" | "client";

export type Capability =
  | "view"
  | "export"
  | "edit_queries"
  | "edit_fixes"
  | "run_rescan"
  | "invite"
  | "manage_billing"
  | "manage_brand"
  | "delete_workspace";

const MATRIX: Record<Role, Capability[]> = {
  owner: [
    "view", "export", "edit_queries", "edit_fixes", "run_rescan",
    "invite", "manage_billing", "manage_brand", "delete_workspace"
  ],
  admin: ["view", "export", "edit_queries", "edit_fixes", "run_rescan", "invite", "manage_brand"],
  editor: ["view", "export", "edit_queries", "edit_fixes", "run_rescan"],
  viewer: ["view", "export"],
  client: ["view"]
};

export function can(role: Role, capability: Capability): boolean {
  return MATRIX[role].includes(capability);
}

export function assert(role: Role, capability: Capability): void {
  if (!can(role, capability)) {
    throw new Response(JSON.stringify({ error: "insufficient_role", need: capability }), {
      status: 403,
      headers: { "content-type": "application/json" }
    });
  }
}

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
  client: "Client (read-only)"
};

export const ROLE_HINT: Record<Role, string> = {
  owner: "Everything, including billing and deleting the workspace.",
  admin: "Everything except billing and deletion.",
  editor: "Tracking, fixes, and rescans. No invites, no billing.",
  viewer: "Read and export. Cannot change what is tracked.",
  client: "Read only. Free seat, does not count against the plan."
};
