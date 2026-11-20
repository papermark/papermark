import { ZodType, ZodTypeDef } from "zod";

/**
 * Reads and validates a route handler's JSON body.
 *
 * `req.json()` throws on an absent or malformed body, which would surface as a
 * 500 rather than the 400 the schema failure produces. Both paths are folded
 * into the same `safeParse` failure so the caller only has one to answer.
 */
export async function parseJsonBody<TOut, TDef extends ZodTypeDef, TIn>(
  req: Request,
  schema: ZodType<TOut, TDef, TIn>,
) {
  const body = await req.json().catch(() => undefined);
  return schema.safeParse(body);
}
