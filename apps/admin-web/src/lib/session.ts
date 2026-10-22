"use client";
import {useMemo,useSyncExternalStore} from "react";

const subscribe=()=>()=>undefined;
const snapshot=()=>sessionStorage.getItem("currentUser")||"";

/** Whether the signed-in user has a role. False during server rendering, so markup hydrates cleanly. */
export function useHasRole(role:string){
  const stored=useSyncExternalStore(subscribe,snapshot,()=>"");
  return useMemo(()=>{try{return (JSON.parse(stored||"{}").roles||[]).includes(role)}catch{return false}},[stored,role]);
}
