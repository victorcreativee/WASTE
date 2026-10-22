"use client";
import {CircleMarker,MapContainer,TileLayer,Tooltip,useMapEvents} from "react-leaflet";
import {STATUS,type SiteStatus} from "@/lib/dumping";

export type MapSite={id:string;site_number:string;status:SiteStatus;latitude:number|string;longitude:number|string;landmark:string|null;hazardous:boolean;hotspot?:boolean;overdue?:boolean};
const center:[number,number]=[0.3476,32.5825];

function Picker({onPick}:{onPick:(latitude:number,longitude:number)=>void}){
  useMapEvents({click:event=>onPick(event.latlng.lat,event.latlng.lng)});
  return null;
}

/** Dumping sites coloured by status (hotspots drawn larger, overdue ringed red). With onPick, a click chooses a location. */
export default function DumpingMap({sites=[],onSelect,picked,onPick,height=460}:{sites?:MapSite[];onSelect?:(id:string)=>void;picked?:{latitude:number;longitude:number}|null;onPick?:(latitude:number,longitude:number)=>void;height?:number}){
  return <MapContainer center={picked?[picked.latitude,picked.longitude]:center} zoom={picked?15:12} scrollWheelZoom style={{height}} className="w-full">
    <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>
    {onPick&&<Picker onPick={onPick}/>}
    {sites.map(site=>{const color=STATUS[site.status].color;return <CircleMarker key={site.id} center={[Number(site.latitude),Number(site.longitude)]} radius={site.hotspot?11:7}
      pathOptions={{color:site.overdue?"#b91c1c":color,weight:site.overdue?3:1.5,fillColor:color,fillOpacity:.75}} eventHandlers={{click:()=>onSelect?.(site.id)}}>
      <Tooltip direction="top" offset={[0,-6]}>{site.site_number} · {STATUS[site.status].label}{site.hazardous?" · hazardous":""}{site.hotspot?" · hotspot":""}{site.overdue?" · overdue":""}{site.landmark?<><br/>{site.landmark}</>:null}</Tooltip>
    </CircleMarker>})}
    {picked&&<CircleMarker center={[picked.latitude,picked.longitude]} radius={9} pathOptions={{color:"#0f172a",weight:3,fillColor:"#ffffff",fillOpacity:1}}/>}
  </MapContainer>;
}
