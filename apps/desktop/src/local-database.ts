import{app,safeStorage}from"electron";
import Database from"better-sqlite3";
import{promisify}from"node:util";
import{chmodSync}from"node:fs";
import{randomBytes,randomUUID,scrypt as scryptCallback,timingSafeEqual,createHash}from"node:crypto";
import path from"node:path";
import type{LocalAuthInput,OfflineSession,QueueInput,QueueOperation,SnapshotInput,SnapshotRecord}from"./types";

const scrypt=promisify(scryptCallback),allowedSnapshotKeys=new Set(["driver-route","recycling-field","company-dashboard","platform-dashboard"]),maxOfflineAgeMs=30*86400000;
const allowedEndpoints=[
  /^\/api\/waste\/(?:trips|collection-routes|collection-jobs|customer-collection-stops)(?:\/|$)/,
  /^\/api\/waste\/(?:service-routes|zones|service-areas)(?:\/|$)/,
  /^\/api\/waste\/(?:trucks|fleet|drivers|operations)(?:\/|$)/,
  /^\/api\/waste\/(?:customers|customer-service)(?:\/|$)/,
  /^\/api\/waste\/(?:citizen-issues|driver-job-problems|job-problems)(?:\/|$)/,
  /^\/api\/waste\/(?:inventory|procurement|recycling)(?:\/|$)/,
  /^\/api\/waste\/finance\/expenses\/?$/,
];
const forbidden=/(billing|payment|contract|permit|account|access|payroll|weighbridge|compliance|platform|password|credential|\/paid(?:\/|$)|manager-float|cash-movements|finance\/expenses\/[^/]+\/status)/i;
type Row=Record<string,unknown>;

function encrypted(value:unknown){if(!safeStorage.isEncryptionAvailable())throw new Error("Secure local storage is unavailable on this computer");return safeStorage.encryptString(JSON.stringify(value));}
function decrypted<T>(value:Buffer){return JSON.parse(safeStorage.decryptString(value)) as T;}
function normalizeEmail(value:string){return value.trim().toLowerCase();}
function validateQueue(input:QueueInput){if(!allowedEndpoints.some(rule=>rule.test(input.endpoint))||forbidden.test(input.endpoint))throw new Error("This action requires an online connection");if(!["POST","PUT","PATCH"].includes(input.method))throw new Error("Unsupported offline action");if(!input.organizationId||!input.userId)throw new Error("Organization and user context are required");if(Buffer.byteLength(JSON.stringify(input.body??null))>5_000_000)throw new Error("Offline action is larger than 5 MB");}

export class LocalDatabase{
  private db:Database.Database|null=null;
  private activeSession:OfflineSession|null=null;
  private readonly file=path.join(app.getPath("userData"),"kampala-wms.sqlite3");

  initialize(){
    if(!safeStorage.isEncryptionAvailable())throw new Error("Operating-system secure storage is required for offline mode");
    this.db=new Database(this.file);
    chmodSync(this.file,0o600);
    this.db.pragma("journal_mode = WAL");this.db.pragma("foreign_keys = ON");this.db.pragma("busy_timeout = 5000");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS local_users(email TEXT PRIMARY KEY,user_id TEXT NOT NULL,organization_id TEXT,password_salt BLOB NOT NULL,password_hash BLOB NOT NULL,profile BLOB NOT NULL,refresh_token BLOB,status TEXT NOT NULL DEFAULT 'active',last_verified_at TEXT NOT NULL,failed_attempts INTEGER NOT NULL DEFAULT 0,locked_until TEXT,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,endpoint TEXT NOT NULL,method TEXT NOT NULL,payload BLOB NOT NULL,organization_id TEXT NOT NULL,user_id TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT,synced_at TEXT,dedupe_key TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS outbox_status_created_idx ON outbox(status,created_at);
      CREATE INDEX IF NOT EXISTS outbox_dedupe_idx ON outbox(dedupe_key,created_at);
      CREATE TABLE IF NOT EXISTS snapshots(snapshot_key TEXT NOT NULL,organization_id TEXT NOT NULL,user_id TEXT NOT NULL,payload BLOB NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(snapshot_key,organization_id,user_id));
      CREATE TABLE IF NOT EXISTS api_cache(path TEXT NOT NULL,organization_id TEXT NOT NULL,user_id TEXT NOT NULL,payload BLOB NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(path,organization_id,user_id));
      CREATE TABLE IF NOT EXISTS sync_state(scope TEXT PRIMARY KEY,cursor TEXT,last_sync_at TEXT,last_error TEXT);
    `);
    const columns=this.db.pragma("table_info(local_users)") as Array<{name:string}>;if(!columns.some(column=>column.name==="refresh_token"))this.db.exec("ALTER TABLE local_users ADD COLUMN refresh_token BLOB");
  }

  close(){this.db?.close();this.db=null;}
  private database(){if(!this.db)throw new Error("Local database is not initialized");return this.db;}

  migrateLegacy(queue:QueueOperation[],snapshots:SnapshotRecord[]){
    if(this.database().prepare("SELECT 1 FROM sync_state WHERE scope='legacy-data-v1'").get())return;
    const migrate=this.database().transaction(()=>{
      for(const item of queue){const dedupe=createHash("sha256").update(JSON.stringify([item.endpoint,item.method,item.body,item.organizationId,item.userId])).digest("hex");this.database().prepare("INSERT OR IGNORE INTO outbox(id,endpoint,method,payload,organization_id,user_id,created_at,updated_at,status,attempts,last_error,synced_at,dedupe_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run(item.id,item.endpoint,item.method,encrypted(item.body??null),item.organizationId,item.userId,item.createdAt,item.updatedAt,item.status==="syncing"?"pending":item.status,item.attempts,item.lastError,item.syncedAt,dedupe)}
      for(const item of snapshots)this.database().prepare("INSERT OR IGNORE INTO snapshots(snapshot_key,organization_id,user_id,payload,updated_at) VALUES(?,?,?,?,?)").run(item.key,item.organizationId,item.userId,encrypted(item.data),item.updatedAt);
      this.database().prepare("INSERT INTO sync_state(scope,last_sync_at,last_error) VALUES('legacy-data-v1',?,NULL)").run(new Date().toISOString());
    });migrate();
  }

  async provision(input:LocalAuthInput){
    const email=normalizeEmail(input.email),salt=randomBytes(32),hash=Buffer.from(await scrypt(input.password,salt,64) as Buffer),now=new Date().toISOString();
    const user={id:input.user.id,fullName:input.user.fullName,email:input.user.email,organizationId:input.user.organizationId},profile={user,roles:input.roles},refreshToken=input.refreshToken||input.user.refreshToken||"";
    this.database().prepare(`INSERT INTO local_users(email,user_id,organization_id,password_salt,password_hash,profile,refresh_token,status,last_verified_at,failed_attempts,locked_until,updated_at) VALUES(?,?,?,?,?,?,?,'active',?,0,NULL,?) ON CONFLICT(email) DO UPDATE SET user_id=excluded.user_id,organization_id=excluded.organization_id,password_salt=excluded.password_salt,password_hash=excluded.password_hash,profile=excluded.profile,refresh_token=excluded.refresh_token,status='active',last_verified_at=excluded.last_verified_at,failed_attempts=0,locked_until=NULL,updated_at=excluded.updated_at`).run(email,user.id,user.organizationId,salt,hash,encrypted(profile),encrypted(refreshToken),now,now);
    return this.createSession(user,input.roles,false,now);
  }

  async authenticate(emailValue:string,password:string){
    const email=normalizeEmail(emailValue),row=this.database().prepare("SELECT * FROM local_users WHERE email=?").get(email) as Row|undefined;
    if(!row)throw new Error("Connect to the internet for the first sign-in on this device");
    if(row.status!=="active")throw new Error("Offline access has been disabled. Connect to verify your account");
    if(row.locked_until&&Date.now()<new Date(String(row.locked_until)).getTime())throw new Error("Too many attempts. Wait five minutes before trying again");
    if(Date.now()-new Date(String(row.last_verified_at)).getTime()>maxOfflineAgeMs)throw new Error("Online verification is required because this account has been offline for more than 30 days");
    const actual=Buffer.from(await scrypt(password,row.password_salt as Buffer,64) as Buffer),expected=row.password_hash as Buffer;
    if(actual.length!==expected.length||!timingSafeEqual(actual,expected)){
      const attempts=Number(row.failed_attempts)+1,locked=attempts>=5?new Date(Date.now()+300000).toISOString():null;
      this.database().prepare("UPDATE local_users SET failed_attempts=?,locked_until=?,updated_at=? WHERE email=?").run(attempts,locked,new Date().toISOString(),email);
      throw new Error(locked?"Too many attempts. Offline sign-in is locked for five minutes":"Email or password is incorrect");
    }
    this.database().prepare("UPDATE local_users SET failed_attempts=0,locked_until=NULL,updated_at=? WHERE email=?").run(new Date().toISOString(),email);
    const profile=decrypted<{user:LocalAuthInput["user"];roles:string[]}>(row.profile as Buffer);
    return this.createSession(profile.user,profile.roles,true,String(row.last_verified_at));
  }

  private setSessionPreference(value:"signed_in"|"signed_out"){this.database().prepare("INSERT INTO sync_state(scope,cursor,last_sync_at,last_error) VALUES('auth-session',?,NULL,NULL) ON CONFLICT(scope) DO UPDATE SET cursor=excluded.cursor,last_error=NULL").run(value);}
  private createSession(user:LocalAuthInput["user"],roles:string[],offline:boolean,lastVerifiedAt:string){const session:OfflineSession={sessionId:randomUUID(),offline,user,roles,lastVerifiedAt};this.activeSession=session;this.setSessionPreference("signed_in");return session;}
  restoreSession(){const preference=this.database().prepare("SELECT cursor FROM sync_state WHERE scope='auth-session'").get() as Row|undefined;if(preference?.cursor==="signed_out")return null;const row=this.database().prepare("SELECT * FROM local_users WHERE status='active' ORDER BY last_verified_at DESC LIMIT 1").get() as Row|undefined;if(!row)return null;const verifiedAt=String(row.last_verified_at);if(Date.now()-new Date(verifiedAt).getTime()>maxOfflineAgeMs)return null;const profile=decrypted<{user:LocalAuthInput["user"];roles:string[]}>(row.profile as Buffer);return this.createSession(profile.user,profile.roles,true,verifiedAt);}
  session(){return this.activeSession;}
  refreshCredential(){if(!this.activeSession)return null;const row=this.database().prepare("SELECT refresh_token FROM local_users WHERE user_id=? AND status='active'").get(this.activeSession.user.id) as Row|undefined;return row?.refresh_token?decrypted<string>(row.refresh_token as Buffer):null;}
  updateCentralSession(input:{user:LocalAuthInput["user"];roles:string[];refreshToken:string}){const now=new Date().toISOString();this.database().prepare("UPDATE local_users SET organization_id=?,profile=?,refresh_token=?,status='active',last_verified_at=?,updated_at=? WHERE user_id=?").run(input.user.organizationId,encrypted({user:input.user,roles:input.roles}),encrypted(input.refreshToken),now,now,input.user.id);this.activeSession=this.createSession(input.user,input.roles,false,now);return this.activeSession;}
  logout(){this.activeSession=null;this.setSessionPreference("signed_out");}
  revokeUser(userId:string){this.database().prepare("UPDATE local_users SET status='revoked',updated_at=? WHERE user_id=?").run(new Date().toISOString(),userId);if(this.activeSession?.user.id===userId)this.activeSession=null;}

  listQueue(){return(this.database().prepare("SELECT * FROM outbox ORDER BY created_at DESC").all() as Row[]).map(row=>this.mapQueue(row));}
  addQueue(input:QueueInput){
    validateQueue(input);const now=new Date().toISOString(),dedupe=createHash("sha256").update(JSON.stringify([input.endpoint,input.method,input.body,input.organizationId,input.userId])).digest("hex");
    const duplicate=this.database().prepare("SELECT * FROM outbox WHERE dedupe_key=? AND status IN ('pending','syncing') AND created_at>=? ORDER BY created_at DESC LIMIT 1").get(dedupe,new Date(Date.now()-10000).toISOString()) as Row|undefined;
    if(duplicate)return this.mapQueue(duplicate);
    const id=randomUUID();this.database().prepare("INSERT INTO outbox(id,endpoint,method,payload,organization_id,user_id,created_at,updated_at,status,attempts,last_error,synced_at,dedupe_key) VALUES(?,?,?,?,?,?,?,?,'pending',0,NULL,NULL,?)").run(id,input.endpoint,input.method,encrypted(input.body??null),input.organizationId,input.userId,now,now,dedupe);this.applyOptimisticCache(id,input,now);
    return this.listQueue().find(item=>item.id===id)!;
  }
  private applyOptimisticCache(id:string,input:QueueInput,updatedAt:string){
    const session=this.activeSession;if(!session)return;const scope=session.user.organizationId||"platform";if(input.endpoint.startsWith("/api/waste/recycling"))this.applyRecyclingOptimistic(id,input,updatedAt,scope,session.user.id);const row=this.database().prepare("SELECT payload FROM api_cache WHERE path=? AND organization_id=? AND user_id=?").get(input.endpoint,scope,session.user.id) as Row|undefined;
    const snake=(key:string)=>key.replace(/[A-Z]/g,letter=>`_${letter.toLowerCase()}`),normalized=input.body&&typeof input.body==="object"&&!Array.isArray(input.body)?Object.fromEntries(Object.entries(input.body as Record<string,unknown>).flatMap(([key,value])=>[[key,value],[snake(key),value]])):{};
    if(input.method==="POST"&&row){const cached=decrypted<{data?:unknown}>(row.payload as Buffer);if(Array.isArray(cached.data)){cached.data.push({id,...normalized,offline_pending:true,sync_status:"pending",created_at:updatedAt,updated_at:updatedAt});this.database().prepare("UPDATE api_cache SET payload=?,updated_at=? WHERE path=? AND organization_id=? AND user_id=?").run(encrypted(cached),updatedAt,input.endpoint,scope,session.user.id);return;}}
    if(input.method==="PATCH"){const segments=input.endpoint.split("/").filter(Boolean),suffixes=new Set(["status","cancel","dispatch","exception","reopen"]),recordId=suffixes.has(segments.at(-1)||"")?segments.at(-2):segments.at(-1);if(!recordId)return;const rows=this.database().prepare("SELECT path,payload FROM api_cache WHERE organization_id=? AND user_id=?").all(scope,session.user.id) as Row[];for(const item of rows){const cached=decrypted<{data?:unknown}>(item.payload as Buffer);if(!Array.isArray(cached.data))continue;let changed=false;cached.data=cached.data.map(entry=>{if(!entry||typeof entry!=="object"||String((entry as Record<string,unknown>).id)!==recordId)return entry;changed=true;return{...(entry as Record<string,unknown>),...normalized,offline_pending:true,sync_status:"pending",updated_at:updatedAt};});if(changed)this.database().prepare("UPDATE api_cache SET payload=?,updated_at=? WHERE path=? AND organization_id=? AND user_id=?").run(encrypted(cached),updatedAt,String(item.path),scope,session.user.id);}}
  }
  private applyRecyclingOptimistic(id:string,input:QueueInput,updatedAt:string,scope:string,userId:string){
    const cachePath="/api/waste/recycling",row=this.database().prepare("SELECT payload FROM api_cache WHERE path=? AND organization_id=? AND user_id=?").get(cachePath,scope,userId) as Row|undefined;if(!row)return;
    const envelope=decrypted<{data?:Record<string,any>}>(row.payload as Buffer),data=envelope.data;if(!data)return;const body=(input.body&&typeof input.body==="object"?input.body:{}) as Record<string,any>,pending={id,offline_pending:true,sync_status:"pending",created_at:updatedAt,updated_at:updatedAt};
    const n=(value:unknown)=>Number(value||0),s=(value:unknown)=>String(value??"0"),today=String(body.collectedOn||body.soldOn||body.processedOn||body.adjustmentDate||body.operatingDate||body.transactionDate||updatedAt).slice(0,10);
    if(input.method==="POST"&&input.endpoint.endsWith("/lots")){const total=n(body.quantityKg)*n(body.unitPurchasePriceUgx)+n(body.workerWagesUgx)+n(body.foodUgx)+n(body.transportUgx)+n(body.driverFeeUgx)+n(body.otherExpenseUgx);data.lots=[{...pending,material_type:body.materialType,source_name:body.sourceName,quantity_kg:s(body.quantityKg),available_kg:s(body.quantityKg),unit_purchase_price_ugx:s(body.unitPurchasePriceUgx),material_cost_ugx:s(n(body.quantityKg)*n(body.unitPurchasePriceUgx)),total_cost_ugx:s(total),collected_on:today,quality:body.quality,status:"available",origin:"purchase",purchase_payment_status:body.purchasePaymentStatus||"paid",purchase_payment_reference:body.purchasePaymentReference||null,paid_ugx:body.purchasePaymentStatus==="credit"?"0":s(total),balance_ugx:body.purchasePaymentStatus==="credit"?s(total):"0",recorded_by_name:"Offline user"},...(data.lots||[])];data.operations={...(data.operations||{}),receivedTodayKg:n(data.operations?.receivedTodayKg)+n(body.quantityKg)};data.myActivity={...(data.myActivity||{}),purchases:n(data.myActivity?.purchases)+1,purchasedKg:n(data.myActivity?.purchasedKg)+n(body.quantityKg)};}
    else if(input.method==="POST"&&input.endpoint.endsWith("/sales")){const total=n(body.quantityKg)*n(body.unitPriceUgx),expenses=n(body.workerWagesUgx)+n(body.foodUgx)+n(body.transportUgx)+n(body.otherExpenseUgx);data.sales=[{...pending,material_type:(data.lots||[]).find((x:any)=>x.id===body.lotId)?.material_type||"Pending material",buyer_name:body.buyerName||"Saved buyer",industry:body.industry,quantity_kg:s(body.quantityKg),unit_price_ugx:s(body.unitPriceUgx),total_ugx:s(total),expenses_ugx:s(expenses),net_income_ugx:s(total-expenses),sold_on:today,sale_channel:body.saleChannel||"industrial",status:"pending_sync",invoice_number:body.invoiceNumber||null,payment_state:"pending",paid_ugx:"0",balance_ugx:s(total),recorded_by_name:"Offline user"},...(data.sales||[])];data.lots=(data.lots||[]).map((lot:any)=>lot.id===body.lotId?{...lot,available_kg:s(Math.max(0,n(lot.available_kg)-n(body.quantityKg)))}:lot);data.operations={...(data.operations||{}),soldTodayKg:n(data.operations?.soldTodayKg)+n(body.quantityKg)};}
    else if(input.method==="POST"&&input.endpoint.endsWith("/sorting")){const processingCost=n(body.workerWagesUgx)+n(body.utilitiesUgx)+n(body.transportUgx)+n(body.consumablesUgx)+n(body.otherExpenseUgx);data.sortingBatches=[{...pending,processed_on:today,input_material_type:(data.lots||[]).find((x:any)=>x.id===body.inputLotId)?.material_type||"Pending material",input_kg:s(body.inputKg),output_material:body.outputMaterialType,output_kg:s(body.outputKg),rejected_kg:s(body.rejectedKg),worker_wages_ugx:s(body.workerWagesUgx),utilities_ugx:s(body.utilitiesUgx),transport_ugx:s(body.transportUgx),consumables_ugx:s(body.consumablesUgx),other_expense_ugx:s(body.otherExpenseUgx),manager_float_used_ugx:s(body.managerFloatUsedUgx),processing_cost_ugx:s(processingCost)},...(data.sortingBatches||[])];data.lots=(data.lots||[]).map((lot:any)=>lot.id===body.inputLotId?{...lot,available_kg:s(Math.max(0,n(lot.available_kg)-n(body.inputKg)))}:lot);data.operations={...(data.operations||{}),sortedTodayKg:n(data.operations?.sortedTodayKg)+n(body.inputKg)};}
    else if(input.method==="POST"&&input.endpoint.endsWith("/stock-adjustments")){data.stockAdjustments=[{...pending,adjustment_date:today,adjustment_type:body.adjustmentType,quantity_kg:s(body.quantityKg),reason:body.reason,notes:body.notes||null,material_type:(data.lots||[]).find((x:any)=>x.id===body.lotId)?.material_type||"Pending material",source_name:(data.lots||[]).find((x:any)=>x.id===body.lotId)?.source_name||""},...(data.stockAdjustments||[])];}
    else if(input.method==="POST"&&input.endpoint.endsWith("/partners")){data.partners=[{...pending,partner_type:body.partnerType,name:body.name,contact_person:body.contactPerson||null,phone:body.phone||null,email:body.email||null,address:body.address||null,tax_number:body.taxNumber||null,active:true},...(data.partners||[])];}
    else if(input.method==="POST"&&input.endpoint.endsWith("/materials")){data.materials=[{...pending,name:body.name,category:body.category,active:true},...(data.materials||[])];}
    else if(input.method==="POST"&&input.endpoint.endsWith("/manager-float")){data.floatTransactions=[{...pending,transaction_date:today,transaction_type:body.transactionType,amount_ugx:s(body.amountUgx),reference:body.reference||null,running_balance_ugx:s(n(data.summary?.floatBalanceUgx)+(body.transactionType==="given"?n(body.amountUgx):-n(body.amountUgx))),notes:body.notes||null},...(data.floatTransactions||[])];}
    else if(input.method==="POST"&&input.endpoint.endsWith("/daily-closures")){data.dailyClosures=[{...pending,operating_date:today,status:"closed",snapshot:{},notes:body.notes||null,closed_at:updatedAt,closed_by_name:"Offline user",reopened_at:null,reopen_reason:null},...(data.dailyClosures||[])];data.operations={...(data.operations||{}),isClosed:true,currentClosure:{id,operating_date:today,status:"closed"}};}
    this.database().prepare("UPDATE api_cache SET payload=?,updated_at=? WHERE path=? AND organization_id=? AND user_id=?").run(encrypted(envelope),updatedAt,cachePath,scope,userId);
  }
  retry(id:string){const result=this.database().prepare("UPDATE outbox SET status='pending',last_error=NULL,updated_at=? WHERE id=?").run(new Date().toISOString(),id);if(!result.changes)throw new Error("Queued action was not found");}
  discard(id:string){const row=this.database().prepare("SELECT status FROM outbox WHERE id=?").get(id) as Row|undefined;if(!row)throw new Error("Queued action was not found");if(row.status==="syncing")throw new Error("Wait for synchronization to finish");this.database().prepare("DELETE FROM outbox WHERE id=?").run(id);}
  async sync(accessToken:string,serverUrl:string){
    const work=(this.database().prepare("SELECT * FROM outbox WHERE status IN ('pending','failed') ORDER BY created_at").all() as Row[]);
    const idMap=new Map<string,string>();
    const replaceIds=(value:unknown):unknown=>typeof value==="string"?(idMap.get(value)||value):Array.isArray(value)?value.map(replaceIds):value&&typeof value==="object"?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,replaceIds(item)])):value;
    for(const row of work){const id=String(row.id),attempts=Number(row.attempts)+1,now=new Date().toISOString();this.database().prepare("UPDATE outbox SET status='syncing',attempts=?,updated_at=? WHERE id=?").run(attempts,now,id);try{let endpoint=String(row.endpoint);for(const[localId,remoteId]of idMap)endpoint=endpoint.replaceAll(localId,remoteId);const payload=replaceIds(decrypted(row.payload as Buffer));const response=await fetch(new URL(endpoint,serverUrl),{method:String(row.method),headers:{Authorization:`Bearer ${accessToken}`,"Content-Type":"application/json","Idempotency-Key":id,"X-KWMS-Desktop":"1"},body:JSON.stringify(payload)});if(response.status===401){this.revokeUser(String(row.user_id));throw new Error("Central access expired or was revoked. Sign in online again")};if(response.status===409){const result=await response.json().catch(()=>({})) as{message?:string};this.database().prepare("UPDATE outbox SET status='conflict',last_error=?,updated_at=? WHERE id=?").run(result.message||"The server record changed. Review this item online",new Date().toISOString(),id);continue;}if(!response.ok){const result=await response.json().catch(()=>({})) as{message?:string};throw new Error(result.message||`Server returned ${response.status}`)}const result=await response.json().catch(()=>null) as{data?:{id?:string}}|null;if(result?.data?.id)idMap.set(id,result.data.id);this.database().prepare("UPDATE outbox SET status='synced',synced_at=?,last_error=NULL,updated_at=? WHERE id=?").run(new Date().toISOString(),new Date().toISOString(),id);}catch(error){const latest=this.database().prepare("SELECT status FROM outbox WHERE id=?").get(id) as Row;if(latest.status!=="conflict")this.database().prepare("UPDATE outbox SET status='failed',last_error=?,updated_at=? WHERE id=?").run(error instanceof Error?error.message:"Synchronization failed",new Date().toISOString(),id);}}
    this.database().prepare("DELETE FROM outbox WHERE status='synced' AND synced_at<?").run(new Date(Date.now()-7*86400000).toISOString());
    this.database().prepare("INSERT INTO sync_state(scope,last_sync_at,last_error) VALUES('operations',?,NULL) ON CONFLICT(scope) DO UPDATE SET last_sync_at=excluded.last_sync_at,last_error=NULL").run(new Date().toISOString());
    return this.listQueue();
  }
  private mapQueue(row:Row):QueueOperation{return{id:String(row.id),endpoint:String(row.endpoint),method:String(row.method) as QueueOperation["method"],body:decrypted(row.payload as Buffer),organizationId:String(row.organization_id),userId:String(row.user_id),createdAt:String(row.created_at),updatedAt:String(row.updated_at),status:String(row.status) as QueueOperation["status"],attempts:Number(row.attempts),lastError:row.last_error?String(row.last_error):null,syncedAt:row.synced_at?String(row.synced_at):null};}

  snapshots(){const session=this.activeSession;if(!session)return[];const scope=session.user.organizationId||"platform";return(this.database().prepare("SELECT * FROM snapshots WHERE organization_id=? AND user_id=? ORDER BY updated_at DESC").all(scope,session.user.id) as Row[]).map(row=>({key:String(row.snapshot_key) as SnapshotRecord["key"],organizationId:String(row.organization_id),userId:String(row.user_id),updatedAt:String(row.updated_at),data:decrypted(row.payload as Buffer)}));}
  setSnapshot(input:SnapshotInput){if(!allowedSnapshotKeys.has(input.key))throw new Error("Unsupported offline reference data");if(!input.organizationId||!input.userId)throw new Error("Organization and user context are required");if(Buffer.byteLength(JSON.stringify(input.data??null))>5_000_000)throw new Error("Offline reference data is larger than 5 MB");const updatedAt=new Date().toISOString();this.database().prepare("INSERT INTO snapshots(snapshot_key,organization_id,user_id,payload,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(snapshot_key,organization_id,user_id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at").run(input.key,input.organizationId,input.userId,encrypted(input.data),updatedAt);return{...input,updatedAt};}
  cacheApiResponse(pathname:string,data:unknown){const session=this.activeSession;if(!session||!pathname.startsWith("/api/")||pathname.includes("/auth/login")||pathname.includes("/auth/refresh"))return false;if(Buffer.byteLength(JSON.stringify(data??null))>5_000_000)return false;const scope=session.user.organizationId||"platform";this.database().prepare("INSERT INTO api_cache(path,organization_id,user_id,payload,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(path,organization_id,user_id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at").run(pathname,scope,session.user.id,encrypted(data),new Date().toISOString());return true;}
  cachedApiResponse(pathname:string){const session=this.activeSession;if(!session||!pathname.startsWith("/api/"))return null;const scope=session.user.organizationId||"platform",row=this.database().prepare("SELECT payload,updated_at FROM api_cache WHERE path=? AND organization_id=? AND user_id=?").get(pathname,scope,session.user.id) as Row|undefined;return row?{data:decrypted(row.payload as Buffer),updatedAt:String(row.updated_at)}:null;}
}
