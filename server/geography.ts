import {readFileSync} from 'node:fs';
type Position=[number,number];
type Boundary={type:'Feature';properties:{name:string};geometry:{type:'Polygon'|'MultiPolygon';coordinates:Position[][]|Position[][][]}};
const boundaries=JSON.parse(readFileSync(new URL('./public-data/vancouver-neighbourhoods.geojson',import.meta.url),'utf8')) as {features:Boundary[]};
function inRing(lon:number,lat:number,ring:Position[]){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [x,y]=ring[i],[previousX,previousY]=ring[j];if((y>lat)!==(previousY>lat)&&lon<(previousX-x)*(lat-y)/(previousY-y)+x)inside=!inside;}return inside;}
export const vancouverNeighbourhoodNames=boundaries.features.map(feature=>feature.properties.name);
export function neighbourhoodAt(lat:number,lon:number){
 if(!Number.isFinite(lat)||!Number.isFinite(lon))return null;
 for(const feature of boundaries.features){const polygons=feature.geometry.type==='Polygon'?[feature.geometry.coordinates as Position[][]]:feature.geometry.coordinates as Position[][][];
  if(polygons.some(rings=>inRing(lon,lat,rings[0])&&!rings.slice(1).some(ring=>inRing(lon,lat,ring))))return feature.properties.name;
 }return null;
}
export const geographyAttribution={label:'City of Vancouver — Local Area Boundaries',url:'https://opendata.vancouver.ca/explore/dataset/local-area-boundary/',license:'Open Government Licence — Vancouver',downloadedAt:'2026-11-14'};
export function geographicContext(lat:number,lon:number){const area=neighbourhoodAt(lat,lon);return {area,downtownDistance:area?(['Downtown','West End'].includes(area)?'downtown':['Fairview','Kitsilano','Mount Pleasant','Strathcona'].includes(area)?'nearby':'far') as 'downtown'|'nearby'|'far':null,source:geographyAttribution};}
