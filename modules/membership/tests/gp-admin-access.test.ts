import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { installModules } from "@aihot/backend/modules";
import { closeDb,sql } from "@aihot/backend/db";
import { stopBossNow } from "@aihot/backend/jobs/queue";
import { buildApp } from "../../../apps/api/src/app.ts";
import { SERVER_MODULES } from "../../../site/modules/server.ts";

test("GP admin APIs require admins and paginate filtered observations in stable order",async t=>{
  installModules(SERVER_MODULES);
  const app=await buildApp();
  t.after(async()=>{await app.close();await stopBossNow();await closeDb();});
  const suffix=randomUUID();
  const short=suffix.slice(0,8),adminName="gp-admin-"+short,memberName="gp-member-"+short;
  const credentials={host:"newsfeed.test",origin:"http://newsfeed.test"};
  for(const [username,realName] of [[adminName,"GP 管理员"],[memberName,"GP 员工"]]){
    const registration=await app.inject({method:"POST",url:"/api/v1/membership/register",headers:credentials,payload:{username,realName,password:"long-test-password-123"}});
    assert.equal(registration.statusCode,201);
  }
  await sql`UPDATE member_users SET status='active',role=CASE WHEN username=${adminName} THEN 'admin' ELSE 'member' END WHERE username IN (${adminName},${memberName})`;
  const [admin]=await sql<{id:string}[]>`SELECT id FROM member_users WHERE username=${adminName}`;
  const gp=randomUUID();
  await sql`INSERT INTO member_gp_watchlist(id,canonical_name,aliases,source_ref,status,entity_role,entity_id,reviewed_by,reviewed_at)
    VALUES(${gp},${"队列主体-"+suffix},ARRAY['人工核对别名'],'https://example.org/identity','candidate','gp','confirmed-entity',${admin!.id},now()),
          (${randomUUID()},${"队列主体乙-"+suffix},ARRAY[]::text[],'https://example.org/identity-b','candidate','gp',NULL,NULL,NULL)`;
  const observed=[randomUUID(),randomUUID()],baseline=randomUUID();
  await sql`INSERT INTO member_gp_investments(id,gp_id,investee_key,investee_name,raw_evidence,status,first_seen_at)
    VALUES(${observed[0]},${gp},${"obs-a-"+suffix},'观察甲',${sql.json({})},'observed','2026-10-20T00:00:00Z'),
          (${observed[1]},${gp},${"obs-b-"+suffix},'观察乙',${sql.json({})},'observed','2026-10-20T00:00:00Z'),
          (${baseline},${gp},${"base-"+suffix},'历史基线',${sql.json({})},'baseline','2026-10-21T00:00:00Z')`;
  const login=async(username:string)=>{
    const result=await app.inject({method:"POST",url:"/api/v1/membership/login",headers:{host:"newsfeed.test",origin:"http://newsfeed.test"},payload:{username,password:"long-test-password-123"}});
    assert.equal(result.statusCode,200);
    const cookie=result.headers["set-cookie"];
    return (Array.isArray(cookie)?cookie[0]!:cookie!).split(";",1)[0]!;
  };
  const adminCookie=await login(adminName),memberCookie=await login(memberName);
  for(const path of ["/api/v1/membership/admin/gps","/api/v1/membership/admin/gp-observations"]){
    assert.ok([401,403].includes((await app.inject({method:"GET",url:path})).statusCode));
    assert.equal((await app.inject({method:"GET",url:path,headers:{cookie:memberCookie}})).statusCode,403);
  }
  const partialPause=await app.inject({method:"PATCH",url:`/api/v1/membership/admin/gps/${gp}`,headers:{cookie:adminCookie,host:"newsfeed.test",origin:"http://newsfeed.test"},payload:{status:"paused"}});
  assert.equal(partialPause.statusCode,400);
  const [unchangedGp]=await sql<{aliases:string[];source_ref:string;entity_role:string;status:string}[]>`SELECT aliases,source_ref,entity_role,status FROM member_gp_watchlist WHERE id=${gp}`;
  assert.deepEqual(unchangedGp,{aliases:["人工核对别名"],source_ref:"https://example.org/identity",entity_role:"gp",status:"candidate"});
  const forbidden=await app.inject({method:"GET",url:"/api/v1/membership/admin/gp-observations",headers:{cookie:memberCookie}});
  assert.equal(forbidden.statusCode,403);
  const gps=await app.inject({method:"GET",url:"/api/v1/membership/admin/gps?status=candidate&limit=1",headers:{cookie:adminCookie}});
  assert.equal(gps.statusCode,200);
  assert.equal((await gps.json() as {gps:unknown[];pagination:{nextOffset:number|null}}).gps.length,1);
  assert.equal((await gps.json() as {pagination:{nextOffset:number|null}}).pagination.nextOffset,1);

  const groupPath=`/api/v1/membership/admin/gps/${gp}`;
  const patchHeaders={cookie:adminCookie,...credentials};
  const patchBody={role:"gp",status:"candidate",entityId:"confirmed-entity",creditCode:"",sourceRef:"https://example.org/identity",aliases:["人工核对别名"]};
  assert.equal((await app.inject({method:"PATCH",url:groupPath,headers:{cookie:memberCookie,...credentials},payload:{...patchBody,projectGroups:["citic-alliance"],projectGroupBasis:"分类依据已经核实"}})).statusCode,403);
  assert.equal((await app.inject({method:"PATCH",url:groupPath,headers:patchHeaders,payload:{...patchBody,projectGroups:["other"],projectGroupBasis:"分类依据已经核实"}})).statusCode,400);
  assert.equal((await app.inject({method:"PATCH",url:groupPath,headers:patchHeaders,payload:{...patchBody,projectGroups:["citic-alliance"],projectGroupBasis:""}})).statusCode,400);
  assert.equal((await app.inject({method:"PATCH",url:groupPath,headers:patchHeaders,payload:{...patchBody,projectGroups:["citic-alliance"]}})).statusCode,400);
  assert.equal((await app.inject({method:"PATCH",url:groupPath,headers:patchHeaders,payload:{...patchBody,projectGroups:["citic-alliance","market-leaders"],projectGroupBasis:"分类依据已经核实"}})).statusCode,200);
  const [grouped]=await sql<{project_groups:string[];project_group_basis:string}[]>`SELECT project_groups,project_group_basis FROM member_gp_watchlist WHERE id=${gp}`;
  assert.deepEqual(grouped,{project_groups:["citic-alliance","market-leaders"],project_group_basis:"分类依据已经核实"});

  const first=await app.inject({method:"GET",url:"/api/v1/membership/admin/gp-observations?status=observed&limit=1",headers:{cookie:adminCookie}});
  assert.equal(first.statusCode,200);
  const firstBody=await first.json() as {observations:Array<{id:string}>;pagination:{nextOffset:number|null}};
  assert.equal(firstBody.observations.length,1);
  assert.equal(firstBody.observations[0]?.id,[...observed].sort().reverse()[0]);
  assert.equal(firstBody.pagination.nextOffset,1);
  const second=await app.inject({method:"GET",url:"/api/v1/membership/admin/gp-observations?status=observed&limit=1&offset=1",headers:{cookie:adminCookie}});
  assert.equal(((await second.json()) as {observations:Array<{id:string}>}).observations[0]?.id,[...observed].sort()[0]);
  const filtered=await app.inject({method:"GET",url:"/api/v1/membership/admin/gp-observations?status=baseline",headers:{cookie:adminCookie}});
  assert.deepEqual(((await filtered.json()) as {observations:Array<{id:string}>}).observations.map(row=>row.id),[baseline]);
  assert.equal((await app.inject({method:"GET",url:"/api/v1/membership/admin/gp-observations?status=unknown",headers:{cookie:adminCookie}})).statusCode,400);
  assert.equal((await app.inject({method:"GET",url:"/api/v1/membership/admin/gp-observations?status=",headers:{cookie:adminCookie}})).statusCode,400);
  assert.equal((await app.inject({method:"GET",url:"/api/v1/membership/admin/gps?status=",headers:{cookie:adminCookie}})).statusCode,400);

  const reject=await app.inject({method:"PATCH",url:`/api/v1/membership/admin/gp-observations/${observed[0]}`,headers:{cookie:adminCookie,host:"newsfeed.test",origin:"http://newsfeed.test"},payload:{tags:["光伏"],status:"verified",eventDate:"2026-02-30",sourceUrl:"https://example.org/evidence"}});
  assert.equal(reject.statusCode,400);
  assert.equal((await reject.json() as {error:string}).error,"event_evidence_required");
  const missingEvidence=await app.inject({method:"PATCH",url:`/api/v1/membership/admin/gp-observations/${observed[0]}`,headers:{cookie:adminCookie,host:"newsfeed.test",origin:"http://newsfeed.test"},payload:{tags:["光伏"],status:"verified",eventDate:"2026-02-28",sourceUrl:"https://"}});
  assert.equal(missingEvidence.statusCode,400);
  assert.equal((await missingEvidence.json() as {error:string}).error,"event_evidence_required");
  const approve=await app.inject({method:"PATCH",url:`/api/v1/membership/admin/gp-observations/${observed[0]}`,headers:{cookie:adminCookie,host:"newsfeed.test",origin:"http://newsfeed.test"},payload:{tags:["光伏"],status:"verified",eventDate:"2026-02-28",sourceUrl:"https://example.org/evidence"}});
  assert.equal(approve.statusCode,200);
  const provincePath=`/api/v1/membership/admin/gp-observations/${observed[0]}/province`;
  assert.equal((await app.inject({method:"POST",url:provincePath,headers:{cookie:memberCookie,...credentials}})).statusCode,403);
  assert.equal((await app.inject({method:"POST",url:provincePath,headers:patchHeaders})).statusCode,409,"no Xinhua entity ID must stay unknown without making a provider request");
  const noRelationEvidence=await app.inject({method:"PATCH",url:`/api/v1/membership/admin/gp-observations/${observed[0]}`,headers:patchHeaders,payload:{tags:["光伏"],status:"verified",eventDate:"2026-02-28",sourceUrl:"https://example.org/evidence",motherFund:"母基金甲",subfund:"子基金甲",fundRelationBasis:"已核验基金关系依据"}});
  assert.equal(noRelationEvidence.statusCode,400);
  const relation=await app.inject({method:"PATCH",url:`/api/v1/membership/admin/gp-observations/${observed[0]}`,headers:patchHeaders,payload:{tags:["光伏"],status:"verified",eventDate:"2026-02-28",sourceUrl:"https://example.org/evidence",motherFund:"母基金甲",subfund:"子基金甲",fundRelationBasis:"已核验基金关系依据",fundRelationSourceUrl:"https://example.org/fund-relation"}});
  assert.equal(relation.statusCode,200);
  const [relationRow]=await sql<{mother_fund_name:string;subfund_name:string;fund_relation_source_url:string}[]>`SELECT mother_fund_name,subfund_name,fund_relation_source_url FROM member_gp_investments WHERE id=${observed[0]}`;
  assert.deepEqual(relationRow,{mother_fund_name:"母基金甲",subfund_name:"子基金甲",fund_relation_source_url:"https://example.org/fund-relation"});
  const [approved]=await sql<{status:string;approved_event_date:string;approved_source_url:string}[]>`SELECT status,approved_event_date::text,approved_source_url FROM member_gp_investments WHERE id=${observed[0]}`;
  assert.deepEqual(approved,{status:"verified",approved_event_date:"2026-02-28",approved_source_url:"https://example.org/evidence"});
});
