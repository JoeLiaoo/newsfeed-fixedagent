export type ReadingIntent={kind:"detail";number:number}|{kind:"other"|"all"|"next"|"help"|"ping"|"unknown"}|{kind:"topic";topic:string};
export function readingIntent(input:string):ReadingIntent{
  const text=input.trim().replace(/\s+/g," ");
  const detail=/^(?:深读\s*|深度\s*|第\s*)([1-5])(?:\s*条)?$/.exec(text);
  if(detail)return {kind:"detail",number:Number(detail[1])};
  if(/^(其他|其它|其他主题)$/.test(text))return {kind:"other"};
  if(/^(全部|完整日报)$/.test(text))return {kind:"all"};
  if(/^(下一页|下页)$/.test(text))return {kind:"next"};
  if(/^(帮助|help|菜单)$/i.test(text))return {kind:"help"};
  if(/^(在|hi)$/i.test(text))return {kind:"ping"};
  const topic=/^主题[:：]\s*(.{1,30})$/.exec(text);
  return topic?{kind:"topic",topic:topic[1]!}:{kind:"unknown"};
}
