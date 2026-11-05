// The registration policy: whether a new employee account waits for an admin's approval before it may
// sign in. The switch is off unless the environment turns it on, so the public deployment keeps the
// review step and an intranet instance can skip it.

/** The values that turn the switch on. Anything else, including an empty value, leaves it off. */
const ON = new Set(["1", "true", "yes"]);

/**
 * Whether MEMBERSHIP_AUTO_APPROVE lets a new registration sign in without an admin's approval.
 * Read on every use, so the deployment can turn it on or off without a rebuild.
 */
export function autoApproveEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return ON.has((env.MEMBERSHIP_AUTO_APPROVE ?? "").trim().toLowerCase());
}
