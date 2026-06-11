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

// ---------- 出陣画面（ランク選択） ----------
function openPrep(castle){
  const ch=challengerFor(castle);
  if(!ch) return;
  const l=ch.l, u=unitOf(castle,l), key=lordKey(castle.id,ch.i);
  const curTr=trainOf(key);
  const lv=playerLevel();
  let html='<div class="prep"><h3>出陣 — '+castle.name+'</h3>';
  html+='<div class="prep-enemy tier-'+l.t+'">'
    +'<div class="b-tier" style="color:'+TIER[l.t].color+'">'+TIER[l.t].label+(ch.retrain?'（鍛え直し）':'')+'</div>'
    +'<div class="prep-name">'+l.n+'</div>'
    +'<div class="prep-unit">'+UNITS[u].icon+' '+UNITS[u].name+' を率いる　<span class="muted">武'+l.b+' 知'+l.i+' 統'+l.l+'</span></div>'
    +(ch.retrain?'<div class="prep-cur">現在の練度: '+(curTr?TRAIN_MARK[curTr]+TRAIN_NAME[curTr]:'通常')+'</div>':'')
    +'</div>';
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
function battleLog(s){ if(battle){ battle.log.unshift(s); if(battle.log.length>7)battle.log.length=7; } }

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
    buff:0, stun:false, guard:false, busy:false,
    eTurn:0, loaded:false, heiki:0, tele:null,
    over:false, log:[],
  };
  battleLog('【'+castle.name+'】'+rankArmyName(u,rank)+'が布陣している！');
  battleLog(TIER[l.t].label+'・'+l.n+'が'+UNITS[u].name+'を率いて立ちはだかる！');
  if(l.t===5) battleLog('…尋常ならざる気配。レア大名との一戦！');
  if(u==='yumi'){
    const d=Math.max(4,Math.round(epow*0.15));
    battle.php-=d;
    battleLog('🏹 開戦と同時に矢の雨が降り注ぐ！ 先制で'+d+'の損害！');
  }
  renderBattle();
  showOverlay();
}
function renderBattle(){
  const b=battle;
  if(!b) return;
  const modal=document.getElementById('modal');
  const l=b.lord, u=UNITS[b.unitKey];
  const party=topAllies();
  let html='<div class="battle">';
  html+='<div class="b-enemy tier-'+l.t+' rank-'+b.rank+'">'
    +'<div class="b-rankband rk'+b.rank+'">'+rankArmyName(b.unitKey,b.rank)+'</div>'
    +'<div class="b-units">'+u.icon.repeat(3+b.rank*2)+'</div>'
    +'<div class="b-tier" style="color:'+TIER[l.t].color+'">'+TIER[l.t].label+'</div>'
    +'<div class="b-name">'+l.n+'</div>'
    +'<div class="b-stats">武 '+l.b+'　知 '+l.i+'　統 '+l.l+'</div>'
    +hpBar(b.ehp,b.emax,'enemy')+'</div>';
  html+='<div class="b-log">'+b.log.map((s,i)=>'<div class="'+(i===0?'new':'')+'">'+s+'</div>').join('')+'</div>';
  html+='<div class="b-player"><div class="b-pname">'+(b.guard?'🛡 ':'')+'殿の軍勢（戦力 '+Math.round(b.ppow)+'）'
    +(party.length?'<span class="b-party">出陣: '+party.map(a=>a.lord.n+(trainOf(a.key)?TRAIN_MARK[trainOf(a.key)]:'')).join('、')+'</span>':'<span class="b-party">出陣: 殿ひとり…</span>')
    +'</div>'+hpBar(b.php,b.pmax,'player')+'</div>';
  if(b.over==='win'){
    const tr=RANKS[b.rank-1].train;
    html+='<div class="b-result win">🎉 勝利！ '+(b.retrain
      ? '<b>'+l.n+'</b>の部隊が'+TRAIN_MARK[tr]+TRAIN_NAME[tr]+'に鍛え直された！'
      : '<b>'+l.n+'</b>'+(tr?'が'+TRAIN_MARK[tr]+TRAIN_NAME[tr]+'状態':'')+' が仲間になった！')+'</div>';
    html+='<button class="btn primary" id="b-close">万歳！</button>';
  }else if(b.over==='lose'){
    html+='<div class="b-result lose">敗北… 兵を退いた。鍛えて出直そう。</div>';
    html+='<button class="btn" id="b-close">退却する</button>';
  }else{
    const dis=b.busy?' disabled':'';
    html+='<div class="b-actions">'
      +'<button class="btn atk" id="b-atk"'+dis+'>⚔ 突撃'+(b.buff?'（鼓舞×'+b.buff+'）':'')+'</button>'
      +'<button class="btn str" id="b-str"'+dis+'>📜 計略</button>'
      +'<button class="btn rly" id="b-rly"'+dis+'>🚩 鼓舞</button>'
      +'<button class="btn def" id="b-def"'+dis+'>🛡 防御</button>'
      +'<button class="btn run" id="b-run">🏃 退却</button>'
      +'</div>';
  }
  html+='</div>';
  modal.innerHTML=html;
  if(b.over){
    document.getElementById('b-close').onclick=()=>{
      hideOverlay();
      if(b.over==='win') afterWin(b);
      battle=null;
      updateNodeStates(); renderPanel(); updateHud();
    };
  }else{
    document.getElementById('b-atk').onclick=()=>playerAct('atk');
    document.getElementById('b-str').onclick=()=>playerAct('str');
    document.getElementById('b-rly').onclick=()=>playerAct('rly');
    document.getElementById('b-def').onclick=()=>playerAct('def');
    document.getElementById('b-run').onclick=()=>{battle.over='lose';battleLog('兵を退いた…');renderBattle();};
  }
}
function hpBar(v,max,cls){
  const pct=Math.max(0,v/max*100);
  return '<div class="hpbar '+cls+'"><div class="hpfill" style="width:'+pct+'%"></div><span>'+Math.max(0,Math.round(v))+' / '+Math.round(max)+'</span></div>';
}
function playerAct(kind){
  const b=battle;
  if(!b||b.over||b.busy) return;
  const l=b.lord;
  if(kind==='atk'){
    if(b.unitKey==='shinobi' && !b.stun && Math.random()<0.25){
      b.buff=0;
      battleLog('🥷 煙玉！ 突撃は空を切った…');
    }else{
      let dmg=Math.max(6,(b.ppow*0.34-b.epow*0.08)*rnd(0.85,1.25));
      dmg*=(1+0.35*b.buff); b.buff=0;
      if(Math.random()*100<critChance()){dmg*=1.7;battleLog('⚡ 会心の一撃！');}
      b.ehp-=dmg;
      battleLog('突撃！ '+l.n+'軍に '+Math.round(dmg)+' の損害。');
    }
  }else if(kind==='str'){
    const p=Math.max(15,Math.min(90, 45+(state.stats.chi*1.1-l.i*0.8)));
    if(Math.random()*100<p){
      const dmg=b.ppow*0.55*rnd(0.9,1.2);
      b.ehp-=dmg;
      battleLog('📜 計略成功！ '+Math.round(dmg)+' の大損害！');
      if(Math.random()<0.35){b.stun=true;battleLog(l.n+'軍は混乱している！');}
    }else{
      battleLog('計略は見破られた…！');
    }
  }else if(kind==='rly'){
    const heal=Math.min(b.pmax-b.php, b.pmax*0.15+state.stats.tou*0.6);
    b.php+=heal;
    if(b.buff<2)b.buff++;
    battleLog('🚩 鼓舞！ 兵気回復 '+Math.round(heal)+'、次の突撃が強化された。');
  }else if(kind==='def'){
    b.guard=true;
    const heal=Math.min(b.pmax-b.php, b.pmax*0.06);
    b.php+=heal;
    battleLog('🛡 防御の構え！（次に受ける攻撃を大きく軽減）');
  }
  if(b.ehp<=0){b.over='win';renderBattle();return;}
  b.busy=true;
  setTimeout(()=>{
    if(!battle||battle.over) return;
    b.busy=false;
    if(b.stun){
      b.stun=false;
      battleLog(l.n+'軍は混乱して動けない！');
    }else{
      enemyAct(b, battleLog);
    }
    if(b.php<=0){b.over='lose';}
    renderBattle();
  },480);
  renderBattle();
}
// 部隊別の敵行動（logf=ログ出力関数。シミュレータと共用）
function enemyAct(b, logf){
  const l=b.lord, u=b.unitKey;
  b.eTurn++;
  const base=()=>Math.max(5,(b.epow*0.30-b.ppow*0.06)*rnd(0.85,1.25));
  let dmg=0, msg='';
  if(u==='kiba'){
    if(b.tele==='charge'){
      b.tele=null; dmg=base()*2.0; msg='🐎 騎馬突撃！！ ';
    }else if(b.eTurn%3===2){
      b.tele='charge';
      logf('🐎 騎馬隊が突撃の構えを見せている…！（防御の好機）');
      return;
    }else{ dmg=base()*0.9; }
  }else if(u==='teppo'){
    if(b.rank>=3){
      dmg=base()*1.5; msg='🔫 三段撃ち！装填の隙がない！ ';
    }else if(b.loaded){
      b.loaded=false; dmg=base()*1.7; msg='🔫 鉄砲斉射！ ';
    }else{
      b.loaded=true;
      logf('🔫 鉄砲隊は装填中…今が攻め時！');
      return;
    }
  }else if(u==='yumi'){
    dmg=base(); msg='🏹 ';
  }else if(u==='suigun'){
    if(Math.random()<0.25){
      dmg=base()*1.5; msg='⛵ 焙烙玉が炸裂！ ';
      if(b.buff>0){ b.buff=0; msg+='（鼓舞の士気が消し飛んだ）'; }
    }else dmg=base();
  }else if(u==='shinobi'){
    dmg=base()*0.9;
  }else if(u==='heiki'){
    b.heiki++;
    const ph=b.heiki%3;
    if(ph===1){
      logf('💣 兵器隊が「国崩し」に弾込めを始めた…！');
      return;
    }
    if(ph===2){ dmg=base()*0.4; msg='狙いを定めつつ小銃が放たれる…（次は来るぞ、防御！） '; }
    else { dmg=base()*2.6; msg='💥 国崩し！！ 轟音とともに大筒が火を噴いた！ '; }
  }else{ // yari
    const roll=Math.random();
    if(roll>0.9){ logf(l.n+'軍は様子を見ている…'); return; }
    if(roll<0.15){ dmg=base()*1.4; msg='槍衾の突き崩し！ '; }
    else dmg=base();
  }
  if(b.guard){ dmg*=0.45; b.guard=false; msg+='🛡 防御で被害を抑えた！ '; }
  b.php-=dmg;
  logf(msg+l.n+'軍の攻撃！ '+Math.round(dmg)+' の損害。');
  if(u==='shinobi' && Math.random()<0.2){
    const c=Math.max(3,b.epow*0.12*rnd(0.8,1.2));
    b.php-=c;
    logf('🥷 手裏剣の追撃！ さらに '+Math.round(c)+'。');
  }
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
          html+='<span class="z-chip own'+(tr===2?' best':'')+'" style="border-color:'+TIER[l.t].color+'"><b style="color:'+TIER[l.t].color+'">'+TIER[l.t].label+'</b> '+(tr?'<span class="train">'+TRAIN_MARK[tr]+'</span>':'')+l.n+' '+uicon+'<small>武'+(l.b+TRAIN_BONUS[tr])+' 知'+(l.i+TRAIN_BONUS[tr])+' 統'+(l.l+TRAIN_BONUS[tr])+'</small></span>';
        }else{
          const unlocked=allyCount()>=TIER[l.t].req;
          let note = unlocked ? (l.t===5?'条件あり':'挑戦可') : '仲間'+TIER[l.t].req+'人〜';
          html+='<span class="z-chip" title="'+(l.t===5?l.hint:'')+'"><b style="color:'+TIER[l.t].color+'">'+TIER[l.t].label+'</b> ？？？<small>'+note+'</small></span>';
        }
      });
      html+='</div></div>';
    });
  });
  html+='</div>';
  root.innerHTML=html;
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
      enemyAct(sb, ()=>{});
      if(sb.php<=0)break;
    }
    turnsSum+=turns;
  }
  return {winRate:Math.round(wins/n*100), avgTurns:Math.round(turnsSum/n*10)/10};
}
function simBattle(lord, n){ return simBattle2(lord, 'yari', 1, n); }

// ---------- 起動 ----------
function init(){
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
  // GPSテスト用: debugGpsOn()→debugFix(lat,lon[,tsOffsetSec])で擬似測位
  debugGpsOn(){ state.mode='gps'; geoStatus='ok'; updateModeUI(); },
  debugGpsOff(){ state.mode='virtual'; save(); stopGeo(); updateModeUI(); movePlayerMarker(); updateNodeStates(); renderPanel(); },
  debugFix(lat,lon,tsOffsetSec){ onFix({coords:{latitude:lat,longitude:lon,accuracy:20},timestamp:Date.now()+(tsOffsetSec||0)*1000}); },
  CASTLES, FACILITIES, NODES, EDGES, TIER, UNITS, RANKS,
};
})();
