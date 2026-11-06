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

/** 注册页说明。开关打开时告诉员工注册后就能登录。 */
export function registerDescription(autoApprove: boolean): string {
  return autoApprove ? "注册后即可登录。" : "提交后由管理员审核账号。";
}

/** 注册按钮。 */
export function registerSubmitLabel(autoApprove: boolean): string {
  return autoApprove ? "注册" : "提交审核";
}

/** 注册成功后的提示。active 表示账号已经可以登录。 */
export function registerResultMessage(status: string): string {
  return status === "active" ? "注册成功，请使用用户名和密码登录。" : "注册已提交，管理员审核通过后即可登录。";
}

/** 登录被拒绝时的提示。免审开关打开后，不再说还要等管理员审核。 */
export function loginPendingMessage(skipsApproval: boolean): string {
  return skipsApproval ? "账号尚未开通，请联系管理员。" : "账号等待管理员审核。";
}
