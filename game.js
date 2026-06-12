// ===== 城あつめ 〜戦国武将収集絵巻〜 ゲーム本体 v2 =====
// v2: 現地モード(GPS) / 部隊バトル / 部隊ランク・練度システム
(function(){
'use strict';

// ---------- 定数 ----------
const TIER = {
  1:{label:'家臣',     color:'#9aa7b5', req:0},
  2:{label:'武将',     color:'#7cba6f', req:3},
  3:{label:'重臣',     color:'#5da3c9', req:8},
  4:{label:'大名',     color:'#b48ade', req:15},
  5:{label:'レア大名', color:'#e8b54d', req:25},
};
const TIER_MULT = {1:0.42, 2:0.60, 3:0.82, 4:1.00, 5:1.12};
const STEPS_PER_PX = 12;     // 旅モード: 1pxあたりの歩数
const TRAVEL_SPEED = 170;    // 旅モード: 移動アニメ速度 px/s
const HP_GAIN_STEPS = 800;   // この歩数ごとに体力+1
const RND_GAIN_STEPS = 3000; // この歩数ごとに武/知/運のどれか+1
const FAC_COOLDOWN = 1200;   // 施設の再利用に必要な歩数
const FAC_GAIN = 2;          // 施設1回の上昇量
const STAT_NAMES = {tai:'体力', bu:'武力', chi:'知力', tou:'統率', un:'運'};
const FAC_TYPE = {
  shrine:{icon:'⛩', label:'神社', stat:'un',  desc:'参拝すると 運 が上がる'},
  temple:{icon:'卍', label:'寺',   stat:'chi', desc:'参拝すると 知力 が上がる'},
  dojo:  {icon:'⚔', label:'道場（ジム）', stat:'bu', desc:'鍛錬すると 武力 が上がる'},
};
const SAVE_KEY = 'shiro_meguri_save_v1';

// 部隊定義
const UNITS = {
  yari:   {name:'槍足軽隊', icon:'🗡'},
  kiba:   {name:'騎馬隊',   icon:'🐎'},
  teppo:  {name:'鉄砲隊',   icon:'🔫'},
  yumi:   {name:'弓隊',     icon:'🏹'},
  suigun: {name:'水軍',     icon:'⛵'},
  shinobi:{name:'忍び衆',   icon:'🥷'},
  heiki:  {name:'兵器隊',   icon:'💣'},
};
const UNIT_BEST = {
  yari:'最強・無敗の槍衾', kiba:'最強・赤備え騎馬軍団', teppo:'最強・三段撃ち鉄砲隊',
  yumi:'最強・百発百中の弓衆', suigun:'最強・海賊総出の大船団',
  shinobi:'最強・上忍揃いの影衆', heiki:'最強・国崩し砲列',
};
// 部隊ランク（殿のLvで解放、報酬=練度）
const RANKS = [
  {n:1, label:'Ⅰ', lv:1,  mult:1.00, train:0},
  {n:2, label:'Ⅱ', lv:8,  mult:1.20, train:1},
  {n:3, label:'Ⅲ', lv:18, mult:1.45, train:2},
];
const TRAIN_MARK = ['', '☆', '★'];
const TRAIN_NAME = ['', '精鋭', '最強'];
const TRAIN_BONUS = [0, 4, 8]; // 練度ごとの武/知/統ボーナス
const HERE_RADIUS = {castle:800, facility:400}; // 現地モード判定(m)

// ---------- 状態 ----------
const defaultState = () => ({
  v:1,
  mode:'virtual',    // 'virtual'(旅) | 'gps'(現地)
  pos:'edo',
  steps:0,
  hpGiven:0, rndGiven:0,
  stats:{tai:20, bu:15, chi:15, tou:10, un:10},
  allies:[],         // "castleId|lordIndex"
  train:{},          // 武将key -> 練度 0/1/2
  visits:{edo:1},
  prays:0, wins:0,
  facLast:{},
  log:[],
  seenHelp:false,
});
let state = defaultState();

// ---------- ノード構築 ----------
const PROJ = {x0:129.0, y0:45.9, kx:42, ky:52, padX:30, padY:20};
function proj(lat, lon){
  return {x:(lon-PROJ.x0)*PROJ.kx + PROJ.padX, y:(PROJ.y0-lat)*PROJ.ky + PROJ.padY};
}
// 実座標→表示座標（沖縄は別図オフセット）
function projGeo(lat, lon){
  if(lat < 29){ lat += 4.833; lon += 1.331; }
  return proj(lat, lon);
}
const NODES = {};
CASTLES.forEach(c => { const p = proj(c.lat, c.lon); NODES[c.id] = {id:c.id, kind:'castle', data:c, x:p.x, y:p.y}; });
FACILITIES.forEach(f => { const p = proj(f.lat, f.lon); NODES[f.id] = {id:f.id, kind:'facility', data:f, x:p.x, y:p.y}; });
const NODE_IDS = Object.keys(NODES);
function realCoords(n){
  const d = n.data;
  return d.real ? {lat:d.real[0], lon:d.real[1]} : {lat:d.lat, lon:d.lon};
}

const EDGES = [];
(function buildEdges(){
  const set = new Set();
  const dist = (a,b)=>Math.hypot(NODES[a].x-NODES[b].x, NODES[a].y-NODES[b].y);
  const addEdge=(a,b)=>{
    const key = a<b ? a+'~'+b : b+'~'+a;
    if(set.has(key)) return;
    set.add(key);
    const sea = (a==='shuri'||b==='shuri'||a==='matsumae'||b==='matsumae'||a==='f_naminoue'||b==='f_naminoue');
    EDGES.push({a,b,d:dist(a,b),sea});
  };
  const auto = NODE_IDS.filter(id => id!=='shuri' && id!=='f_naminoue');
  auto.forEach(id => {
    const near = auto.filter(o=>o!==id).sort((p,q)=>dist(id,p)-dist(id,q)).slice(0,3);
    near.forEach(n => { if(dist(id,n) < 170) addEdge(id,n); });
  });
  addEdge('shuri','kagoshima');
  addEdge('shuri','f_naminoue');
  function components(){
    const comp={}; let c=0;
    NODE_IDS.forEach(id=>{
      if(comp[id]!==undefined) return;
      const stack=[id]; comp[id]=c;
      while(stack.length){
        const cur=stack.pop();
        EDGES.forEach(e=>{
          if(e.a===cur && comp[e.b]===undefined){comp[e.b]=c;stack.push(e.b);}
          if(e.b===cur && comp[e.a]===undefined){comp[e.a]=c;stack.push(e.a);}
        });
      }
      c++;
    });
    return {comp, n:c};
  }
  let guard=0;
  while(guard++<50){
    const {comp,n} = components();
    if(n<=1) break;
    let best=null;
    NODE_IDS.forEach(a=>NODE_IDS.forEach(b=>{
      if(comp[a]!==comp[b]){
        const d=dist(a,b);
        if(!best || d<best.d) best={a,b,d};
      }
    }));
    if(best) addEdge(best.a,best.b); else break;
  }
})();
const ADJ = {};
NODE_IDS.forEach(id=>ADJ[id]=[]);
EDGES.forEach(e=>{ADJ[e.a].push({to:e.b,d:e.d});ADJ[e.b].push({to:e.a,d:e.d});});

function dijkstra(from, to){
  const dist={}, prev={}, done={};
  NODE_IDS.forEach(id=>dist[id]=Infinity);
  dist[from]=0;
  for(;;){
    let u=null, best=Infinity;
    NODE_IDS.forEach(id=>{if(!done[id]&&dist[id]<best){best=dist[id];u=id;}});
    if(u===null) break;
    if(u===to) break;
    done[u]=true;
    ADJ[u].forEach(({to:v,d})=>{
      if(dist[u]+d<dist[v]){dist[v]=dist[u]+d;prev[v]=u;}
    });
  }
  if(dist[to]===Infinity) return null;
  const path=[to]; let cur=to;
  while(cur!==from){cur=prev[cur];path.unshift(cur);}
  return {path, dist:dist[to]};
}
// 実距離(m)
function haversine(lat1,lon1,lat2,lon2){
  const R=6371000, toR=Math.PI/180;
  const dLat=(lat2-lat1)*toR, dLon=(lon2-lon1)*toR;
  const a=Math.sin(dLat/2)**2 + Math.cos(lat1*toR)*Math.cos(lat2*toR)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}

// ---------- セーブ ----------
function save(){
  try{ localStorage.setItem(SAVE_KEY, JSON.stringify(state)); }catch(e){}
}
function load(){
  try{
    const raw = localStorage.getItem(SAVE_KEY);
    if(!raw) return false;
    const s = JSON.parse(raw);
    if(s && s.v===1 && NODES[s.pos]){
      state = Object.assign(defaultState(), s);
      if(!state.train) state.train = {};
      return true;
    }
  }catch(e){}
  return false;
}

// ---------- 武将ヘルパー ----------
function lordKey(castleId, idx){ return castleId+'|'+idx; }
function lordByKey(key){
  const [cid, idx] = key.split('|');
  const c = CASTLES.find(x=>x.id===cid);
  if(!c) return null;
  const l = c.lords[+idx];
  return l ? {castle:c, lord:l, idx:+idx, key} : null;
}
function isOwned(castleId, idx){ return state.allies.includes(lordKey(castleId, idx)); }
function ownedByName(name){
  return state.allies.some(k=>{const r=lordByKey(k); return r && r.lord.n===name;});
}
function unitOf(castle, lord){
  return LORD_UNIT[lord.n] || CASTLE_UNIT[castle.id] || 'yari';
}
function trainOf(key){ return state.train[key]||0; }
function allyEffStats(key){
  const r = lordByKey(key);
  const b = TRAIN_BONUS[trainOf(key)];
  return {b:Math.min(120,r.lord.b+b), i:Math.min(120,r.lord.i+b), l:Math.min(120,r.lord.l+b)};
}
function lordPow(l){ return l.b*1.2 + l.i + l.l; }
function allyCount(){ return state.allies.length; }
function partySize(){ return 3 + Math.floor(state.stats.tou/15); }
function topAllies(){
  return state.allies.map(k=>{
    const r = lordByKey(k);
    if(!r) return null;
    r.eff = allyEffStats(k);
    return r;
  }).filter(Boolean)
    .sort((a,b)=>lordPow(b.eff)-lordPow(a.eff))
    .slice(0, partySize());
}
function playerPow(){
  const s = state.stats;
  let p = 30 + s.bu*1.5 + s.chi*0.8 + s.tou*1.0;
  topAllies().forEach(a=>p += lordPow(a.eff)*0.16);
  return p;
}
function playerMaxHP(){
  let hp = 120 + state.stats.tai*3;
  topAllies().forEach(a=>hp += a.eff.l*0.4);
  return Math.round(hp);
}
function enemyPow(l){
  return lordPow(l) * TIER_MULT[l.t] * (1 + Math.min(allyCount(),50)*0.018);
}
function conqueredCount(){
  return CASTLES.filter(c=>c.lords.some((_,i)=>isOwned(c.id,i))).length;
}
function masteredCount(){
  return CASTLES.filter(c=>c.lords.every((_,i)=>isOwned(c.id,i))).length;
}
function totalLords(){ return CASTLES.reduce((s,c)=>s+c.lords.length,0); }

// 殿のレベル：獲得した能力の合計から算出
function statGains(){
  const s=state.stats;
  return Math.max(0,(s.tai-20)+(s.bu-15)+(s.chi-15)+(s.tou-10)+(s.un-10));
}
function playerLevel(){ return 1 + Math.floor(statGains()/12); }
function maxUnlockedRank(){
  const lv = playerLevel();
  let m = 1;
  RANKS.forEach(r=>{ if(lv>=r.lv) m=r.n; });
  return m;
}
function rankArmyName(unitKey, rank){
  if(rank>=3) return UNIT_BEST[unitKey];
  return (rank===2?'精鋭・':'通常の') + UNITS[unitKey].name;
}

// レア大名などの特殊条件
function condOk(castle, lord){
  if(!lord.cond) return true;
  const c = lord.cond;
  switch(c.type){
    case 'stat':     return state.stats[c.stat] >= c.n;
    case 'hasAlly':  return ownedByName(c.name);
    case 'hasAllies':return c.names.filter(ownedByName).length >= c.need;
    case 'castles':  return conqueredCount() >= c.n;
    case 'allies':   return allyCount() >= c.n;
    case 'visits':   return (state.visits[castle.id]||0) >= c.n;
    case 'pray':     return state.prays >= c.n;
    case 'wins':     return state.wins >= c.n;
  }
  return false;
}
function condText(castle, lord){
  const c = lord.cond;
  if(!c) return '';
  switch(c.type){
    case 'stat':     return STAT_NAMES[c.stat]+' '+c.n+'以上';
    case 'hasAlly':  return '「'+c.name+'」を仲間に';
    case 'hasAllies':return '['+c.names.join('・')+'] のうち'+c.need+'人を仲間に';
    case 'castles':  return c.n+'城を攻略';
    case 'allies':   return '仲間'+c.n+'人';
    case 'visits':   return 'この城に'+c.n+'回来訪';
    case 'pray':     return '参拝'+c.n+'回';
    case 'wins':     return '戦勝'+c.n+'回';
  }
  return '';
}
// その城で今挑める相手。未所持を優先し、いなければ「鍛え直し」（所持済みで練度上限未満）
function challengerFor(castle){
  const eligible = castle.lords
    .map((l,i)=>({l,i}))
    .filter(({l}) => allyCount() >= TIER[l.t].req)
    .filter(({l}) => condOk(castle,l));
  const sortFn = (a,b)=>b.l.t-a.l.t || lordPow(b.l)-lordPow(a.l);
  const unowned = eligible.filter(({i})=>!isOwned(castle.id,i));
  if(unowned.length){
    unowned.sort(sortFn);
    return {l:unowned[0].l, i:unowned[0].i, retrain:false};
  }
  const maxTrain = RANKS[maxUnlockedRank()-1].train;
  if(maxTrain<=0) return null;
  const owned = eligible.filter(({l,i})=>isOwned(castle.id,i) && trainOf(lordKey(castle.id,i)) < maxTrain);
  if(owned.length){
    owned.sort(sortFn);
    return {l:owned[0].l, i:owned[0].i, retrain:true};
  }
  return null;
}

// ---------- 成長 ----------
function addSteps(n){
  state.steps += n;
  const gains = {};
  while(Math.floor(state.steps/HP_GAIN_STEPS) > state.hpGiven){
    state.hpGiven++;
    if(state.stats.tai < 200){ state.stats.tai++; gains.tai=(gains.tai||0)+1; }
  }
  while(Math.floor(state.steps/RND_GAIN_STEPS) > state.rndGiven){
    state.rndGiven++;
    const pool = ['bu','chi','un'].filter(k=>state.stats[k]<99);
    if(pool.length){
      const k = pool[Math.floor(Math.random()*pool.length)];
      state.stats[k]++; gains[k]=(gains[k]||0)+1;
    }
  }
  return gains;
}
function gainRandomStats(n){
  const got={};
  for(let k=0;k<n;k++){
    const pool=['tai','bu','chi','un'].filter(s=>state.stats[s]<(s==='tai'?200:99));
    if(!pool.length) break;
    const s=pool[Math.floor(Math.random()*pool.length)];
    state.stats[s]++; got[s]=(got[s]||0)+1;
  }
  return gainsText(got);
}
function gainsText(g){
  return Object.keys(g).map(k=>STAT_NAMES[k]+'+'+g[k]).join('、');
}
function addLog(msg){
  state.log.unshift('【'+state.steps.toLocaleString()+'歩】 '+msg);
  if(state.log.length>14) state.log.length = 14;
}

// ---------- SVG マップ ----------
const SVG_NS = 'http://www.w3.org/2000/svg';
const MAP_W = 800, MAP_H = 880;
let svg, vb = {x:0,y:0,w:MAP_W,h:MAP_H};
let selectedNode = null;
let travelling = null;

function el(tag, attrs, parent){
  const e = document.createElementNS(SVG_NS, tag);
  for(const k in attrs) e.setAttribute(k, attrs[k]);
  if(parent) parent.appendChild(e);
  return e;
}
function applyVB(){
  svg.setAttribute('viewBox', vb.x+' '+vb.y+' '+vb.w+' '+vb.h);
  const scale = MAP_W/vb.w;
  svg.classList.toggle('show-labels', scale > 1.5);
}
function buildMap(){
  svg = document.getElementById('map');
  svg.setAttribute('viewBox','0 0 '+MAP_W+' '+MAP_H);
  el('rect',{x:-2000,y:-2000,width:5000,height:5000,class:'sea'},svg);
  COAST.forEach(c=>{
    const pts = c.pts.map(([lat,lon])=>{const p=proj(lat,lon);return p.x+','+p.y;}).join(' ');
    el('polygon',{points:pts,class:'land'},svg);
  });
  const okp1 = proj(31.55,128.55), okp2 = proj(30.6,129.65);
  el('rect',{x:okp1.x,y:okp1.y,width:okp2.x-okp1.x,height:okp2.y-okp1.y,class:'inset-box'},svg);
  const okt = proj(31.62,128.6);
  el('text',{x:okt.x,y:okt.y,class:'inset-label'},svg).textContent='沖縄（別図）';
  REGION_LABELS.forEach(([t,lat,lon])=>{
    const p = proj(lat,lon);
    el('text',{x:p.x,y:p.y,class:'region-label'},svg).textContent = t;
  });
  EDGES.forEach(e=>{
    const a=NODES[e.a], b=NODES[e.b];
    el('line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,class:'road'+(e.sea?' sea-route':'')},svg);
  });
  el('polyline',{id:'route-line',points:'',class:'route hidden'},svg);
  NODE_IDS.forEach(id=>{
    const n = NODES[id];
    const g = el('g',{class:'node '+n.kind,'data-id':id,transform:'translate('+n.x+','+n.y+')'},svg);
    el('circle',{r:n.kind==='castle'?9:7,class:'node-ring'},g);
    const icon = el('text',{class:'node-icon',y:n.kind==='castle'?4.5:4},g);
    icon.textContent = n.kind==='castle' ? '🏯' : FAC_TYPE[n.data.type].icon;
    el('text',{class:'node-badge',x:8,y:-6},g);
    const lbl = el('text',{class:'node-label',y:-14},g);
    lbl.textContent = n.data.name;
    g.addEventListener('click',ev=>{ev.stopPropagation();onNodeClick(id);});
  });
  const pg = el('g',{id:'player-marker'},svg);
  el('circle',{r:8,class:'player-ring'},pg);
  el('text',{y:4,class:'player-text'},pg).textContent='殿';
  movePlayerMarker();
  setupPanZoom();
  svg.addEventListener('click',()=>{selectNode(null);});
  updateNodeStates();
}
function movePlayerMarker(x,y){
  const m = document.getElementById('player-marker');
  if(!m) return;
  if(x===undefined){
    if(state.mode==='gps' && geoNow){
      const p = projGeo(geoNow.lat, geoNow.lon);
      x=p.x; y=p.y;
    }else{
      const n=NODES[state.pos]; x=n.x; y=n.y;
    }
  }
  m.setAttribute('transform','translate('+x+','+y+')');
}
function setupPanZoom(){
  const wrap = document.getElementById('mapwrap');
  let drag=null, moved=false;
  const pt=(ev)=> ev.touches? {x:ev.touches[0].clientX,y:ev.touches[0].clientY} : {x:ev.clientX,y:ev.clientY};
  const down=ev=>{drag={start:pt(ev),vb0:Object.assign({},vb)};moved=false;};
  const move=ev=>{
    if(!drag) return;
    const p=pt(ev);
    const r=wrap.getBoundingClientRect();
    const dx=(p.x-drag.start.x)*vb.w/r.width, dy=(p.y-drag.start.y)*vb.h/r.height;
    if(Math.abs(p.x-drag.start.x)+Math.abs(p.y-drag.start.y)>6) moved=true;
    vb.x=drag.vb0.x-dx; vb.y=drag.vb0.y-dy; applyVB();
    if(ev.touches) ev.preventDefault();
  };
  const up=()=>{drag=null;};
  svg.addEventListener('mousedown',down);
  window.addEventListener('mousemove',move);
  window.addEventListener('mouseup',up);
  svg.addEventListener('touchstart',down,{passive:true});
  svg.addEventListener('touchmove',move,{passive:false});
  svg.addEventListener('touchend',up);
  svg.addEventListener('wheel',ev=>{
    ev.preventDefault();
    zoomAt(ev.deltaY<0?0.82:1.22, ev);
  },{passive:false});
  document.getElementById('zin').onclick=()=>zoomAt(0.74);
  document.getElementById('zout').onclick=()=>zoomAt(1.35);
  document.getElementById('zhome').onclick=()=>{vb={x:0,y:0,w:MAP_W,h:MAP_H};applyVB();};
  svg.addEventListener('click',ev=>{if(moved){ev.stopImmediatePropagation();moved=false;}},true);
}
function zoomAt(f, ev){
  const wrap=document.getElementById('mapwrap');
  const r=wrap.getBoundingClientRect();
  let cx=vb.x+vb.w/2, cy=vb.y+vb.h/2;
  if(ev){
    cx = vb.x + (ev.clientX-r.left)/r.width*vb.w;
    cy = vb.y + (ev.clientY-r.top)/r.height*vb.h;
  }
  let w=vb.w*f, h=vb.h*f;
  w=Math.max(110,Math.min(MAP_W*1.4,w)); h=w*(MAP_H/MAP_W);
  vb={x:cx-(cx-vb.x)*(w/vb.w), y:cy-(cy-vb.y)*(h/vb.h), w, h};
  applyVB();
}
function centerOn(id, scale){
  const n=NODES[id];
  const w = scale? MAP_W/scale : vb.w;
  const h = w*(MAP_H/MAP_W);
  vb={x:n.x-w/2,y:n.y-h/2,w,h};
  applyVB();
}

// ---------- 現地モード（GPS） ----------
let geoWatchId=null, geoLast=null, geoNow=null, geoStatus='off', lastHereId=null, lastGeoSave=0;
function gpsHereId(){
  if(state.mode!=='gps' || !geoNow) return null;
  let best=null, bd=Infinity;
  NODE_IDS.forEach(id=>{
    const n=NODES[id];
    const c=realCoords(n);
    const d=haversine(geoNow.lat,geoNow.lon,c.lat,c.lon);
    const r=n.kind==='castle'?HERE_RADIUS.castle:HERE_RADIUS.facility;
    if(d<=r && d<bd){bd=d;best=id;}
  });
  return best;
}
function isHere(id){
  return state.mode==='gps' ? gpsHereId()===id : state.pos===id;
}
function nearestCastleInfo(){
  if(!geoNow) return null;
  let best=null, bd=Infinity;
  NODE_IDS.forEach(id=>{
    const n=NODES[id];
    if(n.kind!=='castle') return;
    const c=realCoords(n);
    const d=haversine(geoNow.lat,geoNow.lon,c.lat,c.lon);
    if(d<bd){bd=d;best=id;}
  });
  return best? {id:best, dist:bd} : null;
}
function setMode(m){
  if(m===state.mode) return;
  if(m==='gps'){
    if(!('geolocation' in navigator)){ toast('📍 この端末では位置情報が使えない…'); return; }
    if(!window.isSecureContext){ toast('📍 現地モードは https か localhost で開いた時のみ使える'); return; }
    state.mode='gps'; save();
    startGeo();
    toast('📍 現地モード！ 実際に城へ行けば戦える。歩いた分は修行になる！');
  }else{
    state.mode='virtual'; save();
    stopGeo();
    toast('🚶 旅モード。地図をクリックして進もう。');
  }
  updateModeUI(); movePlayerMarker(); updateNodeStates(); renderPanel();
}
function startGeo(){
  stopGeo();
  geoStatus='wait';
  updateModeUI();
  geoWatchId = navigator.geolocation.watchPosition(onFix, err=>{
    geoStatus='err';
    toast('📍 '+(err.code===1?'位置情報の許可が必要です（ブラウザの設定を確認）':'位置情報を取得できなかった…'));
    state.mode='virtual'; save();
    stopGeo(); updateModeUI(); movePlayerMarker(); updateNodeStates(); renderPanel();
  }, {enableHighAccuracy:true, maximumAge:5000, timeout:20000});
}
function stopGeo(){
  if(geoWatchId!==null){ try{navigator.geolocation.clearWatch(geoWatchId);}catch(e){} geoWatchId=null; }
  geoStatus='off'; geoNow=null; geoLast=null; lastHereId=null;
}
function onFix(p){
  if(state.mode!=='gps') return;
  const lat=p.coords.latitude, lon=p.coords.longitude, acc=p.coords.accuracy, ts=p.timestamp;
  if(acc>150){ geoStatus='lowacc'; updateModeUI(); return; }
  geoStatus='ok';
  geoNow={lat,lon,acc,ts};
  if(geoLast){
    const d=haversine(geoLast.lat,geoLast.lon,lat,lon);
    if(d>=15){
      const dt=Math.max(1,(ts-geoLast.ts)/1000);
      const speed=d/dt; // m/s
      if(speed<=3.34){ // 12km/h以下＝徒歩とみなし歩数化
        const g=addSteps(Math.round(d/0.7));
        if(Object.keys(g).length){
          toast('🚶 歩いた修行の成果: '+gainsText(g));
          addLog('実際に歩いて '+gainsText(g));
        }
      }
      geoLast={lat,lon,ts};
      if(Date.now()-lastGeoSave>10000){ save(); lastGeoSave=Date.now(); }
    }
  }else{
    geoLast={lat,lon,ts};
  }
  movePlayerMarker();
  const here=gpsHereId();
  if(here!==lastHereId){
    lastHereId=here;
    if(here && NODES[here].kind==='castle'){
      state.visits[here]=(state.visits[here]||0)+1; save();
      toast('🏯 '+NODES[here].data.name+'の城域に入った！攻められるぞ！');
      selectNode(here);
    }else if(here){
      toast('⛩ '+NODES[here].data.name+'に到着！');
      selectNode(here);
    }else{
      updateNodeStates(); renderPanel();
    }
  }
  updateModeUI(); updateHud();
}
function updateModeUI(){
  const btn=document.getElementById('mode-btn');
  const st=document.getElementById('mode-status');
  if(!btn) return;
  if(state.mode==='gps'){
    btn.textContent='🚶 旅モードへ';
    let t='📍 測位中…';
    if(geoStatus==='ok' && geoNow){
      const here=gpsHereId();
      if(here) t='📍 '+NODES[here].data.name+'の域内！';
      else{
        const near=nearestCastleInfo();
        t = near? '📍 最寄り: '+NODES[near.id].data.name+' '+(near.dist/1000).toFixed(1)+'km' : '📍 測位OK';
      }
    }else if(geoStatus==='lowacc') t='📍 GPS精度待ち…';
    st.textContent=t;
  }else{
    btn.textContent='📍 現地モードへ';
    st.textContent='🚶 旅モード（クリックで移動）';
  }
}

// ノードの見た目更新
function updateNodeStates(){
  const hereId = state.mode==='gps' ? gpsHereId() : state.pos;
  document.querySelectorAll('.node').forEach(g=>{
    const id=g.getAttribute('data-id');
    const n=NODES[id];
    const badge=g.querySelector('.node-badge');
    g.classList.toggle('selected', selectedNode===id);
    g.classList.toggle('here', hereId===id);
    if(n.kind==='castle'){
      const c=n.data;
      const owned=c.lords.filter((_,i)=>isOwned(c.id,i)).length;
      const mastered = owned===c.lords.length;
      const ch=challengerFor(c);
      const rare = ch && ch.l.t===5;
      g.classList.toggle('mastered',mastered);
      g.classList.toggle('available',!!ch);
      g.classList.toggle('rare-ready',!!rare);
      badge.textContent = rare ? '！' : (mastered ? '✓' : (owned>0?'◦':''));
    }else{
      const since = state.steps - (state.facLast[id]||-FAC_COOLDOWN);
      g.classList.toggle('available', since>=FAC_COOLDOWN);
      badge.textContent='';
    }
  });
}

// ---------- ノード選択・パネル ----------
function onNodeClick(id){
  if(travelling){ toast('移動中でござる…'); return; }
  selectNode(id);
}
function selectNode(id){
  selectedNode=id;
  updateNodeStates();
  renderPanel();
}
function renderPanel(){
  const panel=document.getElementById('nodepanel');
  if(!panel) return;
  if(!selectedNode){ panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');
  const n=NODES[selectedNode];
  const here = isHere(selectedNode);
  let html='';
  if(n.kind==='castle'){
    const c=n.data;
    const owned=c.lords.filter((_,i)=>isOwned(c.id,i)).length;
    const ch=challengerFor(c);
    html += '<div class="pn-head"><span class="pn-icon">🏯</span><div><div class="pn-name">'+c.name+'</div><div class="pn-sub">'+c.pref+'　仲間 '+owned+'/'+c.lords.length+'人'+(owned===c.lords.length?'　<span class="gold">制覇！</span>':'')+'</div></div></div>';
    html += '<div class="pn-lords">';
    c.lords.forEach((l,i)=>{
      const own=isOwned(c.id,i);
      const key=lordKey(c.id,i);
      const tr=trainOf(key);
      const unlocked = allyCount()>=TIER[l.t].req;
      const ok = unlocked && condOk(c,l);
      let status, cls;
      if(own){ status='仲間'+(tr?'（'+TRAIN_MARK[tr]+TRAIN_NAME[tr]+'）':''); cls='own'; }
      else if(ok){ status='挑戦可'; cls='ready'; }
      else if(!unlocked){ status='仲間'+TIER[l.t].req+'人で出現'; cls='locked'; }
      else { status='条件未達'; cls='locked'; }
      const name = own||ok ? l.n : '？？？';
      const uicon = UNITS[unitOf(c,l)].icon;
      html += '<div class="pn-lord '+cls+'">'
        +'<span class="tier" style="color:'+TIER[l.t].color+'">'+TIER[l.t].label+'</span>'
        +'<span class="uicon">'+uicon+'</span>'
        +'<span class="lname">'+name+(own&&tr?' <span class="train">'+TRAIN_MARK[tr]+'</span>':'')+'</span>'
        +(own?'<span class="lpow">武'+l.b+' 知'+l.i+' 統'+l.l+'</span>':'')
        +'<span class="lstat">'+status+'</span></div>';
      if(l.t===5 && !own){
        html += '<div class="pn-hint">❝ '+l.hint+' ❞'+(l.cond?'<br><span class="cond">条件: 仲間'+TIER[5].req+'人 ＋ '+condText(c,l)+'</span>':'')+'</div>';
      }
    });
    html += '</div>';
    if(here){
      if(ch){
        html += '<button class="btn primary" id="pn-action">'+(ch.retrain
          ? '🎖 鍛え直しの戦（'+ch.l.n+'の部隊）'
          : '⚔ 攻める（'+TIER[ch.l.t].label+'・'+UNITS[unitOf(c,ch.l)].name+'が守っている）')+'</button>';
      }else if(owned===c.lords.length){
        html += '<div class="pn-note">この城は制覇済み。鍛え直しは殿のLvが上がれば挑める。</div>';
      }else{
        html += '<div class="pn-note">今は挑める相手がいない。仲間を増やすか条件を満たして再訪せよ。</div>';
      }
    }
  }else{
    const f=n.data, ft=FAC_TYPE[f.type];
    const since = state.steps-(state.facLast[f.id]||-FAC_COOLDOWN);
    const ready = since>=FAC_COOLDOWN;
    html += '<div class="pn-head"><span class="pn-icon">'+ft.icon+'</span><div><div class="pn-name">'+f.name+'</div><div class="pn-sub">'+ft.label+'　'+ft.desc+'（+'+FAC_GAIN+'）</div></div></div>';
    if(here){
      if(ready){
        html += '<button class="btn primary" id="pn-action">'+(f.type==='dojo'?'💪 鍛錬する':'🙏 参拝する')+'</button>';
      }else{
        html += '<div class="pn-note">御利益はまだ先。あと '+(FAC_COOLDOWN-since).toLocaleString()+' 歩 歩いてから来られよ。</div>';
      }
    }
  }
  if(!here){
    if(state.mode==='gps'){
      const c=realCoords(n);
      const d = geoNow? haversine(geoNow.lat,geoNow.lon,c.lat,c.lon) : null;
      html += '<div class="pn-note">📍 '+(d!==null? 'ここから直線 '+(d/1000).toFixed(1)+' km。実際に訪れると挑戦できる！' : '測位中… 実際に訪れると挑戦できる！')+'</div>';
    }else{
      const r=dijkstra(state.pos,selectedNode);
      if(r){
        html += '<button class="btn" id="pn-go">🚶 ここへ向かう（約'+Math.round(r.dist*STEPS_PER_PX).toLocaleString()+'歩）</button>';
      }
    }
  }
  html += '<button class="pn-close" id="pn-close">✕</button>';
  panel.innerHTML=html;
  const go=document.getElementById('pn-go');
  if(go) go.onclick=()=>travelTo(selectedNode);
  const act=document.getElementById('pn-action');
  if(act) act.onclick=()=>{
    const nn=NODES[selectedNode];
    if(nn.kind==='castle') openPrep(nn.data);
    else useFacility(nn.data);
  };
  document.getElementById('pn-close').onclick=()=>selectNode(null);
}

// ---------- 移動（旅モード） ----------
function travelTo(targetId){
  if(state.mode==='gps'){ toast('現地モード中は実際に歩いて向かおう！'); return; }
  if(travelling || targetId===state.pos) return;
  const r=dijkstra(state.pos,targetId);
  if(!r) return;
  const pts=r.path.map(id=>NODES[id]);
  document.getElementById('route-line').setAttribute('points',pts.map(p=>p.x+','+p.y).join(' '));
  document.getElementById('route-line').classList.remove('hidden');
  travelling={pts, seg:0, prog:0, gains:{}, stepsAcc:0, target:targetId, last:performance.now()};
  selectNode(null);
  requestAnimationFrame(travelTick);
}
function travelTick(now){
  const t=travelling;
  if(!t) return;
  const dt=Math.min(0.05,(now-t.last)/1000); t.last=now;
  let remain=TRAVEL_SPEED*dt;
  while(remain>0 && t.seg<t.pts.length-1){
    const a=t.pts[t.seg], b=t.pts[t.seg+1];
    const segLen=Math.hypot(b.x-a.x,b.y-a.y);
    const left=segLen-t.prog;
    const adv=Math.min(left,remain);
    t.prog+=adv; remain-=adv;
    t.stepsAcc+=adv*STEPS_PER_PX;
    if(t.stepsAcc>=1){
      const n=Math.floor(t.stepsAcc); t.stepsAcc-=n;
      const g=addSteps(n);
      for(const k in g) t.gains[k]=(t.gains[k]||0)+g[k];
    }
    if(t.prog>=segLen-0.001){t.seg++;t.prog=0;}
    const ratio = segLen ? t.prog/segLen : 0;
    movePlayerMarker(a.x+(b.x-a.x)*ratio, a.y+(b.y-a.y)*ratio);
  }
  updateHud();
  if(t.seg>=t.pts.length-1){
    state.pos=t.target;
    travelling=null;
    document.getElementById('route-line').classList.add('hidden');
    movePlayerMarker();
    const n=NODES[state.pos];
    if(n.kind==='castle'){
      state.visits[state.pos]=(state.visits[state.pos]||0)+1;
    }
    if(Object.keys(t.gains).length){
      toast('🚶 道中の修行: '+gainsText(t.gains));
      addLog('道中の修行で '+gainsText(t.gains));
    }
    save();
    updateNodeStates();
    selectNode(state.pos);
    return;
  }
  requestAnimationFrame(travelTick);
}

// ---------- 施設 ----------
function useFacility(f){
  const since=state.steps-(state.facLast[f.id]||-FAC_COOLDOWN);
  if(since<FAC_COOLDOWN){renderPanel();return;}
  const ft=FAC_TYPE[f.type];
  state.facLast[f.id]=state.steps;
  const k=ft.stat;
  const amt=Math.min(FAC_GAIN, 99-state.stats[k]);
  state.stats[k]+=amt;
  if(f.type!=='dojo') state.prays++;
  const msg=(f.type==='dojo'?'鍛錬した！ ':'参拝した！ ')+STAT_NAMES[k]+'+'+amt;
  toast((f.type==='dojo'?'💪 ':'🙏 ')+f.name+'で'+msg);
  addLog(f.name+'で'+msg);
  save();
  updateHud(); updateNodeStates(); renderPanel();
}

// ---------- 武将似顔絵（浮世絵風SVGを名前から決定論生成） ----------
function strHash(s){
  let h=5381;
  for(let i=0;i<s.length;i++){ h=((h<<5)+h+s.charCodeAt(i))|0; }
  return Math.abs(h);
}
let PORTRAIT_SEQ=0;
function hexShade(c,f){
  const n=parseInt(c.slice(1),16);
  return 'rgb('+Math.round(((n>>16)&255)*f)+','+Math.round(((n>>8)&255)*f)+','+Math.round((n&255)*f)+')';
}
function portraitSVG(lord, castle, size){
  size = size||96;
  const o = (typeof PORTRAIT_OVR!=='undefined' && PORTRAIT_OVR[lord.n]) || {};
  const h = strHash(lord.n);
  const pick = (arr,salt)=>arr[Math.floor(h/Math.pow(3,salt))%arr.length];
  const uid = 'pg'+(PORTRAIT_SEQ++)+'_';
  const unit = castle ? unitOf(castle,lord) : 'yari';
  const tier = lord.t||1;
  let style = o.style || '';
  if(!style && o.head==='monk') style='monk';
  if(!style && unit==='shinobi') style='shinobi';
  if(!style) style='busho';
  const elder = !!o.elder;
  const skins = [['#f0d2ac','#d2a276'],['#e6c096','#c4915f'],['#d6a87a','#ad7c50']];
  const skin = style==='court' ? ['#f1e7d8','#d8c5ab'] : pick(skins,1);
  // 札板色と縅（おどし）紐色
  const armors = [['#7e2a2a','#e0b95e'],['#2e4a6b','#c9a86a'],['#3c5a3a','#d8b25c'],['#4a3c5e','#c98a96'],['#5e4d28','#e0c878'],['#26262e','#c43a3a']];
  let plate = pick(armors,2);
  if(o.armorC) plate=[o.armorC, o.laceC||'#d8b25c'];
  const hairC = elder ? '#a8a5a0' : '#221d19';
  const gold = '#d8b25c';
  const metals = [['#565664','#23232b'],['#4e4438','#221c14'],['#483c4c','#1d1722']];
  const metal = pick(metals,3);
  const beard = o.beard!==undefined ? o.beard : (style==='female'||style==='femaleW'||style==='page'||style==='court'||style==='shinobi') ? 'none' : pick(['none','thin','goatee','full','none','thin'],4);
  const grayB = (beard==='fullGray'||beard==='goateeGray'||elder);
  const bd = grayB ? '#b5b2ac' : '#241c15';
  const fierce = (lord.b||50)>=75 && style!=='female' && style!=='femaleW' && style!=='court' && style!=='page';
  const eyeStyle = o.eyes || pick(['narrow','almond','narrow','almond'],5);
  const P=[];
  P.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 120" width="'+size+'" height="'+Math.round(size*1.2)+'" class="portrait">');
  // ---- 定義 ----
  const bgStops = tier>=4
    ? '<stop offset="0%" stop-color="#c9a44e"/><stop offset="55%" stop-color="#aa8338"/><stop offset="100%" stop-color="#7c5f28"/>'
    : '<stop offset="0%" stop-color="#28324e"/><stop offset="100%" stop-color="#131927"/>';
  P.push('<defs>'
    +'<radialGradient id="'+uid+'sk" cx="46%" cy="38%" r="75%"><stop offset="0%" stop-color="'+skin[0]+'"/><stop offset="100%" stop-color="'+skin[1]+'"/></radialGradient>'
    +'<linearGradient id="'+uid+'mt" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="'+metal[0]+'"/><stop offset="100%" stop-color="'+metal[1]+'"/></linearGradient>'
    +'<linearGradient id="'+uid+'pl" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="'+plate[0]+'"/><stop offset="100%" stop-color="'+hexShade(plate[0],0.45)+'"/></linearGradient>'
    +'<linearGradient id="'+uid+'gd" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#f2d57c"/><stop offset="100%" stop-color="#ad893a"/></linearGradient>'
    +'<linearGradient id="'+uid+'bg" x1="0" y1="0" x2="0" y2="1">'+bgStops+'</linearGradient>'
    +'<linearGradient id="'+uid+'vg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="0.38"/></linearGradient>'
    +'</defs>');
  // ---- 背景（大名以上は金屏風） ----
  P.push('<rect x="2" y="2" width="96" height="116" rx="7" fill="url(#'+uid+'bg)"/>');
  if(tier>=4){
    let lines='';
    for(let y=8;y<116;y+=5.5) lines+='M4,'+y+' H96 ';
    P.push('<path d="'+lines+'" stroke="#00000010" stroke-width="0.8"/>');
    P.push('<path d="M2,23 Q16,18 30,23 T58,23 T86,23 T98,22 L98,30 Q82,35 64,30 T34,30 T2,29 Z" fill="#ffffff16"/>');
    P.push('<path d="M2,97 Q20,92 40,97 T78,97 T98,96 L98,105 Q78,110 56,105 T20,105 T2,104 Z" fill="#00000018"/>');
  }else{
    P.push('<path d="M2,28 Q18,23 34,28 T66,28 T98,27 L98,34 Q80,39 60,34 T24,34 T2,33 Z" fill="#ffffff08"/>');
  }
  if(tier===5){
    for(let i=0;i<12;i++){
      const a=i*30*Math.PI/180;
      P.push('<line x1="50" y1="48" x2="'+(50+Math.cos(a)*74).toFixed(1)+'" y2="'+(48+Math.sin(a)*74).toFixed(1)+'" stroke="#fff3cf" stroke-width="3.5" opacity="0.09"/>');
    }
  }
  if(o.extra==='lightning') P.push('<path d="M14,9 L24,25 L17,25 L28,44" stroke="#ffe9a8" stroke-width="2.6" fill="none" opacity="0.7" stroke-linejoin="round"/>');
  // ---- 後方要素（後ろ髪・錣・薙刀） ----
  if(style==='female'||style==='femaleW'){
    if(style==='femaleW') P.push('<path d="M70,118 L87,55" stroke="#5e4324" stroke-width="2.6"/><path d="M87,55 Q92,45 87,38" stroke="#c9ccd8" stroke-width="3.4" fill="none"/>');
    P.push('<path d="M29.5,42 Q26,17 50,15 Q74,17 70.5,42 L73.5,98 Q62,106 50,106 Q38,106 26.5,98 Z" fill="'+hairC+'"/>');
    P.push('<path d="M33,30 Q50,21 67,30" stroke="#ffffff18" stroke-width="2.6" fill="none"/>');
  }
  if(style==='busho'){
    P.push('<path d="M33,38 Q21,46 23.5,63 L34,58 Q29.5,48 35,40 Z" fill="url(#'+uid+'pl)" stroke="#00000044" stroke-width="0.8"/>');
    P.push('<path d="M67,38 Q79,46 76.5,63 L66,58 Q70.5,48 65,40 Z" fill="url(#'+uid+'pl)" stroke="#00000044" stroke-width="0.8"/>');
    P.push('<path d="M26,52 L33.5,49.5 M74,52 L66.5,49.5" stroke="'+plate[1]+'" stroke-width="1.4" opacity="0.85"/>');
  }
  // ---- 首 ----
  P.push('<path d="M44,64 H56 L57.5,82 H42.5 Z" fill="url(#'+uid+'sk)"/>');
  P.push('<path d="M44,64 H56 L55.2,72 Q50,75 44.8,72 Z" fill="#00000028"/>');
  // ---- 体 ----
  if(style==='female'||style==='femaleW'){
    const kim=pick([['#7e2a3a','#3c2849'],['#2e4a6b','#6b2a4a'],['#5a3e6b','#7e2a2a']],8);
    P.push('<path d="M14,120 Q17,90 38,82 L50,96 L62,82 Q83,90 86,120 Z" fill="'+kim[0]+'"/>');
    P.push('<path d="M20,120 Q24,98 38,88 L50,102 L62,88 Q76,98 80,120 Z" fill="'+kim[1]+'" opacity="0.5"/>');
    P.push('<path d="M38,82 L50,96 L62,82 L58.5,79.5 L50,89 L41.5,79.5 Z" fill="#ece5d2"/>');
    P.push('<path d="M40.5,80.5 L50,91 L59.5,80.5" stroke="#a3333a" stroke-width="2" fill="none"/>');
    if(style==='femaleW'){
      P.push('<path d="M38,90 H62 L59.5,102 H40.5 Z" fill="url(#'+uid+'pl)" stroke="#00000044" stroke-width="0.7"/>');
      P.push('<path d="M40,94.5 H60 M40.7,98.5 H59.3" stroke="'+plate[1]+'" stroke-width="2" stroke-dasharray="2.6 2"/>');
    }
  }else if(style==='court'||style==='page'||style==='monk'){
    P.push('<path d="M13,120 L14.5,101 Q17,87 33,82 L45,77.5 H55 L67,82 Q83,87 85.5,101 L87,120 Z" fill="'+(style==='monk'?'#403b30':'#34344e')+'"/>');
    P.push('<path d="M41,79 L50,92 L59,79 L55.5,77 L50,84.5 L44.5,77 Z" fill="#ece5d2"/>');
    if(style==='monk'){
      P.push('<path d="M15,120 L66,80 L75,90 L31,120 Z" fill="#6b5a2e"/>');
      P.push('<path d="M22,113 L70,75 M27,117 L74,80" stroke="#00000026" stroke-width="1.2"/>');
      P.push('<circle cx="63" cy="92" r="2.6" fill="url(#'+uid+'gd)"/>');
    }
  }else{
    // 当世具足
    P.push('<path d="M13,120 L14,101 Q16,87 31,82 L43,77.5 H57 L69,82 Q84,87 86,101 L87,120 Z" fill="url(#'+uid+'mt)" stroke="#00000055" stroke-width="0.8"/>');
    if(style==='shinobi'){
      P.push('<path d="M13,120 L14,101 Q16,87 31,82 L43,77.5 H57 L69,82 Q84,87 86,101 L87,120 Z" fill="#23232b" opacity="0.85"/>');
      P.push('<path d="M30,93 H70 M27,103 H73 M26,113 H74" stroke="#3c3c4a" stroke-width="1.2"/>');
      P.push('<path d="M43,79 L57,93 M57,79 L43,93" stroke="#3c3c4a" stroke-width="1.6"/>');
      for(let i=0;i<14;i++) P.push('<circle cx="'+(32+(i%7)*6)+'" cy="'+(96+Math.floor(i/7)*10)+'" r="0.7" fill="#52525e"/>');
    }else{
      // 大袖（肩鎧）4段
      for(const sgn of [-1,1]){
        const cx = sgn<0 ? 22 : 78;
        P.push('<g transform="rotate('+(sgn*-9)+' '+cx+' 94)">');
        P.push('<rect x="'+(cx-14)+'" y="79.6" width="28" height="2.6" rx="1.3" fill="url(#'+uid+'gd)"/>');
        for(let i=0;i<4;i++){
          const y=82+i*7.4;
          P.push('<rect x="'+(cx-14)+'" y="'+y+'" width="28" height="6.8" rx="2.2" fill="url(#'+uid+'pl)" stroke="#00000044" stroke-width="0.7"/>');
          P.push('<path d="M'+(cx-11)+','+(y+2)+' H'+(cx+11)+'" stroke="'+plate[1]+'" stroke-width="1.8" stroke-dasharray="2.4 2.1" opacity="0.95"/>');
        }
        P.push('</g>');
      }
      // 胸板
      P.push('<path d="M36,79 H64 L61.5,92 H38.5 Z" fill="url(#'+uid+'pl)" stroke="#00000055" stroke-width="0.8"/>');
      P.push('<path d="M36,79.7 H64" stroke="url(#'+uid+'gd)" stroke-width="1.6"/>');
      // 胴の縅（段）
      for(const y of [96,103,110,116]){
        P.push('<path d="M30,'+(y-3.7)+' H70" stroke="#00000050" stroke-width="1"/>');
        P.push('<path d="M29,'+y+' H71" stroke="'+plate[1]+'" stroke-width="4" stroke-dasharray="3 2.4" opacity="0.92"/>');
      }
      // 茱萸・胸紐
      P.push('<circle cx="41" cy="84" r="1.7" fill="url(#'+uid+'gd)"/><circle cx="59" cy="84" r="1.7" fill="url(#'+uid+'gd)"/>');
      P.push('<path d="M41,84 L46.5,90 M59,84 L53.5,90" stroke="#a3333a" stroke-width="1.3"/>');
      // 喉輪
      P.push('<path d="M42,75.5 Q50,81 58,75.5 L58,79.5 Q50,85.5 42,79.5 Z" fill="url(#'+uid+'pl)" stroke="#00000044" stroke-width="0.7"/>');
    }
  }
  // ---- 顔 ----
  P.push('<ellipse cx="34.5" cy="52" rx="3" ry="4.4" fill="url(#'+uid+'sk)"/><ellipse cx="65.5" cy="52" rx="3" ry="4.4" fill="url(#'+uid+'sk)"/>');
  P.push('<path d="M35.5,46 q-1.2,3.2 0,6.4" stroke="#00000022" stroke-width="0.9" fill="none"/><path d="M64.5,46 q1.2,3.2 0,6.4" stroke="#00000022" stroke-width="0.9" fill="none"/>');
  const faceW = o.face==='slim' ? 13.2 : pick([14,14.8,15.6],6);
  P.push('<path d="M'+(50-faceW)+',38 L'+(50-faceW)+',50 Q'+(50-faceW+0.6)+',60 '+(50-faceW+7)+',67 Q'+(50-3)+',71.6 50,71.6 Q'+(50+3)+',71.6 '+(50+faceW-7)+',67 Q'+(50+faceW-0.6)+',60 '+(50+faceW)+',50 L'+(50+faceW)+',38 Q'+(50+faceW)+',27.5 50,26.6 Q'+(50-faceW)+',27.5 '+(50-faceW)+',38 Z" fill="url(#'+uid+'sk)" stroke="#00000026" stroke-width="0.8"/>');
  // 頬の陰影
  P.push('<path d="M'+(50-faceW+1.5)+',53 Q'+(50-faceW+4)+',61 '+(50-faceW+8.5)+',64.5 Q'+(50-faceW+4.5)+',62.5 '+(50-faceW+1.8)+',56 Z" fill="#00000013"/>');
  P.push('<path d="M'+(50+faceW-1.5)+',53 Q'+(50+faceW-4)+',61 '+(50+faceW-8.5)+',64.5 Q'+(50+faceW-4.5)+',62.5 '+(50+faceW-1.8)+',56 Z" fill="#00000013"/>');
  if(elder) P.push('<path d="M40.5,59.5 Q42.5,63.5 46,65.5 M59.5,59.5 Q57.5,63.5 54,65.5 M38,55 q1.6,1.4 3.2,1.6 M62,55 q-1.6,1.4 -3.2,1.6" stroke="#00000024" stroke-width="1.1" fill="none"/>');
  // ---- 髭（口より先） ----
  if(style!=='shinobi'){
    if(beard==='full'||beard==='fullGray'){
      P.push('<path d="M36.4,51 Q35,67 41.6,73.6 Q45.6,78.2 50,78.4 Q54.4,78.2 58.4,73.6 Q65,67 63.6,51 Q62.4,63 56.8,67.8 Q53.4,70.6 50,70.6 Q46.6,70.6 43.2,67.8 Q37.6,63 36.4,51 Z" fill="'+bd+'"/>');
      P.push('<path d="M42,69.5 q2.2,2.4 4.4,3 M58,69.5 q-2.2,2.4 -4.4,3 M50,71.6 V77" stroke="#ffffff14" stroke-width="1" fill="none"/>');
      P.push('<path d="M48.3,62.8 Q42,62 38.6,65.2 Q43,67 48.2,64.8 Z" fill="'+bd+'"/><path d="M51.7,62.8 Q58,62 61.4,65.2 Q57,67 51.8,64.8 Z" fill="'+bd+'"/>');
    }else if(beard==='goatee'||beard==='goateeGray'){
      P.push('<path d="M45.2,68.6 Q50,70 54.8,68.6 Q53.6,77 50,79.2 Q46.4,77 45.2,68.6 Z" fill="'+bd+'"/>');
      P.push('<path d="M48.4,62.9 Q44.4,62.3 41.8,63.9 M51.6,62.9 Q55.6,62.3 58.2,63.9" stroke="'+bd+'" stroke-width="1.7" fill="none" stroke-linecap="round"/>');
    }else if(beard==='thin'){
      P.push('<path d="M48.5,63.1 Q44,62.4 41.4,63.6 M51.5,63.1 Q56,62.4 58.6,63.6" stroke="'+bd+'" stroke-width="1.6" fill="none" stroke-linecap="round"/>');
    }
  }
  // ---- 眉・目 ----
  function browSVG(sgn){
    const cx = sgn<0 ? 42.6 : 57.4;
    if(style==='female'||style==='femaleW') return '<path d="M'+(cx+sgn*4.6)+',47.4 Q'+cx+',45 '+(cx-sgn*4)+',46.6" stroke="'+hairC+'" stroke-width="1.3" fill="none"/>';
    if(style==='court') return '<ellipse cx="'+(cx+sgn*0.5)+'" cy="42.6" rx="3.5" ry="1.7" fill="#3a3430"/>';
    const c = grayB ? '#b5b2ac' : '#241c15';
    if(fierce) return '<path d="M'+(cx+sgn*6.2)+',44.8 Q'+(cx+sgn*1)+',44.2 '+(cx-sgn*5)+',47.6 L'+(cx-sgn*4.4)+',49.6 Q'+(cx+sgn*0.5)+',46.8 '+(cx+sgn*5.2)+',47 Z" fill="'+c+'"/>';
    return '<path d="M'+(cx+sgn*6)+',48 Q'+cx+',44.8 '+(cx-sgn*4.6)+',46.4 L'+(cx-sgn*4.3)+',48.3 Q'+cx+',47 '+(cx+sgn*5)+',49.8 Z" fill="'+c+'"/>';
  }
  function eyeSVG(sgn){
    const cx = sgn<0 ? 43 : 57;
    let s='';
    const narrow = (eyeStyle==='narrow'||eyeStyle==='snake'||eyeStyle==='sharp');
    if(narrow){
      const oy = eyeStyle==='sharp' ? 49.6 : 50.9;
      const iy = eyeStyle==='sharp' ? 51.8 : 50.9;
      s+='<path d="M'+(cx+sgn*5)+','+oy+' Q'+cx+','+(fierce?49.2:48.6)+' '+(cx-sgn*5)+','+iy+'" stroke="#19120d" stroke-width="1.9" fill="none" stroke-linecap="round"/>';
      s+='<path d="M'+(cx+sgn*3.6)+',52.6 Q'+cx+',53.6 '+(cx-sgn*3.6)+',52.6" stroke="#00000026" stroke-width="0.9" fill="none"/>';
      if(eyeStyle==='snake') s+='<path d="M'+cx+',49.9 V52.1" stroke="#19120d" stroke-width="1.1"/>';
    }else{
      s+='<path d="M'+(cx-5)+',51 Q'+cx+',48.2 '+(cx+5)+',51 Q'+cx+',53.4 '+(cx-5)+',51 Z" fill="#f2e9d8"/>';
      s+='<circle cx="'+(cx+sgn*0.3)+'" cy="50.8" r="1.95" fill="#33241a"/>';
      s+='<circle cx="'+(cx+sgn*0.3)+'" cy="50.8" r="0.85" fill="#150f0a"/>';
      s+='<circle cx="'+(cx+sgn*0.3-0.6)+'" cy="50" r="0.5" fill="#ffffff" opacity="0.7"/>';
      s+='<path d="M'+(cx+sgn*5.4)+','+(fierce?49:50.4)+' Q'+cx+',47.6 '+(cx-sgn*5.4)+','+(fierce?51.6:50.4)+'" stroke="#19120d" stroke-width="1.8" fill="none" stroke-linecap="round"/>';
      s+='<path d="M'+(cx+sgn*4)+',52.9 Q'+cx+',53.9 '+(cx-sgn*4)+',52.7" stroke="#00000022" stroke-width="0.8" fill="none"/>';
    }
    return s;
  }
  P.push(browSVG(-1)+browSVG(1));
  P.push(eyeSVG(-1)+eyeSVG(1));
  // ---- 鼻 ----
  P.push('<path d="M48.7,52.5 Q47.7,57.5 47.1,60.1" stroke="#00000020" stroke-width="1.5" fill="none"/>');
  P.push('<path d="M47.1,60.3 Q47.7,62.5 50,62.6 Q52.3,62.5 52.9,60.3" stroke="#6b452f55" stroke-width="1.3" fill="none"/>');
  P.push('<path d="M47.7,61.8 q-1.1,-0.2 -1.5,-1.1 M52.3,61.8 q1.1,-0.2 1.5,-1.1" stroke="#4a2e1e88" stroke-width="1" fill="none"/>');
  // ---- 口 ----
  if(style!=='shinobi'){
    if(style==='female'||style==='femaleW'){
      P.push('<path d="M46.6,65.9 Q50,69.1 53.4,65.9 Q50,67.2 46.6,65.9 Z" fill="#b03a44"/>');
      P.push('<path d="M46.6,65.8 Q48.3,64.9 50,65.8 Q51.7,64.9 53.4,65.8" stroke="#8a2832" stroke-width="1" fill="none"/>');
    }else if(style==='court'){
      P.push('<path d="M47.4,65.6 Q50,67.4 52.6,65.6" stroke="#a3333a" stroke-width="2.2" fill="none"/>');
    }else{
      P.push('<path d="M44.6,66.4 Q50,'+(fierce?68.6:67.8)+' 55.4,66.4" stroke="#25160f" stroke-width="1.9" fill="none" stroke-linecap="round"/>');
      if(fierce) P.push('<path d="M44.5,66.5 l-1.5,1.1 M55.5,66.5 l1.5,1.1" stroke="#25160f" stroke-width="1.3"/>');
      P.push('<path d="M46.8,69.2 Q50,70.5 53.2,69.2" stroke="#00000022" stroke-width="1.1" fill="none"/>');
    }
  }
  // ---- 傷・眼帯 ----
  if(o.scar) P.push('<path d="M56.5,43.5 L64,58" stroke="#8c4438" stroke-width="1.8"/><path d="M56.8,47 l3,1 M58.6,50.6 l3,1 M60.4,54.2 l3,1" stroke="#8c4438" stroke-width="0.9"/>');
  if(o.eyepatch){
    P.push('<ellipse cx="43" cy="50.8" rx="6.6" ry="5.2" fill="#14100c" stroke="#000000" stroke-width="0.8"/>');
    P.push('<path d="M36.6,48.4 L64.6,42.8 M36.8,53.4 L63.4,58.8" stroke="#14100c" stroke-width="1.5"/>');
  }
  // ---- 頭部 ----
  const head = o.head || (style==='shinobi'?'shinobiHood': style==='monk'?'monk': style==='female'?'femaleHair': style==='femaleW'?'femaleBand': style==='court'?'eboshi': style==='page'?'pageHair':'kabuto');
  if(head==='kabuto'){
    const jingasa = tier<=2 && !o.crest && (h%10<3);
    // 忍緒（あご紐）
    P.push('<path d="M37.6,50 Q40,65 46.6,73.4 M62.4,50 Q60,65 53.4,73.4" stroke="#a3333a" stroke-width="1" fill="none" opacity="0.7"/>');
    P.push('<circle cx="50" cy="76" r="1.1" fill="#a3333a"/><path d="M50,76.6 l-2.2,2.8 M50,76.6 l2.2,2.8" stroke="#a3333a" stroke-width="0.9"/>');
    if(jingasa){
      P.push('<path d="M50,20.5 L82,45.5 Q50,38.5 18,45.5 Z" fill="#6b5530" stroke="#473a1c" stroke-width="1.2"/>');
      P.push('<path d="M50,20.5 L66,33 Q58,30.5 50,30.2 Q42,30.5 34,33 Z" fill="#ffffff14"/>');
      P.push('<circle cx="50" cy="36.5" r="3" fill="url(#'+uid+'gd)"/>');
    }else{
      // 鉢（筋兜）
      P.push('<path d="M30.5,38.5 Q29,13 50,11 Q71,13 69.5,38.5 L66,36 Q50,29.5 34,36 Z" fill="url(#'+uid+'mt)" stroke="#00000055" stroke-width="0.8"/>');
      P.push('<path d="M40,34.5 Q39.4,18 50,13 M60,34.5 Q60.6,18 50,13 M50,11.5 V29.5" stroke="#ffffff14" stroke-width="1.6" fill="none"/>');
      for(let x=36;x<=64;x+=5.6) P.push('<circle cx="'+x+'" cy="33.6" r="0.75" fill="'+gold+'" opacity="0.9"/>');
      // 眉庇
      P.push('<path d="M29,41 Q50,33.5 71,41 L69,46.5 Q50,38.5 31,46.5 Z" fill="url(#'+uid+'mt)" stroke="#00000050" stroke-width="0.8"/>');
      P.push('<path d="M31,46.2 Q50,38.3 69,46.2" stroke="'+gold+'" stroke-width="1.2" fill="none"/>');
      // 吹返し
      P.push('<path d="M31,36.5 Q19.5,38.5 17.5,49 Q25,51.5 32.5,46.5 Z" fill="url(#'+uid+'pl)" stroke="#00000044" stroke-width="0.7"/>');
      P.push('<path d="M31,36.5 Q19.5,38.5 17.5,49" stroke="'+gold+'" stroke-width="1.1" fill="none"/><circle cx="24.6" cy="44" r="1" fill="url(#'+uid+'gd)"/>');
      P.push('<path d="M69,36.5 Q80.5,38.5 82.5,49 Q75,51.5 67.5,46.5 Z" fill="url(#'+uid+'pl)" stroke="#00000044" stroke-width="0.7"/>');
      P.push('<path d="M69,36.5 Q80.5,38.5 82.5,49" stroke="'+gold+'" stroke-width="1.1" fill="none"/><circle cx="75.4" cy="44" r="1" fill="url(#'+uid+'gd)"/>');
      // 前立
      P.push(crestSVG(o.crest || pick(['kuwagata','crescent','kuwagata','horns','sun'],7), uid));
    }
  }else if(head==='hood'){
    P.push('<path d="M30.5,70 Q24.5,28 50,23.5 Q75.5,28 69.5,70 L62.5,57 Q63,43.5 50,43.4 Q37,43.5 37.5,57 Z" fill="#ece7da" stroke="#c6bca6" stroke-width="1.2"/>');
    P.push('<path d="M36,34 Q50,26.5 64,34 M33.5,46 Q50,38 66.5,46 M32,58 Q40,52 37.8,57.5" stroke="#c6bca6" stroke-width="1.2" fill="none"/>');
  }else if(head==='shinobiHood'){
    P.push('<path d="M36,55 Q50,60.5 64,55 L64,74 Q50,82 36,74 Z" fill="#1f1f26"/>');
    P.push('<path d="M30.5,68 Q26.5,23 50,20.5 Q73.5,23 69.5,68 L63,56 Q63,42 50,42 Q37,42 37,56 Z" fill="#2a2a33"/>');
    P.push('<path d="M34,38 Q50,30 66,38 M32.5,50 Q50,42 67.5,50" stroke="#00000055" stroke-width="1.2" fill="none"/>');
    P.push('<path d="M38,57.5 Q50,62.5 62,57.5" stroke="#00000066" stroke-width="1" fill="none"/>');
  }else if(head==='bowl'){
    P.push('<path d="M31.5,43 Q31.5,23.5 50,23.5 Q68.5,23.5 68.5,43 Z" fill="#a83326" stroke="#6e1f17" stroke-width="1.4"/>');
    P.push('<path d="M36,30 Q42,25.5 50,25.4" stroke="#ffffff22" stroke-width="2" fill="none"/>');
    P.push('<path d="M31.5,43 H68.5 L66,47.5 H34 Z" fill="#6e1f17"/>');
  }else if(head==='tallhat'){
    P.push('<path d="M41.5,45 L44.8,7.5 Q50,4.5 56.5,8.5 L59.8,45 Z" fill="url(#'+uid+'mt)" stroke="#00000055" stroke-width="0.8"/>');
    P.push('<path d="M45.5,40 L47.5,12" stroke="#ffffff16" stroke-width="1.8"/>');
    P.push('<circle cx="51" cy="15.5" r="3.2" fill="#c43a3a"/>');
  }else if(head==='wild'){
    P.push('<path d="M32,50 Q23,36 29,20 L38,31 L36,16 L46,27 L50,12 L54,27 L64,16 L62,31 L71,20 Q77,36 68,50 Q60,37 50,37 Q40,37 32,50 Z" fill="'+hairC+'"/>');
    P.push('<path d="M36,24 L40,30 M60,22 L57,29" stroke="#ffffff12" stroke-width="1.4"/>');
    P.push('<rect x="33" y="41.5" width="34" height="5" rx="2" fill="#a83326"/><path d="M33,44 H67" stroke="#00000033" stroke-width="0.8"/>');
  }else if(head==='band'){
    P.push('<path d="M32,48 Q31,27 50,25 Q69,27 68,48 Q60,37.5 50,37.5 Q40,37.5 32,48 Z" fill="'+hairC+'"/>');
    P.push('<rect x="32" y="42.5" width="36" height="5.5" rx="2" fill="#ece7da"/><path d="M32,45.2 H68" stroke="#00000018" stroke-width="0.8"/>');
    P.push('<path d="M68,44 l6,-2.4 M68,46.5 l6,1.6" stroke="#ece7da" stroke-width="2"/>');
  }else if(head==='monk'){
    P.push('<ellipse cx="46" cy="34" rx="9" ry="5" fill="#ffffff12"/>');
  }else if(head==='eboshi'){
    P.push('<path d="M40.5,41 L38.5,12.5 Q46,4.5 55,8.5 L57.5,28 L53.5,41 Z" fill="#16120e" stroke="#00000088" stroke-width="0.8"/>');
    P.push('<path d="M42.5,36 L41.5,15" stroke="#ffffff10" stroke-width="1.6"/>');
    P.push('<path d="M40.5,41 Q42,49 45,55 M55,41 Q54,49 52.5,55" stroke="#16120e" stroke-width="0.9" opacity="0.7"/>');
  }else if(head==='femaleHair'){
    P.push('<path d="M30.5,48 Q28.5,22 50,20.5 Q71.5,22 69.5,48 Q61,34.5 50,34.5 Q39,34.5 30.5,48 Z" fill="'+hairC+'"/>');
    P.push('<path d="M36,29 Q50,23.5 64,29" stroke="#ffffff1c" stroke-width="2.2" fill="none"/>');
    P.push('<path d="M66,30 L78,21.5" stroke="url(#'+uid+'gd)" stroke-width="1.7"/><circle cx="78" cy="21.5" r="1.9" fill="url(#'+uid+'gd)"/><path d="M78,23.5 l1.2,4.2" stroke="url(#'+uid+'gd)" stroke-width="1.1"/>');
  }else if(head==='femaleBand'){
    P.push('<path d="M30.5,48 Q28.5,22 50,20.5 Q71.5,22 69.5,48 Q61,34.5 50,34.5 Q39,34.5 30.5,48 Z" fill="'+hairC+'"/>');
    P.push('<rect x="32" y="42" width="36" height="5" rx="2" fill="#ece7da"/>');
    P.push('<path d="M68,43.5 l6,-2.2 M68,45.8 l6,1.6" stroke="#ece7da" stroke-width="1.8"/>');
  }else if(head==='pageHair'){
    P.push('<path d="M32,50 Q30,27 50,25 Q70,27 68,50 Q60,39 50,39 Q40,39 32,50 Z" fill="'+hairC+'"/>');
    P.push('<path d="M37,31 Q50,26 63,31" stroke="#ffffff14" stroke-width="2" fill="none"/>');
  }
  // ---- 装飾品 ----
  if(o.beads){
    let bs='';
    for(let i=0;i<=7;i++){
      const t=i/7, x=37+26*t, y=84+Math.sin(Math.PI*t)*11;
      bs+='<circle cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="2" fill="#6e5a3a" stroke="#473a22" stroke-width="0.5"/>';
    }
    P.push(bs);
  }
  if(o.crossPend) P.push('<path d="M50,90 v13 M44.5,95 h11" stroke="url(#'+uid+'gd)" stroke-width="2.8"/><path d="M50,90 v13 M44.5,95 h11" stroke="#00000044" stroke-width="0.8"/>');
  if(o.extra==='gunbai') P.push('<g transform="translate(81,101) rotate(-18)"><ellipse cx="0" cy="-9" rx="9.5" ry="11.5" fill="#8a5a2a" stroke="#5e3d1c" stroke-width="1.3"/><ellipse cx="0" cy="-9" rx="6" ry="8" fill="none" stroke="#5e3d1c" stroke-width="0.8"/><rect x="-1.5" y="1.5" width="3" height="13" rx="1.4" fill="#5e3d1c"/></g>');
  if(o.extra==='sword') P.push('<path d="M70,87 L89,63" stroke="#c9ccd8" stroke-width="3"/><path d="M70,87 L89,63" stroke="#ffffff44" stroke-width="1"/><circle cx="70" cy="87" r="3.2" fill="url(#'+uid+'gd)"/>');
  // ---- 仕上げ ----
  P.push('<rect x="2" y="56" width="96" height="62" rx="7" fill="url(#'+uid+'vg)"/>');
  P.push('<rect x="2" y="2" width="96" height="116" rx="7" fill="none" stroke="'+(TIER[tier].color)+'" stroke-width="2.4"/>');
  P.push('<rect x="3.6" y="3.6" width="92.8" height="112.8" rx="5.8" fill="none" stroke="#00000066" stroke-width="0.8"/>');
  if(tier===5) P.push('<rect x="6" y="6" width="88" height="108" rx="5" fill="none" stroke="'+gold+'" stroke-width="1" opacity="0.65"/>');
  P.push('</svg>');
  return P.join('');
}
function crestSVG(kind, uid){
  const gd='url(#'+uid+'gd)', dk='#8a6d2c';
  switch(kind){
    case 'crescent':
      return '<path d="M27.5,21.5 A24.5,24.5 0 0 1 72.5,21.5 A30,30 0 0 0 27.5,21.5 Z" fill="'+gd+'" stroke="'+dk+'" stroke-width="0.8"/>';
    case 'sun':
      return '<circle cx="50" cy="17" r="8.2" fill="'+gd+'" stroke="'+dk+'" stroke-width="0.8"/><circle cx="50" cy="17" r="10.8" fill="none" stroke="'+dk+'" stroke-width="0.9" opacity="0.55"/>';
    case 'rays':
      return '<g fill="'+gd+'" stroke="'+dk+'" stroke-width="0.5">'+[-42,-21,0,21,42].map(a=>{
        const r=a*Math.PI/180, x=50+Math.sin(r)*19, y=29-Math.cos(r)*19;
        const px=50+Math.sin(r+0.18)*5.5, py=29-Math.cos(r+0.18)*5.5, qx=50+Math.sin(r-0.18)*5.5, qy=29-Math.cos(r-0.18)*5.5;
        return '<path d="M'+qx.toFixed(1)+','+qy.toFixed(1)+' L'+x.toFixed(1)+','+y.toFixed(1)+' L'+px.toFixed(1)+','+py.toFixed(1)+' Z"/>';
      }).join('')+'</g><circle cx="50" cy="29" r="3.6" fill="'+gd+'" stroke="'+dk+'" stroke-width="0.6"/>';
    case 'horns':
      return '<path d="M42.5,35 C30,27 26,13 33,2.5 C32.5,14 37,24 46,32 Z" fill="#7a6234" stroke="#4e3d1c" stroke-width="0.7"/>'
        +'<path d="M57.5,35 C70,27 74,13 67,2.5 C67.5,14 63,24 54,32 Z" fill="#7a6234" stroke="#4e3d1c" stroke-width="0.7"/>';
    case 'antlers':
      return '<g stroke="'+gd+'" stroke-width="2.8" fill="none" stroke-linecap="round"><path d="M43,34 C37,25 36.5,13 41,4"/><path d="M39.5,19 L31.5,12"/><path d="M57,34 C63,25 63.5,13 59,4"/><path d="M60.5,19 L68.5,12"/></g>';
    case 'antlersBig':
      return '<g stroke="#2b241c" stroke-width="3.4" fill="none" stroke-linecap="round"><path d="M41.5,35 C32,22 32.5,10 38,1"/><path d="M37,20 L27.5,13"/><path d="M38.5,9 L31,3.5"/><path d="M58.5,35 C68,22 67.5,10 62,1"/><path d="M63,20 L72.5,13"/><path d="M61.5,9 L69,3.5"/></g>'
        +'<g stroke="#ffffff18" stroke-width="0.9" fill="none"><path d="M41.5,35 C32,22 32.5,10 38,1"/><path d="M58.5,35 C68,22 67.5,10 62,1"/></g>';
    case 'ai':
      return '<circle cx="50" cy="16.5" r="9.6" fill="'+gd+'" stroke="'+dk+'" stroke-width="0.9"/><text x="50" y="21" text-anchor="middle" font-size="12.5" font-weight="bold" fill="#23232e" font-family="serif">愛</text>';
    case 'fern':
      return '<g stroke="'+gd+'" stroke-width="2.5" fill="none" stroke-linecap="round"><path d="M50,33 C42,22 35,18 31,21 C29.5,23 31,25.5 33.5,25"/><path d="M50,33 C50,18 50,11 50,6.5"/><path d="M50,33 C58,22 65,18 69,21 C70.5,23 69,25.5 66.5,25"/></g>';
    case 'cross':
      return '<circle cx="50" cy="17.5" r="9" fill="none" stroke="'+gd+'" stroke-width="2.2"/><path d="M50,9.5 V25.5 M42,17.5 H58" stroke="'+gd+'" stroke-width="2.4"/>';
    case 'kuwagata': default:
      return '<path d="M45.2,35.5 C38.5,27 37.5,14.5 42.8,3.5 L45.8,4.8 C41.6,14.8 43,25.5 49,34 Z" fill="'+gd+'" stroke="'+dk+'" stroke-width="0.6"/>'
        +'<path d="M54.8,35.5 C61.5,27 62.5,14.5 57.2,3.5 L54.2,4.8 C58.4,14.8 57,25.5 51,34 Z" fill="'+gd+'" stroke="'+dk+'" stroke-width="0.6"/>'
        +'<rect x="46" y="29.5" width="8" height="6.6" rx="1.4" fill="'+gd+'" stroke="'+dk+'" stroke-width="0.6"/>';
  }
}
function lordBio(name){
  return (typeof LORD_BIO!=='undefined' && LORD_BIO[name]) || '戦国の世を生きた武士。詳しい記録は多く残っていない。';
}
// ---------- 似顔絵の画像差し替えレイヤー ----------
// portraits/<武将名>.webp / .png / .jpg があればそれを表示、無ければ生成SVGのまま
const PORT_EXTS=['webp','png','jpg'];
const portImgCache={}; // 武将名 -> 見つかった拡張子 / null(全滅)
function portraitHTML(lord, castle, size){
  size=size||96;
  const svg=portraitSVG(lord,castle,size);
  const wrap='<span class="pwrap" style="width:'+size+'px;height:'+Math.round(size*1.2)+'px">';
  const known=portImgCache[lord.n];
  if(known===null) return wrap+svg+'</span>';
  const start=known?PORT_EXTS.indexOf(known):0;
  const tierC=TIER[lord.t||1].color;
  return wrap+svg
    +'<img class="pimg'+(known?' show':'')+'" alt="" style="border-color:'+tierC+'" data-n="'+lord.n+'" data-i="'+start+'"'
    +' src="portraits/'+encodeURIComponent(lord.n)+'.'+PORT_EXTS[start]+'"'
    +' onload="window.__pOk(this)" onerror="window.__pErr(this)">'
    +'</span>';
}
window.__pOk=function(img){
  portImgCache[img.getAttribute('data-n')]=PORT_EXTS[+img.getAttribute('data-i')];
  img.classList.add('show');
};
window.__pErr=function(img){
  const n=img.getAttribute('data-n');
  let i=+img.getAttribute('data-i')+1;
  if(i>=PORT_EXTS.length){ portImgCache[n]=null; img.remove(); return; }
  img.setAttribute('data-i',i);
  img.src='portraits/'+encodeURIComponent(n)+'.'+PORT_EXTS[i];
};

// ---------- 出陣画面（ランク選択） ----------
function openPrep(castle){
  const ch=challengerFor(castle);
  if(!ch) return;
  const l=ch.l, u=unitOf(castle,l), key=lordKey(castle.id,ch.i);
  const curTr=trainOf(key);
  const lv=playerLevel();
  let html='<div class="prep"><h3>出陣 — '+castle.name+'</h3>';
  html+='<div class="prep-enemy tier-'+l.t+'">'
    +'<div class="prep-port">'+portraitHTML(l, castle, 68)+'</div>'
    +'<div class="prep-info">'
    +'<div class="b-tier" style="color:'+TIER[l.t].color+'">'+TIER[l.t].label+(ch.retrain?'（鍛え直し）':'')+'</div>'
    +'<div class="prep-name">'+l.n+'</div>'
    +'<div class="prep-unit">'+UNITS[u].icon+' '+UNITS[u].name+' を率いる　<span class="muted">武'+l.b+' 知'+l.i+' 統'+l.l+'</span></div>'
    +(ch.retrain?'<div class="prep-cur">現在の練度: '+(curTr?TRAIN_MARK[curTr]+TRAIN_NAME[curTr]:'通常')+'</div>':'')
    +'</div></div>';
  html+='<div class="prep-ranks">';
  RANKS.forEach(r=>{
    const unlocked = lv>=r.lv;
    const pointless = r.train<=curTr && (ch.retrain || isOwned(castle.id,ch.i));
    const epow=Math.round(enemyPow(l)*r.mult);
    let reward;
    if(ch.retrain) reward = r.train>curTr ? '練度'+TRAIN_MARK[r.train]+TRAIN_NAME[r.train]+'に昇格'+(r.n>1?'＋恩賞:能力+'+(r.n-1):'') : '練度の向上なし';
    else reward = r.n===1 ? '勝てば仲間に' : TRAIN_MARK[r.train]+TRAIN_NAME[r.train]+'状態で仲間に＋恩賞:能力+'+(r.n-1);
    const dis = (!unlocked||pointless)?' disabled':'';
    const note = !unlocked ? '殿Lv'+r.lv+'で解放（現在Lv'+lv+'）' : reward;
    html+='<button class="btn rank-btn rank-'+r.n+'"'+dis+' data-rank="'+r.n+'">'
      +'<span class="rk-head">ランク'+r.label+'　'+rankArmyName(u,r.n)+'</span>'
      +'<span class="rk-sub">敵戦力 '+epow+'　｜　'+note+'</span></button>';
  });
  html+='</div><button class="btn" id="prep-cancel">やめておく</button></div>';
  showModal(html);
  document.querySelectorAll('.rank-btn:not([disabled])').forEach(b=>{
    b.onclick=()=>startBattle(castle, ch, +b.getAttribute('data-rank'));
  });
  document.getElementById('prep-cancel').onclick=hideOverlay;
}

// ---------- 戦闘 ----------
let battle=null;
function rnd(a,b){ return a+Math.random()*(b-a); }
function critChance(){ return 5+state.stats.un*0.3; }
function battleLog(s){
  if(!battle) return;
  battle.log.unshift(s);
  if(battle.log.length>7) battle.log.length=7;
  const el=document.getElementById('b-log');
  if(el) el.innerHTML=battle.log.map((x,i)=>'<div class="'+(i===0?'new':'')+'">'+x+'</div>').join('');
}
// --- 合戦ステージ演出ヘルパー ---
function stageEl(){ return document.getElementById('bs-fx'); }
function stageW(){ const st=document.getElementById('b-stage'); return st? st.offsetWidth : 480; }
function fxSpawn(cls, html, xPct, yPct, life, vars){
  const box=stageEl(); if(!box) return null;
  const e=document.createElement('div');
  e.className='fx '+cls;
  e.innerHTML=html;
  e.style.left=xPct+'%'; e.style.top=yPct+'%';
  if(vars) for(const k in vars) e.style.setProperty(k, vars[k]);
  box.appendChild(e);
  setTimeout(()=>e.remove(), life||800);
  return e;
}
function fxDmg(side, amount, opts){
  opts=opts||{};
  const x = side==='enemy' ? 62+Math.random()*16 : 12+Math.random()*16;
  const cls = 'fx-dmg'+(opts.crit?' crit':'')+(opts.heal?' heal':'');
  fxSpawn(cls, (opts.heal?'+':'−')+Math.round(amount)+(opts.crit?'！':''), x, 36+Math.random()*14, 980);
}
function fxText(side, text, cls){
  const x = side==='enemy' ? 58 : 10;
  fxSpawn('fx-text '+(cls||''), text, x, 10, 1150);
}
function fxProjectiles(from, glyph, n, opts){
  opts=opts||{};
  const dist=(stageW()*0.52)*(from==='player'?1:-1);
  for(let i=0;i<n;i++){
    setTimeout(()=>{
      if(!stageEl()) return;
      const x = from==='player' ? 14+Math.random()*10 : 64+Math.random()*10;
      const y = 40+Math.random()*22;
      const e=fxSpawn('fx-fly '+(opts.cls||''), glyph, x, y, opts.life||720, {'--dx':dist+'px','--arc':(opts.arc||0)+'px'});
      if(e && from==='enemy') e.classList.add('flip');
    }, i*(opts.gap||70));
  }
}
function fxFlash(side, n){
  for(let i=0;i<n;i++){
    setTimeout(()=>{
      const x = side==='enemy' ? 60+Math.random()*18 : 12+Math.random()*18;
      fxSpawn('fx-flash','✸', x, 44+Math.random()*16, 340);
      fxSpawn('fx-smoke','', side==='enemy'? x-3 : x+3, 40+Math.random()*16, 850);
    }, i*110);
  }
}
function fxBurst(side, big){
  const x = side==='enemy' ? 66 : 16;
  fxSpawn('fx-burst'+(big?' big':''),'💥', x+Math.random()*8, 42+Math.random()*12, big?760:540);
}
function armyAnim(side, cls, dur){
  const el=document.getElementById(side==='enemy'?'bs-enemy':'bs-player');
  if(!el) return;
  el.classList.add(cls);
  setTimeout(()=>el.classList.remove(cls), dur||750);
}
function setShield(on){
  const old=document.getElementById('bs-shield');
  if(old) old.remove();
  if(on){
    const box=stageEl(); if(!box) return;
    const e=document.createElement('div');
    e.className='fx fx-shield'; e.id='bs-shield'; e.textContent='🛡';
    e.style.left='30%'; e.style.top='38%';
    box.appendChild(e);
  }
}
function setStun(on){
  const old=document.getElementById('bs-stun');
  if(old) old.remove();
  if(on){
    const box=stageEl(); if(!box) return;
    const e=document.createElement('div');
    e.className='fx fx-stun'; e.id='bs-stun'; e.textContent='💫';
    e.style.left='72%'; e.style.top='10%';
    box.appendChild(e);
  }
}

function startBattle(castle, ch, rank){
  const l=ch.l, u=unitOf(castle,l);
  const rk=RANKS[rank-1];
  const epow=enemyPow(l)*rk.mult;
  const pmax=playerMaxHP();
  battle={
    castle, lord:l, idx:ch.i, retrain:ch.retrain, unitKey:u, rank,
    ppow:playerPow(), epow,
    php:pmax, pmax,
    ehp:Math.round(100+epow*0.55), emax:Math.round(100+epow*0.55),
    buff:0, stun:false, guard:false, busy:true,
    eTurn:0, loaded:false, heiki:0, tele:null,
    over:false, log:[],
  };
  buildBattleShell();
  showOverlay();
  battleLog('【'+castle.name+'】'+rankArmyName(u,rank)+'が布陣している！');
  battleLog(TIER[l.t].label+'・'+l.n+'が'+UNITS[u].name+'を率いて立ちはだかる！');
  if(l.t===5) battleLog('…尋常ならざる気配。レア大名との一戦！');
  // 開戦演出（弓隊は先制射撃）
  setTimeout(()=>{
    const b=battle; if(!b||b.over) return;
    if(b.unitKey==='yumi'){
      fxProjectiles('enemy','',7,{cls:'arrow',arc:-42,gap:60,life:700});
      setTimeout(()=>{
        if(!battle||battle.over) return;
        const d=Math.max(4,Math.round(b.epow*0.15));
        b.php-=d;
        armyAnim('player','shake',420);
        fxDmg('player',d);
        battleLog('🏹 開戦と同時に矢の雨が降り注ぐ！ 先制で'+d+'の損害！');
        b.busy=false; updateBattleUI();
      },640);
    }else{
      b.busy=false; updateBattleUI();
    }
  },480);
}
// バトル画面の構築（初回のみ。以後は updateBattleUI で部分更新）
function buildBattleShell(){
  const b=battle;
  const l=b.lord, u=UNITS[b.unitKey];
  const party=topAllies();
  const eCount=Math.min(8,3+b.rank*2);
  let units='';
  for(let i=0;i<eCount;i++) units+='<span class="bs-unit" style="animation-delay:'+(i*0.18)+'s">'+u.icon+'</span>';
  let pUnits='<span class="bs-unit tono" style="animation-delay:0.05s">🚩</span>';
  party.slice(0,5).forEach((a,i)=>{
    pUnits+='<span class="bs-unit" style="animation-delay:'+((i+1)*0.16)+'s">'+UNITS[unitOf(a.castle,a.lord)].icon+'</span>';
  });
  let html='<div class="battle">';
  html+='<div class="b-rankband rk'+b.rank+'">'+rankArmyName(b.unitKey,b.rank)+'　<span style="color:'+TIER[l.t].color+'">'+TIER[l.t].label+'・'+l.n+'</span></div>';
  html+='<div class="b-stage" id="b-stage">'
    +'<div class="bs-ground"></div>'
    +'<div class="bs-army player" id="bs-player">'+pUnits+'</div>'
    +'<div class="bs-army enemy" id="bs-enemy">'+units+'</div>'
    +'<div class="bs-general" id="bs-general">'+portraitHTML(l,b.castle,50)+'</div>'
    +'<div id="bs-fx"></div>'
    +'</div>';
  html+='<div class="b-bars">'
    +'<div class="b-barrow"><span class="b-side">敵</span><div class="b-barwrap" id="b-ehp-wrap">'+hpBar(b.ehp,b.emax,'enemy')+'</div></div>'
    +'<div class="b-barrow"><span class="b-side">殿</span><div class="b-barwrap" id="b-php-wrap">'+hpBar(b.php,b.pmax,'player')+'</div></div>'
    +'</div>';
  html+='<div class="b-log" id="b-log"></div>';
  html+='<div class="b-pname">'+(party.length?'出陣: '+party.map(a=>a.lord.n+(trainOf(a.key)?TRAIN_MARK[trainOf(a.key)]:'')).join('、'):'出陣: 殿ひとり…')+'　<span class="b-party">戦力 '+Math.round(b.ppow)+'</span></div>';
  html+='<div id="b-bottom"><div class="b-actions">'
    +'<button class="btn atk" id="b-atk" disabled>⚔ 突撃</button>'
    +'<button class="btn str" id="b-str" disabled>📜 計略</button>'
    +'<button class="btn rly" id="b-rly" disabled>🚩 鼓舞</button>'
    +'<button class="btn def" id="b-def" disabled>🛡 防御</button>'
    +'<button class="btn run" id="b-run">🏃 退却</button>'
    +'</div></div>';
  html+='</div>';
  document.getElementById('modal').innerHTML=html;
  document.getElementById('b-atk').onclick=()=>playerAct('atk');
  document.getElementById('b-str').onclick=()=>playerAct('str');
  document.getElementById('b-rly').onclick=()=>playerAct('rly');
  document.getElementById('b-def').onclick=()=>playerAct('def');
  document.getElementById('b-run').onclick=()=>{
    if(!battle||battle.over) return;
    battle.over='lose'; battleLog('兵を退いた…'); showBattleResult();
  };
}
function updateBattleUI(){
  const b=battle; if(!b) return;
  const ew=document.getElementById('b-ehp-wrap'), pw=document.getElementById('b-php-wrap');
  if(ew) ew.innerHTML=hpBar(b.ehp,b.emax,'enemy');
  if(pw) pw.innerHTML=hpBar(b.php,b.pmax,'player');
  ['b-atk','b-str','b-rly','b-def'].forEach(id=>{
    const e=document.getElementById(id);
    if(e) e.disabled=!!b.busy||!!b.over;
  });
  const atk=document.getElementById('b-atk');
  if(atk) atk.textContent='⚔ 突撃'+(b.buff?'（鼓舞×'+b.buff+'）':'');
}
function showBattleResult(){
  const b=battle; if(!b) return;
  b.busy=true; updateBattleUI();
  const bottom=document.getElementById('b-bottom');
  if(!bottom) return;
  if(b.over==='win'){
    const en=document.getElementById('bs-enemy');
    if(en) en.classList.add('dead');
    const gp=document.getElementById('bs-general');
    if(gp) gp.classList.add('beaten');
    const tr=RANKS[b.rank-1].train;
    bottom.innerHTML='<div class="b-result win">🎉 勝利！</div>'
      +'<div class="b-recruit">'+portraitHTML(b.lord,b.castle,84)
      +'<div class="b-recruit-info">'
      +'<div class="b-recruit-name"><span style="color:'+TIER[b.lord.t].color+'">'+TIER[b.lord.t].label+'</span>　'+b.lord.n+(tr?'<span class="train">　'+TRAIN_MARK[tr]+TRAIN_NAME[tr]+'</span>':'')+'</div>'
      +'<div class="b-recruit-msg">'+(b.retrain?'部隊が鍛え直された！':'が仲間になった！')+'</div>'
      +'<p class="b-bio">'+lordBio(b.lord.n)+'</p>'
      +'</div></div>'
      +'<button class="btn primary" id="b-close">万歳！</button>';
  }else{
    const pl=document.getElementById('bs-player');
    if(pl) pl.classList.add('dead');
    bottom.innerHTML='<div class="b-result lose">敗北… 兵を退いた。鍛えて出直そう。</div>'
      +'<button class="btn" id="b-close">退却する</button>';
  }
  document.getElementById('b-close').onclick=()=>{
    hideOverlay();
    if(b.over==='win') afterWin(b);
    battle=null;
    updateNodeStates(); renderPanel(); updateHud();
  };
}
function hpBar(v,max,cls){
  const pct=Math.max(0,v/max*100);
  return '<div class="hpbar '+cls+'"><div class="hpfill" style="width:'+pct+'%"></div><span>'+Math.max(0,Math.round(v))+' / '+Math.round(max)+'</span></div>';
}
function playerAct(kind){
  const b=battle;
  if(!b||b.over||b.busy) return;
  b.busy=true; updateBattleUI();
  // 行動アニメーション
  let impact=420;
  if(kind==='atk'){
    armyAnim('player','lunge',700);
    setTimeout(()=>fxProjectiles('player','✦',3,{gap:60,life:480}),160);
  }else if(kind==='str'){
    fxProjectiles('player','📜',1,{life:640,arc:-32});
    impact=560;
  }else if(kind==='rly'){
    armyAnim('player','cheer',650);
    for(let i=0;i<5;i++) setTimeout(()=>fxSpawn('fx-spark','✨',10+Math.random()*24,28+Math.random()*30,720),i*90);
    impact=320;
  }else if(kind==='def'){
    setShield(true);
    impact=220;
  }
  setTimeout(()=>{
    if(!battle||battle.over) return;
    resolvePlayerAct(kind);
  }, impact);
}
function resolvePlayerAct(kind){
  const b=battle, l=b.lord;
  if(kind==='atk'){
    if(b.unitKey==='shinobi' && !b.stun && Math.random()<0.25){
      b.buff=0;
      fxSpawn('fx-smoke big','',64,42,850);
      fxText('enemy','ミス！','miss');
      battleLog('🥷 煙玉！ 突撃は空を切った…');
    }else{
      let dmg=Math.max(6,(b.ppow*0.34-b.epow*0.08)*rnd(0.85,1.25));
      dmg*=(1+0.35*b.buff); b.buff=0;
      let crit=false;
      if(Math.random()*100<critChance()){dmg*=1.7;crit=true;battleLog('⚡ 会心の一撃！');}
      b.ehp-=dmg;
      armyAnim('enemy','shake',420);
      fxBurst('enemy',crit);
      fxDmg('enemy',dmg,{crit:crit});
      battleLog('突撃！ '+l.n+'軍に '+Math.round(dmg)+' の損害。');
    }
  }else if(kind==='str'){
    const p=Math.max(15,Math.min(90, 45+(state.stats.chi*1.1-l.i*0.8)));
    if(Math.random()*100<p){
      const dmg=b.ppow*0.55*rnd(0.9,1.2);
      b.ehp-=dmg;
      armyAnim('enemy','shake',500);
      fxBurst('enemy',true);
      fxDmg('enemy',dmg);
      battleLog('📜 計略成功！ '+Math.round(dmg)+' の大損害！');
      if(Math.random()<0.35){b.stun=true;setStun(true);battleLog(l.n+'軍は混乱している！');}
    }else{
      fxText('enemy','見破られた','miss');
      battleLog('計略は見破られた…！');
    }
  }else if(kind==='rly'){
    const heal=Math.min(b.pmax-b.php, b.pmax*0.15+state.stats.tou*0.6);
    b.php+=heal;
    if(b.buff<2)b.buff++;
    fxDmg('player',heal,{heal:true});
    battleLog('🚩 鼓舞！ 兵気回復 '+Math.round(heal)+'、次の突撃が強化された。');
  }else if(kind==='def'){
    b.guard=true;
    const heal=Math.min(b.pmax-b.php, b.pmax*0.06);
    b.php+=heal;
    battleLog('🛡 防御の構え！（次に受ける攻撃を大きく軽減）');
  }
  updateBattleUI();
  if(b.ehp<=0){ b.over='win'; setTimeout(showBattleResult,650); return; }
  setTimeout(runEnemyTurn, 500);
}
// 敵ターン（演出→着弾→判定）
function runEnemyTurn(){
  const b=battle;
  if(!b||b.over) return;
  if(b.stun){
    b.stun=false; setStun(false);
    fxText('enemy','混乱中…','miss');
    battleLog(b.lord.n+'軍は混乱して動けない！');
    b.busy=false; updateBattleUI();
    return;
  }
  const plan=enemyPlan(b);
  enemyAnim(b, plan);
  setTimeout(()=>{
    if(!battle||battle.over) return;
    if(plan.skip){
      if(plan.msg) battleLog(plan.msg);
      b.busy=false; updateBattleUI();
      return;
    }
    const res=enemyApply(b, plan, battleLog);
    armyAnim('player', plan.kind==='kokuzushi'?'bigshake':'shake', 500);
    fxDmg('player',res.dmg);
    if(res.guarded) setShield(false);
    if(res.extra){
      setTimeout(()=>{
        if(!battle||battle.over) return;
        fxProjectiles('enemy','✦',1,{life:420});
        setTimeout(()=>{ if(battle&&!battle.over){ fxDmg('player',res.extra); updateBattleUI(); } },300);
      },220);
    }
    updateBattleUI();
    if(b.php<=0){ b.over='lose'; setTimeout(showBattleResult,600); return; }
    b.busy=false; updateBattleUI();
  }, plan.animT||560);
}
// 部隊別の演出
function enemyAnim(b, plan){
  switch(plan.kind){
    case 'tele-charge':
      fxText('enemy','⚠ 突撃の構え！','warn'); armyAnim('enemy','stomp',650); break;
    case 'charge':
      armyAnim('enemy','charge',800);
      for(let i=0;i<4;i++) setTimeout(()=>fxSpawn('fx-smoke','',58-i*9,56,750),i*120);
      break;
    case 'reload':
      fxText('enemy','装填中…','info');
      fxSpawn('fx-smoke','',66,38,850); fxSpawn('fx-smoke','',74,42,850);
      break;
    case 'volley': case 'volley3':
      fxFlash('enemy', plan.kind==='volley3'?3:2);
      fxProjectiles('enemy','',plan.kind==='volley3'?6:4,{cls:'bullet',gap:55,life:430});
      break;
    case 'arrows':
      fxProjectiles('enemy','',7,{cls:'arrow',gap:60,arc:-42,life:700}); break;
    case 'bomb':
      fxProjectiles('enemy','',1,{cls:'bombball',arc:-58,life:700});
      setTimeout(()=>{ if(stageEl()) fxBurst('player',true); },560);
      break;
    case 'shuriken':
      fxProjectiles('enemy','✦',3,{gap:90,life:480}); break;
    case 'load':
      fxText('enemy','💣 弾込め…','warn'); fxSpawn('fx-flash','✸',80,54,420); break;
    case 'aim':
      fxText('enemy','狙っている…','warn');
      fxProjectiles('enemy','',2,{cls:'bullet',gap:90,life:430});
      break;
    case 'kokuzushi':
      armyAnim('enemy','stomp',500);
      fxProjectiles('enemy','',1,{cls:'cannonball',arc:-70,life:840});
      setTimeout(()=>{ if(stageEl()){ fxBurst('player',true); fxBurst('player',true); } },660);
      break;
    case 'watch':
      fxText('enemy','様子見…','info'); break;
    case 'thrust':
      armyAnim('enemy','lungeL',620);
      setTimeout(()=>fxProjectiles('enemy','✦',2,{gap:70,life:420}),140);
      break;
    default:
      armyAnim('enemy','lungeL',560);
      setTimeout(()=>fxProjectiles('enemy','✦',2,{gap:70,life:420}),140);
  }
}
// 部隊別の敵行動計画（カウンタを進め、行動内容を返す。実戦・シミュレータ共用）
function enemyPlan(b){
  const u=b.unitKey;
  b.eTurn++;
  if(u==='kiba'){
    if(b.tele==='charge'){ b.tele=null; return {kind:'charge', mult:2.0, pre:'🐎 騎馬突撃！！ ', animT:800}; }
    if(b.eTurn%3===2){ b.tele='charge'; return {skip:true, kind:'tele-charge', msg:'🐎 騎馬隊が突撃の構えを見せている…！（防御の好機）', animT:700}; }
    return {kind:'attack', mult:0.9, pre:''};
  }
  if(u==='teppo'){
    if(b.rank>=3) return {kind:'volley3', mult:1.5, pre:'🔫 三段撃ち！装填の隙がない！ '};
    if(b.loaded){ b.loaded=false; return {kind:'volley', mult:1.7, pre:'🔫 鉄砲斉射！ '}; }
    b.loaded=true;
    return {skip:true, kind:'reload', msg:'🔫 鉄砲隊は装填中…今が攻め時！', animT:620};
  }
  if(u==='yumi') return {kind:'arrows', mult:1.0, pre:'🏹 ', animT:680};
  if(u==='suigun'){
    if(Math.random()<0.25) return {kind:'bomb', mult:1.5, pre:'⛵ 焙烙玉が炸裂！ ', burnBuff:true, animT:660};
    return {kind:'attack', mult:1.0, pre:''};
  }
  if(u==='shinobi') return {kind:'shuriken', mult:0.9, pre:''};
  if(u==='heiki'){
    b.heiki++;
    const ph=b.heiki%3;
    if(ph===1) return {skip:true, kind:'load', msg:'💣 兵器隊が「国崩し」に弾込めを始めた…！', animT:700};
    if(ph===2) return {kind:'aim', mult:0.4, pre:'狙いを定めつつ小銃が放たれる…（次は来るぞ、防御！） '};
    return {kind:'kokuzushi', mult:2.6, pre:'💥 国崩し！！ 轟音とともに大筒が火を噴いた！ ', animT:920};
  }
  // yari
  const roll=Math.random();
  if(roll>0.9) return {skip:true, kind:'watch', msg:b.lord.n+'軍は様子を見ている…', animT:520};
  if(roll<0.15) return {kind:'thrust', mult:1.4, pre:'槍衾の突き崩し！ '};
  return {kind:'attack', mult:1.0, pre:''};
}
// 行動計画を適用してダメージ処理（実戦・シミュレータ共用）
function enemyApply(b, plan, logf){
  let dmg=Math.max(5,(b.epow*0.30-b.ppow*0.06)*rnd(0.85,1.25))*plan.mult;
  let msg=plan.pre||'';
  if(plan.burnBuff && b.buff>0){ b.buff=0; msg+='（鼓舞の士気が消し飛んだ）'; }
  let guarded=false;
  if(b.guard){ dmg*=0.45; b.guard=false; guarded=true; msg+='🛡 防御で被害を抑えた！ '; }
  b.php-=dmg;
  logf(msg+b.lord.n+'軍の攻撃！ '+Math.round(dmg)+' の損害。');
  let extra=0;
  if(b.unitKey==='shinobi' && Math.random()<0.2){
    extra=Math.max(3,b.epow*0.12*rnd(0.8,1.2));
    b.php-=extra;
    logf('🥷 手裏剣の追撃！ さらに '+Math.round(extra)+'。');
  }
  return {dmg:dmg, guarded:guarded, extra:extra};
}
function afterWin(b){
  const key=lordKey(b.castle.id,b.idx);
  const newly=!state.allies.includes(key);
  if(newly) state.allies.push(key);
  const tr=RANKS[b.rank-1].train;
  const prev=trainOf(key);
  if(tr>prev) state.train[key]=tr;
  state.wins++;
  if(state.stats.tou<99) state.stats.tou++;
  const lvBefore=playerLevel();
  let onsho='';
  if(b.rank>=2) onsho=gainRandomStats(b.rank-1);
  const n=allyCount();
  if(newly){
    addLog(b.castle.name+'で '+b.lord.n+(tr?'（'+TRAIN_MARK[tr]+TRAIN_NAME[tr]+'）':'')+' を仲間にした（統率+1）');
    toast('⚔ '+b.lord.n+(tr?TRAIN_MARK[tr]:'')+' が仲間になった！（仲間'+n+'人）');
  }else{
    addLog(b.castle.name+'で '+b.lord.n+' の部隊を'+TRAIN_NAME[tr]+'に鍛え直した');
    toast('🎖 '+b.lord.n+'の部隊が'+TRAIN_MARK[tr]+TRAIN_NAME[tr]+'になった！');
  }
  if(onsho) toast('🎁 恩賞: '+onsho);
  if(newly){
    if(n===TIER[2].req) toast('🏯 軍勢拡大！ 各地の城に「武将」クラスが現れるようになった！');
    if(n===TIER[3].req) toast('🏯 軍勢拡大！ 「重臣」クラスが現れるようになった！');
    if(n===TIER[4].req) toast('🏯 軍勢拡大！ 「大名」クラスが現れるようになった！');
    if(n===TIER[5].req) toast('👑 軍勢は二十五人！ 条件を満たせば「レア大名」が現れる…！');
    if(b.lord.t===5) toast('👑 レア大名を配下にした！ 天下に名が轟く！');
    if(b.castle.lords.every((_,i)=>isOwned(b.castle.id,i))) toast('🏯 '+b.castle.name+' を制覇した！');
  }
  const lvAfter=playerLevel();
  if(lvAfter>lvBefore) toast('🌟 殿のLvが '+lvAfter+' に上がった！'+(RANKS.some(r=>r.lv===lvAfter||((lvBefore<r.lv)&&(lvAfter>=r.lv)))?' 新たな部隊ランクに挑めるかも！':''));
  save();
}

// ---------- 名鑑 ----------
function renderZukan(){
  const root=document.getElementById('tab-zukan');
  const regions=[...new Set(CASTLES.map(c=>c.region))];
  let html='<div class="zukan"><div class="z-summary">仲間にした武将 <b>'+allyCount()+'</b> / '+totalLords()+'人　｜　攻略 '+conqueredCount()+'城・制覇 '+masteredCount()+'城 / '+CASTLES.length+'城</div>';
  regions.forEach(rg=>{
    html+='<h3>'+rg+'</h3>';
    CASTLES.filter(c=>c.region===rg).forEach(c=>{
      const owned=c.lords.filter((_,i)=>isOwned(c.id,i)).length;
      html+='<div class="z-castle"><div class="z-cname">🏯 '+c.name+' <span class="z-pref">'+c.pref+'</span>'
        +(owned===c.lords.length?' <span class="gold">制覇</span>':(owned>0?' <span class="blue">攻略中 '+owned+'/'+c.lords.length+'</span>':''))+'</div><div class="z-lords">';
      c.lords.forEach((l,i)=>{
        const own=isOwned(c.id,i);
        const uicon=UNITS[unitOf(c,l)].icon;
        if(own){
          const tr=trainOf(lordKey(c.id,i));
          html+='<span class="z-chip own'+(tr===2?' best':'')+'" data-k="'+c.id+'|'+i+'" style="border-color:'+TIER[l.t].color+'" title="クリックで詳細">'
            +'<span class="z-thumb">'+portraitHTML(l,c,26)+'</span>'
            +'<span class="z-cinfo"><b style="color:'+TIER[l.t].color+'">'+TIER[l.t].label+'</b> '+(tr?'<span class="train">'+TRAIN_MARK[tr]+'</span>':'')+l.n+' '+uicon+'<small>武'+(l.b+TRAIN_BONUS[tr])+' 知'+(l.i+TRAIN_BONUS[tr])+' 統'+(l.l+TRAIN_BONUS[tr])+'</small></span></span>';
        }else{
          const unlocked=allyCount()>=TIER[l.t].req;
          let note = unlocked ? (l.t===5?'条件あり':'挑戦可') : '仲間'+TIER[l.t].req+'人〜';
          html+='<span class="z-chip" title="'+(l.t===5?l.hint:'')+'"><b style="color:'+TIER[l.t].color+'">'+TIER[l.t].label+'</b> ？？？<small>'+note+'</small></span>';
        }
      });
      html+='</div></div>';
    });
  });
  html+='<p class="s-note">仲間にした武将はクリックすると似顔絵と史実の解説が見られる。</p></div>';
  root.innerHTML=html;
  root.querySelectorAll('.z-chip.own').forEach(chip=>{
    chip.onclick=()=>openLordModal(chip.getAttribute('data-k'));
  });
}
// 武将詳細（似顔絵＋史実解説）
function openLordModal(key){
  const r=lordByKey(key);
  if(!r) return;
  const tr=trainOf(key);
  const u=UNITS[unitOf(r.castle,r.lord)];
  const bn=TRAIN_BONUS[tr];
  showModal('<div class="lord-modal">'
    +'<div class="lm-port">'+portraitHTML(r.lord,r.castle,116)+'</div>'
    +'<div class="lm-info">'
    +'<div class="lm-name"><span style="color:'+TIER[r.lord.t].color+'">'+TIER[r.lord.t].label+'</span>　'+r.lord.n+(tr?'<span class="train">　'+TRAIN_MARK[tr]+TRAIN_NAME[tr]+'</span>':'')+'</div>'
    +'<div class="lm-sub">'+r.castle.name+'（'+r.castle.pref+'）　'+u.icon+' '+u.name+'</div>'
    +'<div class="lm-stats">武力 '+(r.lord.b+bn)+'　知力 '+(r.lord.i+bn)+'　統率 '+(r.lord.l+bn)+(tr?' <small>（練度+'+bn+'込み）</small>':'')+'</div>'
    +'<p class="lm-bio">'+lordBio(r.lord.n)+'</p>'
    +'</div></div>'
    +'<button class="btn" id="m-close">閉じる</button>');
  document.getElementById('m-close').onclick=hideOverlay;
}

// ---------- 我が身（ステータス） ----------
function renderSelf(){
  const root=document.getElementById('tab-self');
  const s=state.stats;
  const lv=playerLevel();
  const prog=statGains()%12;
  const bar=(v,max)=>'<div class="sbar"><div style="width:'+Math.min(100,v/max*100)+'%"></div></div>';
  let html='<div class="self"><h3>殿の能力</h3>';
  html+='<div class="s-lv">殿 <b>Lv '+lv+'</b>　<span class="muted">次のLvまで 能力+'+(12-prog)+'</span>'+bar(prog,12)
    +'<div class="s-lv-note">ランクⅡ（精鋭）はLv8、ランクⅢ（最強）はLv18で解放</div></div>';
  html+='<div class="srow"><span>体力</span><b>'+s.tai+'</b>'+bar(s.tai,200)+'<small>歩くほど上がる（'+HP_GAIN_STEPS+'歩ごと+1）</small></div>';
  html+='<div class="srow"><span>武力</span><b>'+s.bu+'</b>'+bar(s.bu,99)+'<small>道場（ジム）で鍛える</small></div>';
  html+='<div class="srow"><span>知力</span><b>'+s.chi+'</b>'+bar(s.chi,99)+'<small>寺に参拝で上がる</small></div>';
  html+='<div class="srow"><span>統率</span><b>'+s.tou+'</b>'+bar(s.tou,99)+'<small>戦に勝つと上がる（出陣枠 '+partySize()+'人）</small></div>';
  html+='<div class="srow"><span>運</span><b>'+s.un+'</b>'+bar(s.un,99)+'<small>神社に参拝で上がる（会心率に影響）</small></div>';
  html+='<div class="s-pow">総合戦力 <b>'+Math.round(playerPow())+'</b>　／　軍勢の兵力 '+playerMaxHP()+'</div>';
  html+='<h3>記録</h3><div class="s-records">'
    +'<span>👣 総歩数 <b>'+state.steps.toLocaleString()+'</b></span>'
    +'<span>⚔ 戦勝 <b>'+state.wins+'</b></span>'
    +'<span>🙏 参拝 <b>'+state.prays+'</b></span>'
    +'<span>🏯 攻略 <b>'+conqueredCount()+'</b>城</span>'
    +'<span>👑 制覇 <b>'+masteredCount()+'</b>城</span>'
    +'<span>🤝 仲間 <b>'+allyCount()+'</b>人</span></div>';
  html+='<h3>歩数計の取り込み</h3>'
    +'<p class="s-note">現実で歩いた歩数を入力すると、その分も修行になる（歩くほど能力アップ！）</p>'
    +'<div class="s-import"><input type="number" id="step-input" min="1" max="100000" placeholder="今日の歩数"><button class="btn primary" id="step-btn">取り込む</button></div>';
  html+='<h3>修行・戦の記録</h3><div class="s-log">'+(state.log.length?state.log.map(l=>'<div>'+l+'</div>').join(''):'<div>まだ記録がない。</div>')+'</div>';
  html+='</div>';
  root.innerHTML=html;
  document.getElementById('step-btn').onclick=()=>{
    const v=Math.floor(+document.getElementById('step-input').value);
    if(!v||v<1){toast('歩数を入れてくだされ');return;}
    const n=Math.min(v,100000);
    const g=addSteps(n);
    addLog('歩数計から '+n.toLocaleString()+'歩 を取り込んだ'+(Object.keys(g).length?'（'+gainsText(g)+'）':''));
    toast('👣 '+n.toLocaleString()+'歩 取り込んだ！'+(Object.keys(g).length?' '+gainsText(g):''));
    save(); updateHud(); renderSelf(); updateNodeStates();
  };
}

// ---------- 設定 ----------
function renderOpt(){
  const root=document.getElementById('tab-opt');
  root.innerHTML='<div class="opt">'
    +'<h3>設定</h3>'
    +'<button class="btn" id="opt-help">📖 あそびかたを見る</button>'
    +'<button class="btn" id="opt-export">💾 セーブデータを書き出す</button>'
    +'<button class="btn" id="opt-import">📥 セーブデータを読み込む</button>'
    +'<button class="btn danger" id="opt-reset">⚠ 最初からやり直す</button>'
    +'<p class="s-note">データはこの端末（ブラウザ）に自動保存される。<br>現地モード（GPS）は https か localhost で開いた時のみ使える。スマホで遊ぶ場合は配信先が必要。</p></div>';
  document.getElementById('opt-help').onclick=showHelp;
  document.getElementById('opt-export').onclick=()=>{
    showModal('<h3>セーブデータ書き出し</h3><textarea id="sv-text" readonly>'+JSON.stringify(state)+'</textarea><p class="s-note">全文をコピーして控えておこう。</p><button class="btn" id="m-close">閉じる</button>');
    document.getElementById('sv-text').select();
    document.getElementById('m-close').onclick=hideOverlay;
  };
  document.getElementById('opt-import').onclick=()=>{
    showModal('<h3>セーブデータ読み込み</h3><textarea id="sv-text" placeholder="ここに貼り付け"></textarea><button class="btn primary" id="m-apply">読み込む</button> <button class="btn" id="m-close">やめる</button>');
    document.getElementById('m-close').onclick=hideOverlay;
    document.getElementById('m-apply').onclick=()=>{
      try{
        const s=JSON.parse(document.getElementById('sv-text').value);
        if(s.v!==1||!NODES[s.pos]) throw 0;
        state=Object.assign(defaultState(),s);
        if(!state.train) state.train={};
        save(); hideOverlay(); refreshAll();
        toast('読み込み完了！');
      }catch(e){toast('読み込めなかった…データを確認してくだされ');}
    };
  };
  document.getElementById('opt-reset').onclick=()=>{
    showModal('<h3>最初からやり直す</h3><p>仲間も歩数もすべて消えるがよいか？</p><button class="btn danger" id="m-yes">よい、消せ</button> <button class="btn" id="m-no">やめる</button>');
    document.getElementById('m-no').onclick=hideOverlay;
    document.getElementById('m-yes').onclick=()=>{
      state=defaultState(); save(); stopGeo(); hideOverlay(); refreshAll(); updateModeUI();
      toast('新たな旅が始まる…');
    };
  };
}

// ---------- 共通UI ----------
function updateHud(){
  document.getElementById('hud-steps').textContent=state.steps.toLocaleString();
  document.getElementById('hud-allies').textContent=allyCount();
  document.getElementById('hud-castles').textContent=conqueredCount();
  document.getElementById('hud-lv').textContent=playerLevel();
}
function toast(msg){
  const box=document.getElementById('toasts');
  const t=document.createElement('div');
  t.className='toast';
  t.textContent=msg;
  box.appendChild(t);
  while(box.children.length>4) box.removeChild(box.firstChild);
  setTimeout(()=>{t.classList.add('fade');setTimeout(()=>t.remove(),600);},3600);
}
function showOverlay(){document.getElementById('overlay').classList.remove('hidden');}
function hideOverlay(){document.getElementById('overlay').classList.add('hidden');}
function showModal(html){
  document.getElementById('modal').innerHTML=html;
  showOverlay();
}
function showHelp(){
  showModal('<div class="help"><h3>📖 あそびかた</h3><ol>'
    +'<li><b>二つの移動モード</b>。🚶旅モード=地図をクリックして仮想の旅。📍現地モード=GPSで<b>実際に城へ行くと戦える</b>（城から800m以内）。実際に歩いた距離も修行になる！</li>'
    +'<li>城に着いたら<b>「攻める」→出陣画面でランクを選ぶ</b>。戦いに勝てばその武将が<b>仲間</b>になる。</li>'
    +'<li>現れる武将は<b>仲間の数</b>で変わる。仲間3人で<b>武将</b>、8人で<b>重臣</b>、15人で<b>大名</b>、25人＋特殊条件で<b>レア大名</b>！</li>'
    +'<li>武将はそれぞれ<b>部隊</b>を率いる。武田の騎馬隊🐎は突撃の構えに<b>🛡防御</b>、織田の鉄砲隊🔫は装填の隙に攻めよ。大友の兵器隊💣「国崩し」は防御必須！</li>'
    +'<li><b>殿のLv</b>が上がると<b>ランクⅡ精鋭（Lv8）・ランクⅢ最強（Lv18）</b>の部隊に挑める。強い部隊を倒すと武将が<b>☆精鋭/★最強状態</b>で仲間になり、恩賞も増える。仲間済みの武将も<b>鍛え直し</b>で昇格！</li>'
    +'<li>⛩神社=運、卍寺=知力、⚔道場(ジム)=武力。<b>歩くほど体力アップ</b>（'+HP_GAIN_STEPS+'歩ごと+1）。「我が身」で歩数計の取り込みも。</li>'
    +'<li>戦闘コマンド: <b>突撃</b>（武力）・<b>計略</b>（知力で大ダメージ）・<b>鼓舞</b>（回復＆強化）・<b>防御</b>（敵の大技を凌ぐ）。</li>'
    +'</ol><button class="btn primary" id="m-close">出陣！</button></div>');
  document.getElementById('m-close').onclick=()=>{
    hideOverlay();
    if(!state.seenHelp){state.seenHelp=true;save();toast('まずは今いる『江戸城』を攻めてみよう！');}
  };
}

// ---------- タブ ----------
function setupTabs(){
  document.querySelectorAll('#tabs button').forEach(b=>{
    b.onclick=()=>{
      document.querySelectorAll('#tabs button').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      const tab=b.getAttribute('data-tab');
      document.querySelectorAll('.tab').forEach(s=>s.classList.remove('active'));
      document.getElementById('tab-'+tab).classList.add('active');
      if(tab==='zukan')renderZukan();
      if(tab==='self')renderSelf();
      if(tab==='opt')renderOpt();
    };
  });
}
function refreshAll(){
  updateHud(); updateNodeStates(); movePlayerMarker(); selectNode(null);
  const active=document.querySelector('#tabs button.active').getAttribute('data-tab');
  if(active==='zukan')renderZukan();
  if(active==='self')renderSelf();
}

// ---------- バランス検証用シミュレータ（デバッグ） ----------
// 部隊・ランク対応。実戦と同じ enemyAct を使用
function simBattle2(lord, unitKey, rank, n){
  n=n||300;
  const rk=RANKS[(rank||1)-1];
  let wins=0, turnsSum=0;
  for(let k=0;k<n;k++){
    const ppow=playerPow(), epow=enemyPow(lord)*rk.mult;
    const pmax=playerMaxHP();
    const sb={lord, unitKey:unitKey||'yari', rank:rk.n,
      ppow, epow, php:pmax, pmax,
      ehp:100+epow*0.55, emax:100+epow*0.55,
      buff:0, stun:false, guard:false, eTurn:0, loaded:false, heiki:0, tele:null};
    if(unitKey==='yumi') sb.php-=epow*0.15;
    let turns=0;
    while(turns++<60){
      // 自動方針: 大技の予告→防御 / HP35%未満→鼓舞 / 計略成功率60%以上→時々計略 / 他は突撃
      const bigNext = sb.tele==='charge' || (sb.unitKey==='heiki' && sb.heiki%3===2) || (sb.unitKey==='teppo' && sb.rank<3 && sb.loaded);
      const strP=Math.max(15,Math.min(90,45+(state.stats.chi*1.1-lord.i*0.8)));
      if(bigNext && !sb.guard){
        sb.guard=true; sb.php=Math.min(sb.pmax,sb.php+sb.pmax*0.06);
      }else if(sb.php<sb.pmax*0.35){
        sb.php=Math.min(sb.pmax,sb.php+sb.pmax*0.15+state.stats.tou*0.6); if(sb.buff<2)sb.buff++;
      }else if(strP>=60 && Math.random()<0.5){
        if(Math.random()*100<strP){sb.ehp-=sb.ppow*0.55*rnd(0.9,1.2); if(Math.random()<0.35)sb.stun=true;}
      }else{
        if(!(sb.unitKey==='shinobi' && !sb.stun && Math.random()<0.25)){
          let d=Math.max(6,(sb.ppow*0.34-sb.epow*0.08)*rnd(0.85,1.25))*(1+0.35*sb.buff);
          if(Math.random()*100<critChance())d*=1.7;
          sb.ehp-=d;
        }
        sb.buff=0;
      }
      if(sb.ehp<=0){wins++;break;}
      if(sb.stun){sb.stun=false;continue;}
      const pl=enemyPlan(sb);
      if(!pl.skip) enemyApply(sb, pl, ()=>{});
      if(sb.php<=0)break;
    }
    turnsSum+=turns;
  }
  return {winRate:Math.round(wins/n*100), avgTurns:Math.round(turnsSum/n*10)/10};
}
function simBattle(lord, n){ return simBattle2(lord, 'yari', 1, n); }

// ---------- 起動 ----------
function init(){
  if(!document.getElementById('map')) return; // 似顔絵テスト等、ゲームUIの無いページでは何もしない
  const had=load();
  buildMap();
  setupTabs();
  updateHud();
  centerOn(state.pos, 2.2);
  document.getElementById('mode-btn').onclick=()=>setMode(state.mode==='gps'?'virtual':'gps');
  updateModeUI();
  if(state.mode==='gps'){
    if(window.isSecureContext && ('geolocation' in navigator)) startGeo();
    else { state.mode='virtual'; save(); updateModeUI(); }
  }
  if(!had || !state.seenHelp){ showHelp(); }
  selectNode(state.pos);
  window.addEventListener('beforeunload',save);
}
document.addEventListener('DOMContentLoaded',init);

// デバッグ用フック
window.GAME={
  get state(){return state;},
  set state(s){state=s;},
  save, addSteps, simBattle, simBattle2, refreshAll, setMode,
  lordByKey, challengerFor, openPrep, playerPow, playerMaxHP, enemyPow, playerLevel, unitOf,
  portraitSVG, portraitHTML, openLordModal, startBattle, hideOverlay,
  // GPSテスト用: debugGpsOn()→debugFix(lat,lon[,tsOffsetSec])で擬似測位
  debugGpsOn(){ state.mode='gps'; geoStatus='ok'; updateModeUI(); },
  debugGpsOff(){ state.mode='virtual'; save(); stopGeo(); updateModeUI(); movePlayerMarker(); updateNodeStates(); renderPanel(); },
  debugFix(lat,lon,tsOffsetSec){ onFix({coords:{latitude:lat,longitude:lon,accuracy:20},timestamp:Date.now()+(tsOffsetSec||0)*1000}); },
  CASTLES, FACILITIES, NODES, EDGES, TIER, UNITS, RANKS,
};
})();
