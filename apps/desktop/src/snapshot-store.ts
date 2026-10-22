import{app,safeStorage}from"electron";
import{readFile,rename,writeFile}from"node:fs/promises";
import path from"node:path";
import type{SnapshotInput,SnapshotRecord}from"./types";

const allowedKeys=new Set(["driver-route","recycling-field","company-dashboard","platform-dashboard"]);

function validate(input:SnapshotInput){
  if(!allowedKeys.has(input.key))throw new Error("Unsupported offline reference data");
  if(!input.organizationId||!input.userId)throw new Error("Organization and user context are required");
  const bytes=Buffer.byteLength(JSON.stringify(input.data??null));
  if(bytes>5_000_000)throw new Error("Offline reference data is larger than 5 MB");
}

export class SnapshotStore{
  private records:SnapshotRecord[]=[];
  private readonly file=path.join(app.getPath("userData"),"offline-snapshots.dat");

  async load(){
    try{
      const encoded=await readFile(this.file);
      if(!safeStorage.isEncryptionAvailable())return;
      const decoded=JSON.parse(safeStorage.decryptString(encoded)) as SnapshotRecord[];
      this.records=Array.isArray(decoded)?decoded.filter(item=>allowedKeys.has(item.key)):[];
    }catch{this.records=[];}
  }

  list(){
    const sorted=[...this.records].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)),latest=sorted[0];
    return latest?sorted.filter(item=>item.organizationId===latest.organizationId&&item.userId===latest.userId):[];
  }

  async set(input:SnapshotInput){
    validate(input);
    if(!safeStorage.isEncryptionAvailable())throw new Error("Secure offline storage is unavailable on this computer");
    const record:SnapshotRecord={...input,updatedAt:new Date().toISOString()};
    this.records=this.records.filter(item=>!(item.key===input.key&&item.organizationId===input.organizationId&&item.userId===input.userId));
    this.records.push(record);
    await this.save();
    return record;
  }

  private async save(){
    const encrypted=safeStorage.encryptString(JSON.stringify(this.records.slice(-20))),temporary=`${this.file}.tmp`;
    await writeFile(temporary,encrypted,{mode:0o600});
    await rename(temporary,this.file);
  }
}
