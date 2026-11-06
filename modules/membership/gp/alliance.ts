/** 中信股权联盟清单允许出现的投资机构。母基金字段存的就是这些名字。 */
export const ALLIANCE_INSTITUTIONS = ["中信金石", "中信建投资本"] as const;

export type AllianceInstitution = (typeof ALLIANCE_INSTITUTIONS)[number];

/**
 * 投资机构下拉：只保留上面两个名字。
 * 接口已经返回其中至少一个时，按数据里实际有的来；一个都没有时仍给出这两个，避免筛选框是空的。
 */
export function allianceInstitutionOptions(fromServer: readonly string[]): string[] {
  const present = ALLIANCE_INSTITUTIONS.filter((name) => fromServer.includes(name));
  return present.length > 0 ? [...present] : [...ALLIANCE_INSTITUTIONS];
}

export function isAllianceInstitution(value: string): value is AllianceInstitution {
  return (ALLIANCE_INSTITUTIONS as readonly string[]).includes(value);
}
