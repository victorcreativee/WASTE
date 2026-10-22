const endpoints=[
 ['Web','http://localhost:3000'],
 ['Gateway','http://localhost:8090/api/health'],
 ['Authentication','http://localhost:8091/api/auth/health'],
 ['Organizations','http://localhost:8092/api/organizations/health'],
 ['Waste operations','http://localhost:8093/api/waste/health'],
];
async function main(){
 let failed=false;
 for(const [name,url] of endpoints){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),3000);
  try{const response=await fetch(url,{signal:controller.signal});const okay=response.ok;console.log(`${okay?'PASS':'FAIL'}  ${name.padEnd(18)} ${response.status}`);if(!okay)failed=true;}
  catch{console.log(`FAIL  ${name.padEnd(18)} unavailable`);failed=true}
  finally{clearTimeout(timer)}
 }
 if(failed){console.error('\nPlatform is not fully ready. Start it from the repository root with: npm run dev');process.exitCode=1}else console.log('\nPlatform is ready.');
}
main();
