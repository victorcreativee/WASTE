"use client";
import {Circle,CircleMarker,MapContainer,Polyline,TileLayer,Tooltip,useMapEvents} from "react-leaflet";

type LatLng=[number,number];
export type TrackMapProps={
  track?:Array<{lat:number|string;lng:number|string;recorded_at:string}>;
  facilities?:Array<{code:string;name:string;latitude:number|string|null;longitude:number|string|null;radius_m:number}>;
  stops?:Array<{lat:number;lng:number;minutes:number;offRoute:boolean|null;from:string}>;
  routeLine?:{type:"LineString";coordinates:[number,number][]}|null;
  ticketFacilityCode?:string|null;
  onPick?:(latitude:number,longitude:number)=>void;
  height?:number;
};
const center:LatLng=[0.3476,32.5825];

function Picker({onPick}:{onPick:(latitude:number,longitude:number)=>void}){useMapEvents({click:e=>onPick(e.latlng.lat,e.latlng.lng)});return null}

/** A trip's GPS track (start green, end dark), the planned route, facility geofences and long stops. With onPick, a click chooses a place. */
export default function TrackMap({track=[],facilities=[],stops=[],routeLine,ticketFacilityCode,onPick,height=420}:TrackMapProps){
  const line=track.map(p=>[Number(p.lat),Number(p.lng)] as LatLng);
  const fences=facilities.filter(f=>f.latitude!==null&&f.longitude!==null);
  const focus=line[0]??(fences[0]?[Number(fences[0].latitude),Number(fences[0].longitude)] as LatLng:center);
  return <MapContainer center={focus} zoom={line.length?13:12} scrollWheelZoom style={{height}} className="w-full">
    <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>
    {onPick&&<Picker onPick={onPick}/>}
    {routeLine&&<Polyline positions={routeLine.coordinates.map(([lng,lat])=>[lat,lng] as LatLng)} pathOptions={{color:"#94a3b8",weight:6,opacity:.6,dashArray:"6 6"}}/>}
    {fences.map(f=>{const c:LatLng=[Number(f.latitude),Number(f.longitude)];const ticket=f.code===ticketFacilityCode;return <Circle key={f.code} center={c} radius={f.radius_m} pathOptions={{color:ticket?"#2952cc":"#16a34a",weight:2,fillOpacity:.12}}><Tooltip>{f.name}{ticket?" · ticket recorded here":""} · {f.radius_m} m</Tooltip></Circle>})}
    {line.length>1&&<Polyline positions={line} pathOptions={{color:"#0f172a",weight:3,opacity:.85}}/>}
    {line[0]&&<CircleMarker center={line[0]} radius={6} pathOptions={{color:"#16a34a",fillColor:"#16a34a",fillOpacity:1}}><Tooltip>First point · {new Date(track[0].recorded_at).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})}</Tooltip></CircleMarker>}
    {line.length>1&&<CircleMarker center={line[line.length-1]} radius={6} pathOptions={{color:"#0f172a",fillColor:"#0f172a",fillOpacity:1}}><Tooltip>Last point · {new Date(track[track.length-1].recorded_at).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})}</Tooltip></CircleMarker>}
    {stops.map((s,i)=><CircleMarker key={i} center={[s.lat,s.lng]} radius={9} pathOptions={{color:s.offRoute?"#dc2626":"#d97706",fillColor:s.offRoute?"#dc2626":"#d97706",fillOpacity:.6}}><Tooltip>Stopped {s.minutes} min from {new Date(s.from).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})}{s.offRoute?" · off route":""}</Tooltip></CircleMarker>)}
  </MapContainer>;
}
