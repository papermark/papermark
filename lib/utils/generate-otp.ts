import { randomInt } from "node:crypto";

export function generateOTP(): string {
  // Use a CSPRNG to avoid predictable codes (CodeQL js/insecure-randomness).
  // randomInt(min, max) returns a uniformly distributed integer in [min, max),
  // avoiding the modulo bias you'd get from converting random bytes manually.
  const randomNumber = randomInt(0, 1_000_000);

  return randomNumber.toString().padStart(6, "0");
}
