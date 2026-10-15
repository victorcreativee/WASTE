"use client";
import{useEffect}from"react";
export function DesktopOfflineRuntime(){useEffect(()=>{if(window.kwmsDesktop&&"serviceWorker"in navigator)void navigator.serviceWorker.register("/kwms-offline.js",{scope:"/"}).then(registration=>registration.update()).catch(()=>undefined);},[]);return null;}
