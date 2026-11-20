/**
 * Naming a team after the organisation behind it. Signup cannot know that name,
 * so it uses a placeholder; anything that later learns the real one — a data
 * room trial, a partner enrolment — replaces the placeholder and only that.
 */

/** What the team settings form accepts. */
export const TEAM_NAME_MAX_LENGTH = 32;

/**
 * The names `pages/api/teams/index.ts` gives a team at signup. They name the
 * person, or nothing at all, so they say nothing about the organisation and are
 * safe to replace. A name anyone chose deliberately is never overwritten.
 */
export function isGeneratedTeamName(
  teamName?: string | null,
  userName?: string | null,
) {
  const name = teamName?.trim().toLowerCase();
  if (!name) return true;
  if (name === "personal team") return true;

  const owner = userName?.trim().toLowerCase();
  return !!owner && name === `${owner}'s team`;
}

/**
 * "Acme" → "Acme Team". Already ends in "team" — "Acme Team", "Acme team" — and
 * it is left as it is rather than becoming "Acme Team Team".
 */
export function companyTeamName(companyName?: string | null) {
  const base = companyName?.trim().replace(/\s+/g, " ") ?? "";
  if (!base) return "";

  const named = /\bteams?$/i.test(base) ? base : `${base} Team`;
  return named.slice(0, TEAM_NAME_MAX_LENGTH).trim();
}

/**
 * The inverse: "Acme Team" → "Acme". The suffix belongs to the workspace, not to
 * the organisation, so anything addressed to the outside — a referral link, an
 * invite from the fund — drops it. Returns the name unchanged when "team" is all
 * there is, since "" would say less than "Team" does.
 */
export function withoutTeamSuffix(teamName?: string | null) {
  const base = teamName?.trim().replace(/\s+/g, " ") ?? "";
  const stripped = base.replace(/\s+teams?$/i, "").trim();
  return stripped || base;
}
