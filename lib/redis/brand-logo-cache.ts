import {
  type BrandLogoFields,
  type ResolvedBrandLogo,
  resolveBrandLogo,
} from "@/ee/features/branding/lib/brand-logo";

import { redis } from "@/lib/redis";

/**
 * Mirror of the team's logo decision, so surfaces that only need "what goes in
 * the logo slot" (currently the OTP verification email) can answer it with one
 * cache read instead of a Postgres query.
 *
 * The logo URL keeps its original key and value shape, so entries written
 * before the hide setting existed keep resolving correctly. Hiding rides on a
 * companion key where presence is the whole signal, which means an absent key
 * reads as "not hidden" and matches the column default.
 */
const logoKey = (teamId: string) => `brand:logo:${teamId}`;
const hideLogoKey = (teamId: string) => `brand:hide-logo:${teamId}`;

export function decodeCachedBrandLogo(
  logo: unknown,
  hideLogo: unknown,
): ResolvedBrandLogo {
  return resolveBrandLogo({
    logo: typeof logo === "string" ? logo : null,
    hideLogo: hideLogo != null,
  });
}

export async function readCachedBrandLogo(
  teamId: string,
): Promise<ResolvedBrandLogo> {
  const [logo, hideLogo] = await redis.mget<[unknown, unknown]>(
    logoKey(teamId),
    hideLogoKey(teamId),
  );

  return decodeCachedBrandLogo(logo, hideLogo);
}

/**
 * Call with the row the write actually persisted, not the request body: a PUT
 * that omits `logo` leaves the column untouched, so mirroring the body would
 * evict a logo that is still set.
 */
export async function writeCachedBrandLogo(
  teamId: string,
  brand: BrandLogoFields,
): Promise<void> {
  const pipeline = redis.pipeline();

  if (brand.logo) {
    pipeline.set(logoKey(teamId), brand.logo);
  } else {
    pipeline.del(logoKey(teamId));
  }

  if (brand.hideLogo) {
    pipeline.set(hideLogoKey(teamId), "1");
  } else {
    pipeline.del(hideLogoKey(teamId));
  }

  await pipeline.exec();
}

export async function clearCachedBrandLogo(teamId: string): Promise<void> {
  await redis.del(logoKey(teamId), hideLogoKey(teamId));
}
