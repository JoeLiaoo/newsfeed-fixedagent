import { createHash } from "node:crypto";
import { GP_TAGS } from "./core.ts";
import { provinceFromAddress } from "./province.ts";
import { isAllianceInstitution, type AllianceInstitution } from "./alliance.ts";
import { readZipText } from "./zip-text.ts";

/** 烯牛行业词到平台赛道的粗映射。对不上的行业最后落到“其他”，不新造赛道名。 */
const INDUSTRY_RULES: Array<[RegExp, string]> = [
  [/人工智能|机器学习|深度学习/, "人工智能"],
  [/大模型|基础模型|AGI/, "基础模型"],
  [/算力|数据中心/, "算力与数据中心"],
  [/网络安全|信息安全/, "网络安全"],
  [/工业软件|\bEDA\b/, "工业软件"],
  [/半导体|集成电路|芯片/, "半导体与集成电路"],
  [/光伏/, "光伏"],
  [/风电|风力发电/, "风电"],
  [/储能/, "新型储能"],
  [/氢能|氢燃料/, "氢能"],
  [/新能源汽车|动力电池|锂电|电解液/, "新能源汽车与动力电池"],
  [/核聚变|核能|核反应/, "核能与可控核聚变"],
  [/机器人|自动化/, "机器人与自动化"],
  [/航天|卫星|航空/, "航空航天装备"],
  [/低空|无人机/, "低空装备"],
  [/船舶|海洋工程/, "船舶与海洋工程装备"],
  [/传感器|仪器/, "高端仪器与传感器"],
  [/增材|3D打印/, "增材制造"],
  [/轨道交通/, "轨道交通装备"],
  [/机床|数控/, "工业母机与数控装备"],
  [/复合材料/, "高性能复合材料"],
  [/高分子/, "高性能高分子"],
  [/金属材料/, "先进金属材料"],
  [/无机非金属/, "先进无机非金属"],
  [/电子信息材料/, "电子信息材料"],
  [/新能源材料/, "新能源材料"],
  [/新材料|前沿材料/, "前沿材料"],
  [/电网|能源数字化/, "电网与能源数字化"],
  [/智能终端/, "智能终端"],
  [/Agent/, "垂直应用 Agent"],
  [/AI for Science|科学智能/, "AI for Science"],
];

/** 烯牛地区左侧经常是城市，不是省名。只收录这批页面里出现过的城市。 */
const CITY_PROVINCE: Record<string, string> = {
  "上饶市": "江西省", "东莞市": "广东省", "东营市": "山东省", "临汾市": "山西省", "临沂市": "山东省",
  "丹东市": "辽宁省", "丽水市": "浙江省", "乌兰察布市": "内蒙古自治区", "乌鲁木齐市": "新疆维吾尔自治区",
  "乐山市": "四川省", "九江市": "江西省", "云浮市": "广东省", "佛山市": "广东省", "保定市": "河北省",
  "兰州市": "甘肃省", "北海市": "广西壮族自治区", "南京市": "江苏省", "南宁市": "广西壮族自治区",
  "南昌市": "江西省", "南通市": "江苏省", "厦门市": "福建省", "台州市": "浙江省", "合肥市": "安徽省",
  "吉林市": "吉林省", "咸宁市": "湖北省", "咸阳市": "陕西省", "哈尔滨市": "黑龙江省", "唐山市": "河北省",
  "嘉兴市": "浙江省", "大理白族自治州": "云南省", "大连市": "辽宁省", "太原市": "山西省", "宁波市": "浙江省",
  "宜宾市": "四川省", "宜春市": "江西省", "宝鸡市": "陕西省", "宣城市": "安徽省", "宿州市": "安徽省",
  "宿迁市": "江苏省", "山南市": "西藏自治区", "岳阳市": "湖南省", "常州市": "江苏省", "常德市": "湖南省",
  "平顶山市": "河南省", "广州市": "广东省", "廊坊市": "河北省", "徐州市": "江苏省", "德州市": "山东省",
  "德阳市": "四川省", "惠州市": "广东省", "成都市": "四川省", "扬州市": "江苏省", "抚州市": "江西省",
  "文山壮族苗族自治州": "云南省", "无锡市": "江苏省", "昆明市": "云南省", "昌都市": "西藏自治区",
  "晋城市": "山西省", "朔州市": "山西省", "来宾市": "广西壮族自治区", "杭州市": "浙江省", "枣庄市": "山东省",
  "柳州市": "广西壮族自治区", "株洲市": "湖南省", "楚雄彝族自治州": "云南省", "武汉市": "湖北省",
  "江门市": "广东省", "沈阳市": "辽宁省", "沧州市": "河北省", "泉州市": "福建省", "泰安市": "山东省",
  "泰州市": "江苏省", "洛阳市": "河南省", "济南市": "山东省", "海口市": "海南省",
  "海西蒙古族藏族自治州": "青海省", "淄博市": "山东省", "淮安市": "江苏省", "深圳市": "广东省",
  "清远市": "广东省", "温州市": "浙江省", "湖州市": "浙江省", "漳州市": "福建省", "潍坊市": "山东省",
  "濮阳市": "河南省", "烟台市": "山东省", "珠海市": "广东省", "盐城市": "江苏省", "盘锦市": "辽宁省",
  "眉山市": "四川省", "石家庄市": "河北省", "福州市": "福建省", "秦皇岛市": "河北省",
  "红河哈尼族彝族自治州": "云南省", "绍兴市": "浙江省", "聊城市": "山东省", "肇庆市": "广东省",
  "舟山市": "浙江省", "芜湖市": "安徽省", "苏州市": "江苏省", "茂名市": "广东省", "荆门市": "湖北省",
  "莆田市": "福建省", "蚌埠市": "安徽省", "衡阳市": "湖南省", "衢州市": "浙江省", "西宁市": "青海省",
  "西安市": "陕西省", "许昌市": "河南省", "贵港市": "广西壮族自治区", "贵阳市": "贵州省", "赣州市": "江西省",
  "连云港市": "江苏省", "邯郸市": "河北省", "郑州市": "河南省", "鄂尔多斯市": "内蒙古自治区",
  "酒泉市": "甘肃省", "金华市": "浙江省", "金昌市": "甘肃省", "银川市": "宁夏回族自治区",
  "锦州市": "辽宁省", "镇江市": "江苏省", "长春市": "吉林省", "长沙市": "湖南省", "阳江市": "广东省",
  "随州市": "湖北省", "青岛市": "山东省", "韶关市": "广东省", "马鞍山市": "安徽省", "鹰潭市": "江西省",
  "黄山市": "安徽省", "黄石市": "湖北省",
};

export type AllianceProject = {
  institution: AllianceInstitution;
  companyName: string;
  investeeKey: string;
  summary: string;
  industry: string;
  sectorTags: string[];
  foundedOn: string | null;
  region: string;
  projectProvince: string | null;
  eventDate: string | null;
  round: string;
  inferredRound: string;
  amount: string;
  investors: string;
};

const SOURCE_PAGE = "https://vip.xiniudata.com/lib2/project";

/** 同一机构下按公司名去重，保留先出现的一行（页面按最新融资日期从新到旧）。 */
export function parseAllianceMarkdown(files: Iterable<[string, string]>): { projects: AllianceProject[]; skipped: number } {
  const seen = new Map<string, AllianceProject>();
  let skipped = 0;
  const ordered = [...files].sort((a, b) => a[0].localeCompare(b[0], "zh-CN"));
  for (const [path, markdown] of ordered) {
    const institution = institutionFromPath(path) ?? institutionFromMarkdown(markdown);
    if (!institution) { skipped++; continue; }
    for (const row of tableRows(markdown)) {
      const companyName = row[1]?.trim() ?? "";
      if (!companyName || companyName === "公司名") { skipped++; continue; }
      const identity = `${institution}\u0000${companyName.normalize("NFKC")}`;
      if (seen.has(identity)) continue;
      const industry = row[3]?.trim() ?? "";
      const region = row[5]?.trim() ?? "";
      seen.set(identity, {
        institution,
        companyName,
        investeeKey: investeeKey(companyName),
        summary: row[2]?.trim() ?? "",
        industry,
        sectorTags: sectorTagsFromXiniu(industry),
        foundedOn: calendarDate(row[4] ?? ""),
        region,
        projectProvince: provinceFromXiniuRegion(region),
        eventDate: calendarDate(row[6] ?? ""),
        round: row[7]?.trim() ?? "",
        inferredRound: row[8]?.trim() ?? "",
        amount: row[9]?.trim() ?? "",
        investors: row[10]?.trim() ?? "",
      });
    }
  }
  return { projects: [...seen.values()], skipped };
}

export function parseAllianceZip(buffer: Buffer): { projects: AllianceProject[]; skipped: number; files: number } {
  const files = readZipText(buffer);
  const parsed = parseAllianceMarkdown(files);
  return { ...parsed, files: files.size };
}

export function sectorTagsFromXiniu(industry: string): string[] {
  const parts = industry.split(/[、,，]/).map((part) => part.trim()).filter(Boolean);
  const tags = new Set<string>();
  for (const part of parts.length ? parts : [industry.trim()].filter(Boolean)) {
    if ((GP_TAGS as readonly string[]).includes(part)) { tags.add(part); continue; }
    for (const [pattern, tag] of INDUSTRY_RULES) if (pattern.test(part)) tags.add(tag);
  }
  if (!tags.size) tags.add("其他");
  return [...tags];
}

export function provinceFromXiniuRegion(region: string): string | null {
  const text = region.trim();
  if (!text) return null;
  const direct = provinceFromAddress(text);
  if (direct) return direct;
  const head = text.split(">")[0]?.trim() ?? "";
  return provinceFromAddress(head) ?? CITY_PROVINCE[head] ?? null;
}

export function calendarDate(value: string): string | null {
  const text = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const parsed = new Date(`${text}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text ? text : null;
}

export function investeeKey(companyName: string): string {
  const key = companyName.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase();
  return createHash("sha256").update(`xiniu:${key}`).digest("hex");
}

/** 没有可核对的 https 来源时，用演示域名占位。员工页会标成导入占位，不提供可点击链接。 */
export function alliancePlaceholderUrl(institution: string, key: string): string {
  return `https://example.org/citic-alliance-import/${encodeURIComponent(institution)}/${key}`;
}

export function allianceSourceRef(institution: AllianceInstitution): string {
  return `烯牛项目库投资机构筛选：${institution}（${SOURCE_PAGE}）`;
}

export const ALLIANCE_GROUP_BASIS = "烯牛项目库按投资机构名称归入中信股权联盟，导入时无独立核验证据。";

export function allianceEntityId(institution: AllianceInstitution): string {
  return institution === "中信金石" ? "xiniu-institution:citic-jinshi" : "xiniu-institution:citic-construction";
}

export function allianceGpId(institution: AllianceInstitution): string {
  return institution === "中信金石" ? "gp-xiniu-citic-jinshi" : "gp-xiniu-citic-construction";
}

function institutionFromPath(path: string): AllianceInstitution | null {
  const folder = path.split("/").slice(0, -1).join("/");
  if (folder.includes("中信建投资本")) return "中信建投资本";
  if (folder.includes("中信金石")) return "中信金石";
  return null;
}

function institutionFromMarkdown(markdown: string): AllianceInstitution | null {
  const matched = markdown.match(/投资机构[「“]([^」”]+)[」”]/);
  const name = matched?.[1]?.trim() ?? "";
  return isAllianceInstitution(name) ? name : null;
}

function tableRows(markdown: string): string[][] {
  const rows: string[][] = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith("|")) continue;
    if (/^\|\s*-+/.test(line)) continue;
    const cells = line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
    if (cells[0] === "序号") continue;
    if (cells.length < 11) continue;
    rows.push(cells);
  }
  return rows;
}
