"use client";
import {useEffect,useState} from "react";

// Shared types, labels and helpers for illegal dumping enforcement (Module 9).

export type SiteStatus="reported"|"verified"|"cleanup_ordered"|"cleanup_reported"|"cleared"|"dismissed";
export type Site={id:string;site_number:string;latitude:number;longitude:number;landmark:string|null;division_id:string|null;division_name:string|null;status:SiteStatus;size:"small"|"medium"|"large"|null;waste_types:string[];hazardous:boolean;responsible_organization_id:string|null;responsible_organization_name:string|null;responsibility_basis:string|null;cleanup_organization_id:string|null;cleanup_organization_name:string|null;cleanup_due_on:string|null;recurrence_count:number;first_reported_at:string;last_reported_at:string;cleared_at:string|null;closed_reason:string|null;report_count:number;photo_count:number;overdue:boolean;hotspot:boolean};
export type SiteDetail=Site&{rules:{cleanup_days:number};reports:Array<{id:string;source:string;description:string;created_at:string;reporter_name:string|null;reporter_organization_name:string|null}>;photos:Array<{id:string;stage:string;created_at:string}>;history:Array<{action:string;from_status:string|null;to_status:string;note:string|null;created_at:string;actor_name:string|null}>};
export type Division={id:string;name:string};

export const STATUS:Record<SiteStatus,{label:string;className:string;color:string}>={
  reported:{label:"Reported",className:"status status-pending normal-case",color:"#d97706"},
  verified:{label:"Verified",className:"status status-failed normal-case",color:"#dc2626"},
  cleanup_ordered:{label:"Cleanup ordered",className:"status status-pending normal-case",color:"#2952cc"},
  cleanup_reported:{label:"Cleanup reported",className:"status status-pending normal-case",color:"#7c3aed"},
  cleared:{label:"Cleared",className:"status status-active normal-case",color:"#16a34a"},
  dismissed:{label:"Closed",className:"status normal-case",color:"#64748b"},
};
export const SIZES:Array<[string,string]>=[["small","Small (a few bags, under 1 m³)"],["medium","Medium (1–5 m³)"],["large","Large (over 5 m³, a truckload or more)"]];
export const WASTE_TYPES:Array<[string,string]>=[["household","Household"],["commercial","Commercial or market"],["construction","Construction rubble"],["organic","Organic or garden"],["hazardous","Hazardous (oil, chemicals, medical)"],["other","Other"]];
export const SOURCE:Record<string,string>={resident:"Resident",kcca_officer:"KCCA officer",collector:"Collector"};
export const ACTION:Record<string,string>={reported:"Reported",additional_report:"Reported again",recurred:"Dumping came back",verified:"Verified by KCCA",dismissed:"Closed by KCCA",responsibility_set:"Company held responsible",responsibility_cleared:"Responsibility removed",cleanup_ordered:"Cleanup ordered",cleanup_reported:"Cleanup reported",cleanup_rejected:"Cleanup sent back",cleared:"Confirmed clear"};
export const sizeLabel=(size:string|null)=>SIZES.find(([v])=>v===size)?.[1].split(" (")[0]||"—";
export const when=(iso:string|null)=>iso?new Date(iso).toLocaleString("en-GB",{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}):"—";
export const day=(iso:string|null)=>iso?new Date(`${iso.slice(0,10)}T00:00:00`).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}):"—";

/** Reads a photo the person picked and shrinks it to at most 1600 px as a JPEG, so it stays well under the 2 MB limit. */
export async function readPhoto(file:File):Promise<string>{
  if(!/^image\/(jpeg|png|webp)$/.test(file.type))throw new Error("Use a JPG, PNG or WebP photo");
  const source=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error("The photo could not be read"));reader.readAsDataURL(file)});
  const image=await new Promise<HTMLImageElement>((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error("The photo could not be read"));img.src=source});
  const scale=Math.min(1,1600/Math.max(image.width,image.height)),canvas=document.createElement("canvas");
  canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);
  canvas.getContext("2d")!.drawImage(image,0,0,canvas.width,canvas.height);
  const data=canvas.toDataURL("image/jpeg",0.8);
  if(data.length>2_700_000)throw new Error("The photo is too large; try another one");
  return data;
}

/** Loads an image from an authenticated endpoint as an object URL. */
export function useAuthenticatedImage(path:string|null){
  const [url,setUrl]=useState<string|null>(null);
  useEffect(()=>{
    if(!path)return;
    let objectUrl:string|null=null,cancelled=false;
    fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL??""}${path}`,{headers:{Authorization:`Bearer ${sessionStorage.getItem("accessToken")}`}})
      .then(r=>r.ok?r.blob():Promise.reject()).then(blob=>{if(cancelled)return;objectUrl=URL.createObjectURL(blob);setUrl(objectUrl)}).catch(()=>undefined);
    return()=>{cancelled=true;if(objectUrl)URL.revokeObjectURL(objectUrl)};
  },[path]);
  return url;
}

/** The browser's current position, as a promise with a readable error. */
export function currentPosition():Promise<{latitude:number;longitude:number}>{
  return new Promise((resolve,reject)=>{
    if(!navigator.geolocation)return reject(new Error("This browser cannot share a location; pick the place on the map"));
    navigator.geolocation.getCurrentPosition(p=>resolve({latitude:p.coords.latitude,longitude:p.coords.longitude}),()=>reject(new Error("Location not shared; pick the place on the map")),{enableHighAccuracy:true,timeout:10000});
  });
}
