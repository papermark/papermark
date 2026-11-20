import { GRANULAR_SCOPES } from "@/lib/oauth/scopes";

export type TokenSubjectType = "user" | "machine";

export type Preset = "all_access" | "read_only" | "restricted";

export const TOKEN_TYPE_LABELS: Record<TokenSubjectType, string> = {
  user: "User key",
  machine: "Machine key",
};

export const PRESET_OPTIONS: { value: Preset; label: string }[] = [
  { value: "all_access", label: "All" },
  { value: "read_only", label: "Read Only" },
  { value: "restricted", label: "Restricted" },
];

export const PRESET_DESCRIPTIONS: Record<Preset, string> = {
  all_access: "full access to all resources",
  read_only: "read-only access to all resources",
  restricted: "restricted access to some resources",
};

export const PRESET_LABELS: Record<Preset, string> = {
  all_access: "All access",
  read_only: "Read only",
  restricted: "Restricted",
};

export type Resource =
  | "documents"
  | "links"
  | "datarooms"
  | "analytics"
  | "visitors";

export const RESOURCE_OPTIONS: {
  resource: Resource;
  label: string;
  description: string;
  actions: ("read" | "write")[];
}[] = [
  {
    resource: "documents",
    label: "Documents",
    description: "Upload, list, update, and delete documents.",
    actions: ["read", "write"],
  },
  {
    resource: "links",
    label: "Links",
    description: "Create, list, update, and revoke share links.",
    actions: ["read", "write"],
  },
  {
    resource: "datarooms",
    label: "Datarooms",
    description: "Create, list, and modify datarooms.",
    actions: ["read", "write"],
  },
  {
    resource: "analytics",
    label: "Analytics",
    description: "Read views and analytics data.",
    actions: ["read"],
  },
  {
    resource: "visitors",
    label: "Visitors",
    description: "Read visitor records.",
    actions: ["read"],
  },
];

export const TOKEN_TYPE_OPTIONS: {
  value: TokenSubjectType;
  label: string;
  summary: string;
  tooltip: string;
}[] = [
  {
    value: "user",
    label: "You",
    summary: "Revoked automatically when your workspace access ends.",
    tooltip:
      "This API key is tied to your user account. If you are removed from the workspace, it will stop working automatically.",
  },
  {
    value: "machine",
    label: "Machine",
    summary: "Best for CI, servers, and long-lived automations.",
    tooltip:
      "Machine keys stay valid even if the creator leaves the workspace. Use them for bots, deployments, and background jobs.",
  },
];

/** Build the scope strings to send to the API based on the editor state. */
export function buildScopesList(
  preset: Preset,
  resourceState: Record<Resource, "none" | "read" | "write">,
): string[] {
  if (preset === "all_access") return ["apis.all"];
  if (preset === "read_only") return ["apis.read"];

  const scopes: string[] = [];
  for (const [resource, action] of Object.entries(resourceState)) {
    if (action === "none") continue;
    if (action === "read") {
      scopes.push(`${resource}.read`);
    } else if (action === "write") {
      // Write implies read; match dub.co semantics so callers don't have to
      // remember to pick both checkboxes.
      scopes.push(`${resource}.read`, `${resource}.write`);
    }
  }
  return Array.from(new Set(scopes));
}

export type ResourceState = Record<Resource, "none" | "read" | "write">;

export const DEFAULT_RESOURCE_STATE: ResourceState = {
  documents: "none",
  links: "none",
  datarooms: "none",
  analytics: "none",
  visitors: "none",
};

/** Infer the editor state (preset + resource map) from a stored scope string. */
export function scopesToEditorState(rawScopes: string | null | undefined): {
  preset: Preset;
  resourceState: ResourceState;
} {
  const list = (rawScopes ?? "")
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (list.length === 0 || list.includes("apis.all")) {
    return {
      preset: "all_access",
      resourceState: { ...DEFAULT_RESOURCE_STATE },
    };
  }
  if (list.includes("apis.read")) {
    return {
      preset: "read_only",
      resourceState: { ...DEFAULT_RESOURCE_STATE },
    };
  }

  const state: ResourceState = { ...DEFAULT_RESOURCE_STATE };
  for (const scope of list) {
    if (!GRANULAR_SCOPES.includes(scope as (typeof GRANULAR_SCOPES)[number]))
      continue;
    const [resource, action] = scope.split(".") as [Resource, "read" | "write"];
    if (!(resource in state)) continue;
    // `write` wins over `read` because we treat write as implying read.
    if (action === "write" || state[resource] === "none") {
      state[resource] = action;
    }
  }
  return { preset: "restricted", resourceState: state };
}

/** Pretty label for the permissions column in the table. */
export function scopesToPermissionLabel(
  rawScopes: string | null | undefined,
): string {
  const list = (rawScopes ?? "")
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length === 0 || list.includes("apis.all")) return "All access";
  if (list.includes("apis.read")) return "Read only";
  return "Restricted";
}
