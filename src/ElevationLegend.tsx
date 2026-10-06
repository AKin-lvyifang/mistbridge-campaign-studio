/** Editor-supported native levels, not physical meters or a claim about engine limits. */
export default function ElevationLegend({minimum,maximum,current,target}:{minimum:number;maximum:number;current?:number;target?:number}){
 return <section className="elevation-legend" aria-label="地图高度标尺">
  <div className="height-legend-title"><strong>编辑范围 0–16 级</strong><span>非米制</span></div>
  <div className="height-legend-readings"><span>地图最低 <b>{minimum}</b></span><span>地图最高 <b>{maximum}</b></span><span>指针 <b>{current??'—'}</b></span></div>
  <div className="height-legend-scale" aria-hidden="true"><div className="height-range" style={{left:`${minimum/16*100}%`,width:`${Math.max(1,(maximum-minimum)/16*100)}%`}}/>{current!==undefined&&<i style={{left:`${current/16*100}%`}}/>}</div>
  <div className="height-legend-ticks" aria-hidden="true">{[0,4,8,12,16].map(n=><span key={n}>{n}</span>)}</div>
  {target!==undefined&&<div className="height-brush-target">笔刷目标 <strong>{target} 级</strong></div>}
 </section>;
}
