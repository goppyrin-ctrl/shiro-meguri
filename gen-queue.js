// 大名(t4)→重臣(t3) の順でプロンプトキュー prompts-todo.json を生成（既存肖像は除外）
const fs = require('fs');
global.window = global;
global.document = { addEventListener(){}, getElementById(){return null;}, querySelectorAll(){return [];}, createElement(){return {style:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},appendChild(){},remove(){}};}, createElementNS(){return {setAttribute(){},appendChild(){},addEventListener(){},classList:{add(){},remove(){},toggle(){}}};} };
global.localStorage = { getItem(){return null;}, setItem(){} };
global.navigator = {}; global.performance = { now: () => 0 };
eval(fs.readFileSync('data.js','utf8') + '\n' + fs.readFileSync('game.js','utf8')
  + '\nglobal.__D={PORTRAIT_OVR,LORD_BIO,CASTLE_UNIT,LORD_UNIT};');
const G = global.GAME;
const {PORTRAIT_OVR, LORD_BIO, CASTLE_UNIT, LORD_UNIT} = global.__D;
const unitOf = (c,l)=>LORD_UNIT[l.n]||CASTLE_UNIT[c.id]||'yari';
const CREST = {kuwagata:'鍬形の前立',crescent:'三日月の前立',sun:'日輪の前立',rays:'放射状の馬藺の後立',horns:'水牛の角の脇立',antlers:'鹿角の前立',antlersBig:'黒漆塗りの大鹿角の脇立',ai:'「愛」の一字の金の前立',fern:'歯朶の前立',cross:'轡十字の前立'};
const ARMOR_MAP = {'#23232e':'黒漆塗りの甲冑','#a32626':'赤備えの甲冑','#7e2a2a':'深紅の甲冑','#8c3232':'赤茶の甲冑','#2e4a6b':'紺糸縅の甲冑','#2e3a55':'紺鉄色の甲冑','#3c5a3a':'萌黄縅の甲冑','#5b7e9e':'浅葱色の甲冑','#4a3c6b':'紫紺の甲冑','#5a5a30':'渋い金茶の甲冑','#7e652a':'金茶の甲冑','#33333d':'黒鉄色の甲冑','#5a3a26':'焦茶の甲冑','#6b3c2a':'柿渋色の甲冑','#8c2f5a':'紅紫の派手な装束'};

function promptFor(c,l){
  const o = PORTRAIT_OVR[l.n]||{};
  const u = unitOf(c,l);
  const bits = [];
  let base;
  if(o.style==='female') base='戦国時代の武家の女性。豪華な打掛をまとい、長い垂髪に簪を挿した姫';
  else if(o.style==='femaleW') base='戦国時代の女武者。鉢巻を締め胸当てを着け、薙刀を携えた凛々しい姫武将';
  else if(o.style==='page') base='安土桃山時代の利発な少年。短髪に旅装';
  else if(o.style==='court') base='公家風の武家当主。立烏帽子に狩衣、白塗りに置き眉の公家化粧';
  else if(o.head==='monk') base='剃髪した僧形の戦国武将。袈裟をまとう';
  else if(u==='shinobi') base='戦国時代の忍びの頭領。黒装束に頭巾と覆面、鋭い目元';
  else {
    const armor = ARMOR_MAP[o.armorC] || '札板と色糸の縅(おどし)が入った当世具足';
    let kabuto;
    if(o.head==='bowl') kabuto='赤い合子形(お椀形)の兜をかぶり';
    else if(o.head==='tallhat') kabuto='銀色の長烏帽子形兜をかぶり';
    else if(o.head==='hood') kabuto='白い行人包(頭巾)をかぶり';
    else if(o.head==='wild') kabuto='兜を着けず蓬髪に赤い鉢巻を巻いた傾奇者の出で立ちで';
    else if(o.head==='band') kabuto='兜を着けず鉢巻姿で';
    else kabuto=(CREST[o.crest] || (l.t>=3?'鍬形の前立':'簡素な前立'))+'の付いた兜をかぶり';
    base='戦国武将。'+kabuto+'、'+armor+'を着る';
  }
  bits.push(base);
  if(o.eyepatch) bits.push('隻眼で片目に眼帯');
  if(o.scar) bits.push('頬に古い向こう傷');
  if(o.elder) bits.push('白髪交じりの老将');
  if(o.beard==='full'||o.beard==='fullGray') bits.push('豊かな髭をたくわえる');
  else if(o.beard==='goatee'||o.beard==='goateeGray') bits.push('顎髭をたくわえる');
  else if(o.beard==='thin') bits.push('薄い口髭');
  if(o.beads) bits.push('数珠を首に掛ける');
  if(o.crossPend) bits.push('十字架のペンダントを下げる');
  if(o.extra==='gunbai') bits.push('軍配団扇を手にする');
  if(o.extra==='sword') bits.push('太刀を携える');
  if(!o.style){
    if(u==='teppo') bits.push('火縄銃を傍らに置く');
    if(u==='suigun') bits.push('背景の遠くにうっすらと海と軍船');
    if(u==='kiba') bits.push('騎馬武者らしい精悍さ');
  }
  let tone;
  if(o.style==='female') tone='武家の女性らしい気品と芯の強さを感じる表情';
  else if(o.style==='femaleW') tone='女城主らしい凛とした気迫のある表情';
  else if(o.style==='page') tone='利発な少年らしい澄んだ眼差し';
  else tone={4:'一国を治める大名の堂々たる風格',3:'歴戦の重臣らしい貫禄',2:'気鋭の武将らしい精悍さ',1:'実直な家臣らしい誠実な面構え'}[l.t];
  bits.push(tone);
  const bg = l.t>=4 ? '金箔の屏風' : '落ち着いた藍墨色';
  const bio = LORD_BIO[l.n]||'';
  return '戦国武将「'+l.n+'」の肖像画を描いてください。'+bits.join('。')+'。'
    +(bio?'人物像: '+bio:'')
    +'構図: 胸から上、正面やや斜め、視線はこちらへ。背景は'+bg+'。'
    +'画風: 重厚な油彩と日本画を融合した、歴史シミュレーションゲームの武将肖像画風。高精細で落ち着いた陰影。アニメ調にしすぎない。文字・署名・印章・額縁は描かない。縦長(4:5)。';
}

const have = new Set(fs.readdirSync('portraits').filter(f=>/\.(jpg|png)$/.test(f)).map(f=>f.replace(/\.(jpg|png)$/,'')));
const queue=[];
for(const t of [4,3]){ // 大名→重臣
  G.CASTLES.forEach(c=>c.lords.forEach(l=>{
    if(l.t===t && !have.has(l.n)) queue.push({name:l.n, tier:t, prompt:promptFor(c,l)});
  }));
}
fs.writeFileSync('prompts-todo.json', JSON.stringify(queue));
console.log('queue written: '+queue.length+' (大名'+queue.filter(q=>q.tier===4).length+' + 重臣'+queue.filter(q=>q.tier===3).length+')');
