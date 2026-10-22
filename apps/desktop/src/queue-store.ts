import{app,safeStorage}from"electron";
import{randomUUID}from"node:crypto";
import{readFile,rename,writeFile}from"node:fs/promises";
import path from"node:path";
import type{QueueInput,QueueOperation}from"./types";

const allowedEndpoints=[/^\/api\/waste\/recycling(?:\/|$)/,/^\/api\/waste\/driver(?:-|\/|$)/,/^\/api\/waste\/customer-collection-stops(?:\/|$)/,/^\/api\/waste\/collection-jobs(?:\/|$)/,/^\/api\/waste\/citizen-issues(?:\/|$)/,/^\/api\/waste\/job-problems(?:\/|$)/];
const forbidden=/(billing|payment|contract|permit|account|access|payroll|weighbridge|compliance|platform|manager-float|cash-movements)/i;
function validate(input:QueueInput){if(!allowedEndpoints.some(rule=>rule.test(input.endpoint))||forbidden.test(input.endpoint))throw new Error("This action requires an online connection");if(!["POST","PUT","PATCH"].includes(input.method))throw new Error("Unsupported offline action");if(!input.organizationId||!input.userId)throw new Error("Organization and user context are required");const bytes=Buffer.byteLength(JSON.stringify(input.body??null));if(bytes>5_000_000)throw new Error("Offline action is larger than 5 MB");}

export class QueueStore{
  private records:QueueOperation[]=[];
  private readonly file=path.join(app.getPath("userData"),"offline-queue.dat");
  async load(){try{const encoded=await readFile(this.file);if(!safeStorage.isEncryptionAvailable())return;const json=safeStorage.decryptString(encoded);this.records=JSON.parse(json) as QueueOperation[];}catch{this.records=[];}}
  list(){return [...this.records].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
  async add(input:QueueInput){validate(input);if(!safeStorage.isEncryptionAvailable())throw new Error("Secure offline storage is unavailable on this computer");const now=new Date().toISOString(),record:QueueOperation={...input,id:randomUUID(),createdAt:now,updatedAt:now,status:"pending",attempts:0,lastError:null,syncedAt:null};this.records.push(record);await this.save();return record;}
  async retry(id:string){const record=this.records.find(item=>item.id===id);if(!record)throw new Error("Queued action was not found");record.status="pending";record.lastError=null;record.updatedAt=new Date().toISOString();await this.save();}
  async discard(id:string){const record=this.records.find(item=>item.id===id);if(!record)throw new Error("Queued action was not found");if(record.status==="syncing")throw new Error("Wait for synchronization to finish");this.records=this.records.filter(item=>item.id!==id);await this.save();}
  async sync(accessToken:string,serverUrl:string){const work=this.records.filter(item=>item.status==="pending"||item.status==="failed").sort((a,b)=>a.createdAt.localeCompare(b.createdAt));for(const record of work){record.status="syncing";record.attempts+=1;record.updatedAt=new Date().toISOString();await this.save();try{const response=await fetch(new URL(record.endpoint,serverUrl),{method:record.method,headers:{Authorization:`Bearer ${accessToken}`,"Content-Type":"application/json","Idempotency-Key":record.id,"X-KWMS-Desktop":"1"},body:JSON.stringify(record.body)});if(!response.ok){const payload=await response.json().catch(()=>({})) as{message?:string};throw new Error(payload.message||`Server returned ${response.status}`);}record.status="synced";record.syncedAt=new Date().toISOString();record.lastError=null;}catch(error){record.status="failed";record.lastError=error instanceof Error?error.message:"Synchronization failed";}record.updatedAt=new Date().toISOString();await this.save();}this.records=this.records.filter(item=>item.status!=="synced"||Date.now()-new Date(item.syncedAt||0).getTime()<7*86400000).slice(-500);await this.save();return this.list();}
  private async save(){const json=JSON.stringify(this.records);const encrypted=safeStorage.encryptString(json),temporary=`${this.file}.tmp`;await writeFile(temporary,encrypted,{mode:0o600});await rename(temporary,this.file);}
}
