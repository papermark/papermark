import baseX from "base-x";

function encodeBase58(buf: Buffer): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

  return baseX(alphabet).encode(buf);
}
/**
 * Generate ids similar to stripe
 */
export class IdGenerator<TPrefixes extends string> {
  private prefixes: Record<TPrefixes, string>;

  /**
   * Create a new id generator with fully typed prefixes
   * @param prefixes - Relevant prefixes for your domain
   */
  constructor(prefixes: Record<TPrefixes, string>) {
    this.prefixes = prefixes;
  }

  /**
   * Generate a new unique base58 encoded uuid with a defined prefix
   *
   * @returns xxxxxx_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   */
  public id = (prefix: TPrefixes): string => {
    return [
      this.prefixes[prefix],
      encodeBase58(Buffer.from(crypto.randomUUID().replace(/-/g, ""), "hex")),
    ].join("_");
  };
}

export const newId = new IdGenerator({
  view: "view",
  videoView: "vview",
  linkView: "lview",
  inv: "inv", // invitation
  email: "email",
  doc: "doc",
  page: "page",
  dataroom: "dr",
  preview: "preview",
  webhook: "wh",
  webhookEvent: "evt",
  webhookSecret: "whsec",
  token: "pmk", // legacy dashboard token prefix (still accepted)
  tokenLive: "pm_live",
  clickEvent: "click",
  preset: "preset",
  pending: "pending", // for pending uploads
  upload: "upload", // opaque public upload session handle
}).id;
