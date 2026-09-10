import { createClient } from '@supabase/supabase-js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const SOURCE_URL=process.env.SUPABASE_URL||'';
const SOURCE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const SOURCE_BUCKET=process.env.SOURCE_BUCKET||'arlab-v779-package';
const ENDPOINT=process.env.ENDPOINT||process.env.AWS_ENDPOINT_URL||'';
const BUCKET=process.env.BUCKET||process.env.AWS_S3_BUCKET_NAME||'';
const ACCESS_KEY_ID=process.env.ACCESS_KEY_ID||process.env.AWS_ACCESS_KEY_ID||'';
const SECRET_ACCESS_KEY=process.env.SECRET_ACCESS_KEY||process.env.AWS_SECRET_ACCESS_KEY||'';
const REGION=process.env.REGION||process.env.AWS_DEFAULT_REGION||'auto';
const CURRENT_VERSION=process.env.ARLAB_CURRENT_VERSION||'1788187613856_502a2e1e49994de4';
const WEBROOT=process.env.ARLAB_WEBROOT||'ARLAB.ValdHub/wwwroot';

if(!SOURCE_URL||!SOURCE_KEY) throw new Error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
if(!ENDPOINT||!BUCKET||!ACCESS_KEY_ID||!SECRET_ACCESS_KEY) throw new Error('Faltan credenciales del Railway Bucket');

const source=createClient(SOURCE_URL,SOURCE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const target=new S3Client({region:REGION,endpoint:ENDPOINT,credentials:{accessKeyId:ACCESS_KEY_ID,secretAccessKey:SECRET_ACCESS_KEY}});

const exactState=[
  'state/current.json','state/meta.json','state/protection.json','state/last-good.json','state/previous-1.json','state/previous-2.json'
];
const prefixes=[
  `versions/${CURRENT_VERSION}/${WEBROOT.replace(/^\/+|\/+$/g,'')}/`,
  'gps/'
];
const excluded=['state/autosave-backups/','hotfix-backups/'];
let copied=0,bytes=0,failed=0;

function targetKey(sourcePath){
  const webPrefix=`versions/${CURRENT_VERSION}/${WEBROOT.replace(/^\/+|\/+$/g,'')}/`;
  if(sourcePath.startsWith(webPrefix)) return 'app/current/'+sourcePath.slice(webPrefix.length);
  return sourcePath;
}
async function upload(path,blob){
  const ab=await blob.arrayBuffer(),body=Buffer.from(ab),key=targetKey(path);
  await target.send(new PutObjectCommand({Bucket:BUCKET,Key:key,Body:body,ContentType:blob.type||'application/octet-stream'}));
  copied++;bytes+=body.length;console.log('COPIED',path,'=>',key,body.length);
}
async function copyOne(path){
  if(excluded.some(p=>path.startsWith(p)))return;
  const {data,error}=await source.storage.from(SOURCE_BUCKET).download(path);
  if(error||!data){failed++;console.error('FAILED',path,error?.message||'missing');return;}
  await upload(path,data);
}
async function walk(prefix){
  const clean=prefix.replace(/^\/+|\/+$/g,'');
  const queue=[clean];
  while(queue.length){
    const folder=queue.shift();let offset=0;
    while(true){
      const {data,error}=await source.storage.from(SOURCE_BUCKET).list(folder,{limit:1000,offset,sortBy:{column:'name',order:'asc'}});
      if(error)throw new Error(`list ${folder}: ${error.message}`);
      if(!data?.length)break;
      for(const item of data){
        const path=folder?`${folder}/${item.name}`:item.name;
        if(excluded.some(p=>path.startsWith(p)))continue;
        if(item.id===null||item.metadata===null) queue.push(path);
        else await copyOne(path);
      }
      if(data.length<1000)break;offset+=data.length;
    }
  }
}

console.log('ARLAB migration start. Autosave history is intentionally NOT migrated.');
for(const p of exactState) await copyOne(p);
for(const p of prefixes) await walk(p);
console.log(JSON.stringify({ok:failed===0,copied,bytes,failed,excluded},null,2));
if(failed)process.exitCode=2;
