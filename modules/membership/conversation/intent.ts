export type ReadingIntent={kind:"detail";number:number}|{kind:"other"|"all"|"next"|"help"|"ping"|"unknown"}|{kind:"topic";topic:string};
export function readingIntent(input:string):ReadingIntent{
  const text=input.trim().replace(/\s+/g," ");
  const detail=/^(?:(?:展开|详情|看|阅读|深读|深度)\s*(?:第\s*)?|第\s*)?([1-5一二三四五])(?:\s*条)?$/.exec(text);
  if(detail)return {kind:"detail",number:/^[1-5]$/.test(detail[1]!)?Number(detail[1]):"一二三四五".indexOf(detail[1]!)+1};
  if(/^(其他|其它|其他主题|其它主题|剩下的|还有什么|还有哪些)$/.test(text))return {kind:"other"};
  if(/^(全部|完整|完整日报|全部日报|目录|看全部)$/.test(text))return {kind:"all"};
  if(/^(下一页|下页|下一批|翻页)$/.test(text))return {kind:"next"};
  if(/^(帮助|help|菜单|怎么用|使用说明)$/i.test(text))return {kind:"help"};
  if(/^(在|hi)$/i.test(text))return {kind:"ping"};
  const topic=/^主题[:：]\s*(.{1,30})$/.exec(text);
  return topic?{kind:"topic",topic:topic[1]!}:{kind:"unknown"};
}
