const{cpSync,existsSync,mkdirSync,rmSync}=require("node:fs"),path=require("node:path");
const admin=path.resolve(__dirname,"../../admin-web"),standalone=path.join(admin,".next/standalone"),target=path.join(standalone,"apps/admin-web");
if(!existsSync(path.join(target,"server.js")))throw new Error("Build apps/admin-web before packaging the desktop application");
mkdirSync(path.join(target,".next"),{recursive:true});
rmSync(path.join(target,".next/static"),{recursive:true,force:true});cpSync(path.join(admin,".next/static"),path.join(target,".next/static"),{recursive:true});
rmSync(path.join(target,"public"),{recursive:true,force:true});cpSync(path.join(admin,"public"),path.join(target,"public"),{recursive:true});
