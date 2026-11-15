import {test,expect} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAgentApp} from './agent/http';
import {readConfig} from './agent/config';
import {DurableSession} from './agent/session';
import {now} from './agent/models';

async function fixture(run:(app:any,account:string)=>Promise<void>){
 const directory=await mkdtemp(join(tmpdir(),'carmeleon-review-'));
 const app=await createAgentApp(readConfig({CARMELEON_AGENT_DATA_DIR:directory}));
 try{
  const auth=await app.auth.credentials({email:'review@example.test',password:'review-isolated-2026'},true,'local-review');
  await run(app,auth.account.id);
 }finally{await app.close();await rm(directory,{recursive:true,force:true});}
}
const stops=[{id:'visit',name:'검토 방문지',coordinate:{latitude:37.5,longitude:127},materialIds:[],memoryIds:[]}];
const create=(app:any,account:string)=>app.domain.createPath(account,{title:'검토 경로',mode:'TRAVEL',stops});
const operationId=()=>crypto.randomUUID();
test('distinct path sessions remain isolated and can resume the original path',()=>fixture(async(app,account)=>{
 const a=await create(app,account), b=await create(app,account);
 const sessionA=new DurableSession(app.store,account,'unchanged-runtime-session',a.id,'turn-a');
 await sessionA.addItems([{role:'user',content:'A 경로 대화'}]);
 const sessionB=new DurableSession(app.store,account,'path-b-session',b.id,'turn-b');
 expect(await sessionB.getItems()).toEqual([]);
 await sessionB.addItems([{role:'user',content:'B 경로 대화'}]);
 expect(JSON.stringify(await sessionA.getItems())).toContain('A 경로 대화');
 expect(JSON.stringify(await sessionA.getItems())).not.toContain('B 경로 대화');
}));
test('deleted material references are detached with a path revision and do not poison later edits',()=>fixture(async(app,account)=>{
 let p=await create(app,account);
 const form=new FormData();form.set('pathId',p.id);form.set('file',new File(['검토용본문'], 'review.txt',{type:'text/plain'}));
 const material=await app.materials.upload(account,form);
 for(let i=0;i<100;i++){if((await app.materials.metadata(account,material.id)).state!=='PROCESSING')break;await Bun.sleep(20);}
 p=await app.domain.savePath(account,p.id,{...p,stops:[{...stops[0],materialIds:[material.id]}],baseRevision:p.revision,operationId:operationId()});
 await app.materials.remove(account,material.id,{baseRevision:material.revision,confirmed:true,operationId:operationId()});
 const latest=await app.domain.path(account,p.id);
 expect(latest.revision).toBe(p.revision+1);
 expect(latest.stops[0].materialIds).toEqual([]);
 const edited=await app.domain.savePath(account,p.id,{...latest,title:'이름만 바꿈',baseRevision:latest.revision,operationId:operationId()});
 expect(edited.title).toBe('이름만 바꿈');expect((await app.materials.list(account,p.id)).length).toBe(0);
}));
test('transient observation polling preserves a decision but confirmed external edits invalidate it',()=>fixture(async(app,account)=>{
 const p=await create(app,account);
 const guiding={status:'GUIDING',source:'PLEOS',fingerprint:'route:GUIDING:37.5,127',routeId:'route',observedAt:now(),stops};
 await app.domain.guidance(account,p.id,guiding);
 const proposal=await app.domain.propose(account,p.id,{baseRevision:p.revision,stops,reason:'확인할 변경안',guidanceFingerprint:guiding.fingerprint,operationId:operationId()});
 await Bun.sleep(3);
 await app.domain.guidance(account,p.id,{...guiding,status:'UNKNOWN',fingerprint:'route:UNKNOWN:37.5,127',observedAt:now()});
 await Bun.sleep(3);
 await app.domain.guidance(account,p.id,{...guiding,observedAt:now()});
 const result=(await app.domain.proposals(account,p.id)).find((x:any)=>x.id===proposal.id);
 expect(result.status).toBe('PENDING');
 await Bun.sleep(3);
 await app.domain.guidance(account,p.id,{...guiding,refreshing:true,observedAt:now()});
 await expect(app.domain.decide(account,proposal.id,{accepted:true,baseRevision:1,source:'BUTTON',guidanceFingerprint:guiding.fingerprint,operationId:operationId()})).rejects.toMatchObject({code:'GUIDANCE_UNCONFIRMED'});
 expect((await app.domain.proposals(account,p.id))[0].status).toBe('PENDING');
 await Bun.sleep(3);
 await app.domain.guidance(account,p.id,{...guiding,fingerprint:'confirmed-other-route',observedAt:now()});
 expect((await app.domain.proposals(account,p.id))[0].status).toBe('STALE');
}));
import {Runner,Usage,type Model,type ModelRequest,type ModelResponse} from '@openai/agents';
import {AgentService} from './agent/agent';
class EarlyApprovalModel implements Model {
 step=0;
 constructor(private proposalId:()=>Promise<string>){}
 async getResponse(_request:ModelRequest):Promise<ModelResponse>{return {usage:new Usage({inputTokens:1,outputTokens:1,totalTokens:2}),output:[]};}
 async *getStreamedResponse(_request:ModelRequest):AsyncGenerator<any>{
  const step=this.step++;
  if(step===0){
   const args={baseRevision:1,reason:'즉시 승인 검토',stops:stops.map(s=>({id:s.id,name:s.name,latitude:s.coordinate.latitude,longitude:s.coordinate.longitude,purpose:null,appointmentAt:null,timeZone:null,dwellMinutes:null}))};
   yield {type:'response_done',response:{id:'review-response',usage:{inputTokens:1,outputTokens:1,totalTokens:2},output:[{type:'function_call',callId:'review-call',name:'path_propose_changes',arguments:JSON.stringify(args)}]}};
  }else if(step===1){
   yield {type:'response_done',response:{id:'review-approval',usage:{inputTokens:1,outputTokens:1,totalTokens:2},output:[{type:'function_call',callId:'review-approval-call',name:'request_path_application',arguments:JSON.stringify({proposalId:await this.proposalId()})}]}};
  }else{
   yield {type:'output_text_delta',delta:'처리했어요.'};
   yield {type:'response_done',response:{id:'review-finish',usage:{inputTokens:1,outputTokens:1,totalTokens:2},output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'처리했어요.'}]}]}};
  }
 }
}
test('the first actionable decision is durable before an immediate approval and resume',()=>fixture(async(app,account)=>{
 const p=await create(app,account);
 const service=new AgentService(app.domain,app.materials,{...app.agent.config,model:'fixture',apiKey:'fixture'});
 const model=new EarlyApprovalModel(async()=> (await app.domain.proposals(account,p.id))[0].id);service.runner=()=>new Runner({modelProvider:{getModel:async()=>model},tracingDisabled:true});
 const initial=await service.begin(account,{turnId:'first-turn',sessionId:'approval-session',pathId:p.id,text:'검토'});
 let proposalId='';let stateAtCard='';
 await service.execute(account,initial,async event=>{
  if(event.event==='decision.required' && !proposalId){
   const proposal=event.proposal as any;proposalId=proposal.id;
   stateAtCard=(await service.record(account,initial.turnId)).status;
   await app.domain.decide(account,proposalId,{accepted:true,baseRevision:1,source:'BUTTON',operationId:operationId()});
   // Runtime.decide calls submit(), whose interrupt() cancels the old stream before resuming.
   await service.cancel(account,initial.turnId);
  }
 });
 expect(stateAtCard).toBe('WAITING_APPROVAL');
 const resumed=await service.begin(account,{turnId:'second-turn',sessionId:'approval-session',pathId:p.id,text:'승인',resumeDecisionId:proposalId});
 const events:any[]=[];await service.execute(account,resumed,async e=>{events.push(e)});
 const error=events.find(e=>e.event==='turn.error');
 expect(error).toBeUndefined();
 expect(events.some(e=>e.event==='turn.completed')).toBe(true);
 expect((await app.domain.path(account,p.id)).revision).toBe(2);
 expect((await app.domain.actions(account,p.id)).length).toBe(1);
}));

test('unprepared model proposals cannot be approved via REST',()=>fixture(async(app,account)=>{
 const p=await create(app,account);
 const proposal=await app.domain.propose(account,p.id,{baseRevision:1,stops,reason:'아직 준비 중',operationId:operationId()},'running-turn');
 expect(proposal.approvalReady).toBe(false);
 await expect(app.domain.decide(account,proposal.id,{accepted:true,baseRevision:1,source:'BUTTON',operationId:operationId()})).rejects.toMatchObject({code:'DECISION_NOT_READY'});
 expect((await app.domain.actions(account,p.id)).length).toBe(0);
}));
test('memory deletion detaches every linked path atomically and preserves history',()=>fixture(async(app,account)=>{
 let a=await create(app,account),b=await create(app,account);
 const memory=await app.domain.createMemory(account,{text:'기억',kind:'USER_FACT',operationId:operationId()});
 for(const p of [a,b]) await app.domain.savePath(account,p.id,{...p,stops:[{...stops[0],memoryIds:[memory.id]}],baseRevision:p.revision,operationId:operationId()});
 await app.domain.editMemory(account,memory.id,{baseRevision:1,operationId:operationId()},true);
 for(const p of [a,b]){const latest=await app.domain.path(account,p.id);expect(latest.revision).toBe(3);expect(latest.stops[0].memoryIds).toEqual([]);}
 expect((await app.domain.memoryHistory(account,memory.id)).length).toBe(2);
}));
test('only completed submitted chunks enter delivered history and interrupted chunks stay unconfirmed',()=>fixture(async(app,account)=>{
 const p=await create(app,account);
 const session=new DurableSession(app.store,account,'chunk-session',p.id,'chunk-turn');
 await session.addItems([{role:'user',content:'말해줘'}]);
 await app.store.write(account,async(r:any)=>{
  await r.put('turn','chunk-turn',{turnId:'chunk-turn',pathId:p.id,generatedText:'버린 앞 문장. 재생한 뒤 문장.',status:'COMPLETED'});
  await r.put('speech-chunk','first',{turnId:'chunk-turn',chunkId:'first',sequence:1,text:'버린 앞 문장.',isFinal:false});
  await r.put('speech-chunk','last',{turnId:'chunk-turn',chunkId:'last',sequence:2,text:'재생한 뒤 문장.',isFinal:true});
  await r.put('playback','last-completed',{turnId:'chunk-turn',chunkId:'last',status:'COMPLETED',at:now()});
 });
 let items=JSON.stringify(await session.getItems());
 expect(items).toContain('재생한 뒤 문장.');expect(items).not.toContain('버린 앞 문장.');
 await app.store.write(account,(r:any)=>r.put('playback','last-uncertain',{turnId:'chunk-turn',chunkId:'last',status:'UNKNOWN',at:now()}));
 items=JSON.stringify(await session.getItems());expect(items).not.toContain('재생한 뒤 문장.');
}));
test('recover exposes only a matching durable legacy approval without executing it',()=>fixture(async(app,account)=>{
 const p=await create(app,account);
 const service=new AgentService(app.domain,app.materials,{...app.agent.config,model:'fixture',apiKey:'fixture'});
 const model=new EarlyApprovalModel(async()=> (await app.domain.proposals(account,p.id))[0].id);
 service.runner=()=>new Runner({modelProvider:{getModel:async()=>model},tracingDisabled:true});
 const input=await service.begin(account,{turnId:'legacy-approval',sessionId:'legacy-session',pathId:p.id,text:'변경 검토'});
 await service.execute(account,input,async()=>{});
 const proposal=(await app.domain.proposals(account,p.id))[0];
 await app.store.write(account,(r:any)=>{const {approvalReady,...legacy}=proposal;return r.put('proposal',proposal.id,legacy)});
 await service.recover();
 expect((await app.domain.proposals(account,p.id))[0].approvalReady).toBe(true);
 expect((await app.domain.actions(account,p.id)).length).toBe(0);
 expect((await app.domain.path(account,p.id)).revision).toBe(1);
}));
