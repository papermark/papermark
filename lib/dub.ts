import { Dub } from "dub";

export const dub = new Dub({
  token: process.env.DUB_API_KEY,
});

export async function getDubDiscountForExternalUserId(externalId: string) {
  try {
    const customers = await dub.customers.list({
      externalId,
      includeExpandedFields: true,
    });
    const first = customers.result[0];
    const couponId =
      process.env.NODE_ENV !== "production" && first?.discount?.couponTestId
        ? first.discount.couponTestId
        : first?.discount?.couponId;

    return couponId ? { discounts: [{ coupon: couponId }] } : null;
  } catch (err) {
    console.warn("Skipping Dub discount due to API error", err);
    return null; // degrade gracefully; don't block checkout
  }
}
