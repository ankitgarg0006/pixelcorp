/* pixelcorp office UI — pixel renderer + live wiring to the orchestrator */
(function(){
'use strict';

// ================= PALETTE =================
const PAL={
  outline:'#33283B', ink:'#2B2536',
  wallFace:'#EDE6D8', wallBase:'#CDBFA8', wallDark:'#5C5044',
  floorLine:'#D8BE92',
  oakTop:'#B07848', oakFront:'#93603A',
  deskTop:'#EFE8DA', deskFront:'#D9CFBB',
  rugSage:'#C2CFA8', rugSageB:'#A8B88C',
  rugTerra:'#E0B49A', rugTerraB:'#C9987C',
  rugLav:'#C9BFE8', rugLavB:'#B0A4D8',
  rugBlue:'#B4C6D9', rugBlueB:'#9AB0C6',
  sky:'#AEDCF2', skyHi:'#D6EFFA',
  green1:'#4C8C50', green2:'#63A75E', green3:'#8CC176',
  accent:'#E8804C', white:'#F8F5EE', steel:'#3E3852',
};
const SKINS=[{S:'#F4CCA6',s:'#DBA97F'},{S:'#E0B183',s:'#C29061'},{S:'#C08A5C',s:'#A06F43'}];
const HAIRS=[['#362F44','#2B2536'],['#6B4A2F','#573B24'],['#A84E32','#8C3F27'],['#A8A4B0','#8E8A9A'],['#3A2E5C','#2E2447']];
const TOPS=[['#E8804C','#C4663C'],['#3E8E7E','#357464'],['#3E5077','#33415F'],['#6FA357','#5C8A47'],
            ['#8E74C9','#7A61B2'],['#D9A441','#BC8B34'],['#5C82B8','#4B6D9E'],['#E87CB0','#C96694']];
const HEADS=['short','bob','long'];

// ================= SPRITES =================
const HEAD_SHORT=['....OOOOOO....','...OHHHHHHO...','..OHHHHHHHHO..','..OHHHHHHHHO..','..OHhSSSShHO..','..OSSSSSSSSO..','..OSWeSSWeSO..','..OSSSSSSSSO..','..OsSSSSSSsO..','...OssssssO...'];
const HEAD_BOB=['...OOOOOOOO...','..OHHHHHHHHO..','.OHHHHHHHHHHO.','.OHHHHHHHHHHO.','.OHHSSSSSSHHO.','.OHhSSSSSShHO.','.OHhWeSSWehHO.','.OHhSSssSShHO.','.OHhSSSSSShHO.','..OOssssssOO..'];
const HEAD_LONG=['...OOOOOOOO...','..OHHHHHHHHO..','.OHHHHHHHHHHO.','.OHHHHHHHHHHO.','.OHHSSSSSSHHO.','.OHhSSSSSShHO.','.OHhWeSSWehHO.','.OHhSSssSShHO.','.OHhSSSSSShHO.','.OHhssssssHhO.'];
const LONG_SPILL=['.OHh......hHO.','..Oh......hO..'];
const BODY_STAND=['..OTTTTTTTTO..','.OTTTTTTTTTTO.','.OTtTTTTTTtTO.','.OTtTTTTTTtTO.','.OStTTTTTTtSO.','..OTTTTTTTTO..','..OPPPPPPPPO..','..OPPPPPPPPO..','..OPPPO.OPPPO.','..OPPPO.OPPPO.','..OEEEO.OEEEO.','...OOO...OOO..'];
const BODY_WALK=['..OTTTTTTTTO..','.OTTTTTTTTTTO.','.OTtTTTTTTtTO.','.OTtTTTTTTtTO.','.OStTTTTTTtSO.','..OTTTTTTTTO..','..OPPPPPPPPO..','..OPPPPPPPPO..','..OPPPO.OPPPO.','..OEEEO.OPPPO.','...OOO..OEEEO.','..........OOO.'];
const BODY_SIT=['..OTTTTTTTTO..','.OTTTTTTTTTTO.','.OTtTTTTTTtTO.','.OStTTTTTTtSO.','..OTTTTTTTTO..','..OPPPPPPPPO..','..OPPPPPPPPO..','..OOOOOOOOOO..'];
const CAT=['..OO.....OO...','..OFFOOOFFO...','.OFFFFFFFFO.O.','.OFfFFFfFFOFO.','.OFFFFFFFFOO..','..OFFFFFFO....','...OO..OO.....'];

function spriteCanvas(rows,map){
  const c=document.createElement('canvas');c.width=rows[0].length;c.height=rows.length;
  const g=c.getContext('2d');
  rows.forEach((row,y)=>{for(let x=0;x<row.length;x++){
    const ch=row[x];if(ch==='.'||ch===' ')continue;
    g.fillStyle=map[ch]||'#f0f';g.fillRect(x,y,1,1);}});
  return c;
}
function hash(s){let h=0;for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))>>>0;return h;}
function framesFor(id,role,look){
  const h=hash(id);
  const skin=SKINS[h%3], hair=HAIRS[(h>>2)%HAIRS.length];
  const top=TOPS[(h>>4)%TOPS.length];
  const head=look?.head||HEADS[(h>>7)%3];
  const map={O:PAL.outline,e:PAL.ink,W:'#FFFFFF',H:hair[0],h:hair[1],S:skin.S,s:skin.s,
    T:top[0],t:top[1],P:(h>>3)%2?PAL.steel:'#5C6B8C',E:'#2C2635'};
  const headRows={short:HEAD_SHORT,bob:HEAD_BOB,long:HEAD_LONG}[head];
  const spill=head==='long';
  const compose=body=>spriteCanvas(headRows.concat(body.map((r,i)=>{
    if(spill&&i<LONG_SPILL.length){let out='';
      for(let x=0;x<14;x++){const sp=LONG_SPILL[i][x];out+=(sp==='.'?r[x]:sp);}return out;}
    return r;})),map);
  return{stand:compose(BODY_STAND),walk:compose(BODY_WALK),sit:compose(BODY_SIT),top:top[0],hair:hair[0]};
}
const catSpr=spriteCanvas(CAT,{O:PAL.outline,F:'#E8964C',f:'#C97B3C'});

// ================= WORLD =================
const cv=document.getElementById('cv'),ctx=cv.getContext('2d');
const stage=document.getElementById('stage');
const W=512,H=288;
function R(c,x,y,w,h,col){c.fillStyle=col;c.fillRect(x,y,w,h);}
function outlined(c,x,y,w,h,fill){R(c,x-1,y-1,w+2,h+2,PAL.outline);R(c,x,y,w,h,fill);}

// ---- static background ----
const bg=document.createElement('canvas');bg.width=W;bg.height=H;
(function build(){
  const b=bg.getContext('2d');
  const tints=['#E5CDA4','#E1C79C','#E9D2AC','#E3CAA0'];
  for(let y=26;y<288;y+=10){
    for(let x=-16;x<W;x+=32){
      const off=((y/10)%2)*16;
      R(b,x+off,y,32,10,tints[Math.abs(((x+off)*7+y*13)>>3)%4]);
    }
    R(b,0,y,W,1,PAL.floorLine);
    for(let x=((y/10)%2)*16;x<W;x+=32)R(b,x,y+1,1,9,PAL.floorLine);
  }
  for(let i=0;i<26;i++){const kx=(i*97)%W,ky=30+((i*61)%250);R(b,kx,ky,2,1,'#C9AE82');}
  R(b,0,0,W,26,PAL.wallFace);
  for(let x=24;x<W;x+=24)R(b,x,2,1,18,'rgba(51,40,59,.05)');
  R(b,0,0,W,2,'#D8CEBC');R(b,0,20,W,6,PAL.wallBase);R(b,0,25,W,1,PAL.outline);
  R(b,0,26,W,3,'rgba(51,40,59,.10)');
  R(b,0,0,5,H,'#D8CEBC');R(b,5,26,1,H-26,'rgba(51,40,59,.25)');
  R(b,507,0,5,H,'#CBC0AC');R(b,506,26,1,H-26,'rgba(51,40,59,.25)');
  R(b,0,280,W,8,PAL.wallDark);R(b,0,279,W,1,PAL.outline);
  R(b,232,278,48,10,tints[0]);
  outlined(b,236,277,40,9,'#C46A4A');R(b,238,279,36,5,'#D2795A');
  [20,92,166,240,314,388,458].forEach(wx=>{
    R(b,wx-4,1,34,2,'#8C5A3C');
    outlined(b,wx,3,26,18,PAL.white);
    R(b,wx+2,5,22,12,PAL.sky);R(b,wx+2,5,22,4,PAL.skyHi);
    R(b,wx+4,7,3,2,'#FFF');R(b,wx+16,9,4,2,'#FFF');
    R(b,wx+12,5,2,12,PAL.white);R(b,wx+2,10,22,2,PAL.white);
    R(b,wx-1,19,28,3,'#D9CBB0');
    R(b,wx-4,3,4,17,'#C9785A');R(b,wx-3,3,1,17,'#D98B6C');
    R(b,wx+26,3,4,17,'#C9785A');R(b,wx+28,3,1,17,'#D98B6C');
  });
  outlined(b,142,6,10,12,'#8C6E4A');R(b,144,8,6,8,'#C2CFA8');R(b,146,10,2,3,'#E8804C');
  outlined(b,352,7,12,10,'#8C6E4A');R(b,354,9,8,6,PAL.sky);R(b,356,12,4,2,'#4C8C50');
  outlined(b,272,7,10,10,PAL.white);R(b,276,9,2,4,PAL.ink);R(b,277,12,3,1,PAL.ink);
  [[26,58],[114,32]].forEach(([gy,gh])=>{
    R(b,128,gy,6,gh,'#B8ADD8');
    R(b,127,gy,1,gh,PAL.outline);R(b,134,gy,1,gh,PAL.outline);
    R(b,129,gy+6,4,Math.max(8,gh-12),'rgba(240,248,255,.55)');
  });
  R(b,127,82,8,2,'#B87C4E');R(b,127,112,8,2,'#B87C4E');
  function rug(x,y,w,h,border,field,pattern){
    outlined(b,x,y,w,h,border);R(b,x+3,y+3,w-6,h-6,field);
    R(b,x+3,y+3,w-6,1,'rgba(255,255,255,.3)');
    for(let fy=y+3;fy<y+h-3;fy+=4){R(b,x-2,fy,2,1,'#D9CBB0');R(b,x+w,fy,2,1,'#D9CBB0');}
    if(pattern==='diamond')for(let py=y+8;py<y+h-8;py+=14)for(let px=x+10;px<x+w-10;px+=16){
      R(b,px,py-1,1,3,border);R(b,px-1,py,3,1,border);}
    if(pattern==='stripe')for(let py=y+7;py<y+h-5;py+=8)R(b,x+4,py,w-8,1,border);
    if(pattern==='inner'){R(b,x+7,y+7,w-14,1,border);R(b,x+7,y+h-8,w-14,1,border);
      R(b,x+7,y+7,1,h-14,border);R(b,x+w-8,y+7,1,h-14,border);}
  }
  rug(18,58,96,66,PAL.rugLavB,PAL.rugLav,'inner');
  rug(148,50,246,110,PAL.rugSageB,PAL.rugSage,'diamond');
  rug(404,52,96,96,PAL.rugTerraB,PAL.rugTerra,'stripe');
  rug(16,168,104,76,PAL.rugBlueB,PAL.rugBlue,'inner');
  rug(300,186,180,66,'#8B84C8','#9A93D2','diamond');
})();

// ---- lighting overlay ----
const lightC=document.createElement('canvas');lightC.width=W;lightC.height=H;
(function(){
  const L=lightC.getContext('2d');
  L.fillStyle='rgba(255,196,120,.05)';L.fillRect(0,0,W,H);
  [20,92,166,240,314,388,458].forEach(wx=>{
    const g=L.createRadialGradient(wx+13,24,4,wx+13,24,52);
    g.addColorStop(0,'rgba(255,241,200,.30)');g.addColorStop(1,'rgba(255,241,200,0)');
    L.fillStyle=g;L.fillRect(wx-40,0,106,84);
  });
  const g2=L.createRadialGradient(482,96,4,482,96,40);
  g2.addColorStop(0,'rgba(255,205,130,.34)');g2.addColorStop(1,'rgba(255,205,130,0)');
  L.fillStyle=g2;L.fillRect(440,56,88,84);
  const g3=L.createRadialGradient(74,72,3,74,72,26);
  g3.addColorStop(0,'rgba(255,205,130,.30)');g3.addColorStop(1,'rgba(255,205,130,0)');
  L.fillStyle=g3;L.fillRect(46,46,58,54);
  const edge='rgba(34,24,54,.20)',none='rgba(34,24,54,0)';
  [[0,0,0,34,0,0,W,34],[0,H,0,H-40,0,H-40,W,40],[0,0,36,0,0,0,36,H],[W,0,W-36,0,W-36,0,36,H]]
  .forEach(([x1,y1,x2,y2,rx,ry,rw,rh])=>{
    const vg=L.createLinearGradient(x1,y1,x2,y2);
    vg.addColorStop(0,edge);vg.addColorStop(1,none);
    L.fillStyle=vg;L.fillRect(rx,ry,rw,rh);
  });
})();

// ---- scenery + seats ----
const CABIN_SEAT={x:58,y:82,desk:{x:30,y:76},chair:'#5A3A22'};
const POD_SEATS=[
  {x:184,y:72,desk:{x:158,y:66}},{x:260,y:72,desk:{x:234,y:66}},{x:336,y:72,desk:{x:310,y:66}},
  {x:184,y:132,desk:{x:158,y:126}},{x:260,y:132,desk:{x:234,y:126}},{x:336,y:132,desk:{x:310,y:126}},
];
const STAND_SPOTS=[{x:322,y:244},{x:392,y:244},{x:436,y:170},{x:150,y:200}];
const DESK_PROPS=['dual','tower','plant','books','mug','plant'];

let employees=[];   // live state: {id,name,role,busy,frames,x,y,pose,seat}
let piecesDyn=[];
const boss={id:'boss',name:'You',x:254,y:270,pose:'stand',frames:framesFor('boss-you','Founder',{head:'short'})};

function piece(arr,base,draw){arr.push({base,draw});}
function shadow(c,x,y,w){R(c,x+1,y,w-2,3,'rgba(51,40,59,.16)');}
function block(c,x,y,w,d,h,top,front){
  R(c,x-1,y-1,w+2,d+h+2,PAL.outline);
  R(c,x,y,w,d,top);R(c,x,y+d,w,h,front);
  R(c,x,y,w,1,'rgba(255,255,255,.3)');
}
function plantPiece(c,x,y,big){
  shadow(c,x-1,y,12);
  R(c,x-1,y-7,12,8,PAL.outline);R(c,x,y-6,10,6,'#B06A3F');R(c,x,y-6,10,2,'#C97B4E');
  R(c,x-2,y-16,14,10,PAL.outline);
  R(c,x-1,y-15,12,8,PAL.green1);R(c,x+1,y-17,8,6,PAL.green2);R(c,x+3,y-19,4,5,PAL.green3);
  if(big){R(c,x-3,y-12,3,6,PAL.green1);R(c,x+10,y-13,3,7,PAL.green1);}
}
function staticScenery(arr){
  // CEO cabin furniture
  piece(arr,58-30,c=>{ // chair behind cabin desk (drawn if occupied or not)
    R(c,48,44,20,18,PAL.outline);R(c,49,45,18,16,CABIN_SEAT.chair);
    R(c,49,45,18,2,'rgba(255,255,255,.18)');
  });
  piece(arr,98,(c,t)=>{
    shadow(c,30,98,60);
    block(c,30,76,60,12,9,PAL.oakTop,PAL.oakFront);
    R(c,39,64,20,13,PAL.outline);R(c,40,65,18,10,'#2E2837');R(c,41,66,16,7,'#8FD8EF');
    outlined(c,72,68,6,4,'#F2D98C');R(c,74,72,2,5,'#B8934A');
    outlined(c,62,79,9,6,PAL.white);
  });
  piece(arr,58,c=>{
    shadow(c,22,58,30);
    R(c,21,29,32,30,PAL.outline);R(c,22,30,30,28,'#7A5230');
    R(c,24,32,26,7,'#5E3E24');R(c,24,42,26,7,'#5E3E24');R(c,24,52,26,4,'#5E3E24');
    ['#C4553E','#3E5077','#63A75E','#D9A441','#8E74C9'].forEach((col,i)=>{
      R(c,25+i*5,33,4,6,col);R(c,25+i*5,43,4,6,['#63A75E','#D9A441','#C4553E','#8E74C9','#3E5077'][i]);});
  });
  piece(arr,122,c=>plantPiece(c,98,104,1));
  // lounge
  piece(arr,56,c=>{
    shadow(c,414,56,28);
    R(c,413,29,30,28,PAL.outline);R(c,414,30,28,26,'#7A5230');
    R(c,416,32,24,6,'#5E3E24');R(c,416,41,24,6,'#5E3E24');R(c,416,50,24,4,'#5E3E24');
    ['#6FA8C9','#D9A441','#C4553E','#63A75E'].forEach((col,i)=>{
      R(c,417+i*6,33,5,5,col);R(c,417+i*6,42,5,5,['#8E74C9','#63A75E','#3E5077','#D9A441'][i]);});
  });
  piece(arr,100,c=>{
    shadow(c,477,100,10);
    R(c,481,74,2,26,PAL.outline);
    R(c,475,64,14,11,PAL.outline);R(c,476,65,12,9,'#E8B48C');R(c,476,65,12,2,'#F2C9A4');
  });
  piece(arr,86,c=>{
    shadow(c,412,86,56);
    R(c,411,59,58,28,PAL.outline);
    R(c,412,60,56,7,'#C97B54');R(c,412,67,56,14,'#E29A72');
    R(c,439,67,2,14,'#C97B54');R(c,412,81,56,5,'#C4744E');
    R(c,410,62,4,22,'#C97B54');R(c,466,62,4,22,'#C97B54');
    R(c,409,61,1,24,PAL.outline);R(c,470,61,1,24,PAL.outline);
    R(c,412,67,56,1,'rgba(255,255,255,.3)');
  });
  piece(arr,108,c=>{
    shadow(c,426,108,28);
    block(c,426,96,28,8,6,PAL.oakTop,PAL.oakFront);
    outlined(c,432,98,6,4,'#3E5077');
    outlined(c,443,97,6,5,'#F2D040');R(c,447,98,2,2,'#E8804C');
  });
  piece(arr,132,c=>{R(c,411,120,16,13,PAL.outline);R(c,412,121,14,11,'#5AA0E0');R(c,414,122,10,4,'#74B4EC');});
  piece(arr,136,c=>{R(c,473,123,16,13,PAL.outline);R(c,474,124,14,11,'#E87CB0');R(c,476,125,10,4,'#F094C2');});
  piece(arr,148,c=>plantPiece(c,488,132,1));
  // meeting nook
  piece(arr,180,c=>{
    R(c,20,152,36,26,PAL.outline);R(c,21,153,34,21,PAL.white);
    R(c,24,156,14,1,'#C4553E');R(c,24,159,22,1,'#3E5077');R(c,24,162,12,1,'#63A75E');
    R(c,24,166,16,1,'#D9A441');
    R(c,33,174,2,7,'#8A8A96');R(c,41,174,2,7,'#8A8A96');
  });
  [[36,184],[80,184],[36,232],[80,232]].forEach(([mx,my])=>piece(arr,my+8,c=>{
    R(c,mx-1,my-1,12,10,PAL.outline);R(c,mx,my,10,8,'#8C6E4A');}));
  piece(arr,224,c=>{
    shadow(c,32,224,68);
    block(c,32,202,68,14,8,PAL.oakTop,PAL.oakFront);
    outlined(c,44,205,10,7,PAL.white);R(c,46,207,6,1,'#B9B9C4');R(c,46,209,4,1,'#B9B9C4');
    outlined(c,76,206,8,6,'#3E3852');R(c,77,207,6,4,'#8FD8EF');
  });
  // kitchenette
  piece(arr,240,(c,t)=>{
    shadow(c,152,240,100);
    block(c,152,214,100,12,14,PAL.deskTop,'#C98A56');
    for(let i=156;i<244;i+=18)R(c,i,232,12,8,'#B87C4E');
    R(c,159,199,16,17,PAL.outline);R(c,160,200,14,15,'#2E2837');
    R(c,161,201,12,4,'#443E54');
    R(c,162,208,3,3,(Math.floor(t/500)%2)?'#E36868':'#8C3A3A');
    R(c,166,211,5,4,PAL.white);
    const ph=Math.floor(t/220)%3;
    R(c,167,196-ph,1,1,'rgba(255,255,255,.75)');R(c,169,194-((ph+1)%3),1,1,'rgba(255,255,255,.6)');
    outlined(c,196,216,14,6,'#B8BEC8');R(c,198,217,10,4,'#7A828E');
    outlined(c,222,210,8,6,'#D6D6DE');
  });
  piece(arr,241,c=>{
    shadow(c,258,241,20);
    R(c,257,208,22,34,PAL.outline);
    R(c,258,209,20,32,'#E4E2E6');R(c,258,209,20,10,'#D2D0D8');
    R(c,274,212,2,5,'#8A909C');R(c,274,223,2,8,'#8A909C');
  });
  piece(arr,196,c=>{
    shadow(c,285,196,12);
    R(c,284,173,14,24,PAL.outline);R(c,285,174,12,22,'#E4E2E6');
    R(c,287,168,8,8,'#8FD8EF');R(c,288,169,6,3,'#C8ECFA');
    R(c,287,184,3,3,'#6FA8C9');
  });
  // game corner — the ball rests until an actual match is on (ambient-life roadmap)
  piece(arr,234,(c,t)=>{
    shadow(c,330,234,52);
    block(c,330,206,52,18,8,'#4CA05C','#3C8449');
    R(c,330,214,52,1,'rgba(255,255,255,.5)');
    R(c,355,205,2,20,PAL.white);
    R(c,334,232,4,6,'#2E2837');R(c,374,232,4,6,'#2E2837');
    R(c,344,208,2,2,PAL.white);   // resting ball + paddles
    R(c,336,210,5,3,'#C4553E');R(c,372,210,5,3,'#3E5077');
  });
  piece(arr,214,c=>{R(c,447,202,16,13,PAL.outline);R(c,448,203,14,11,'#9A6CD8');R(c,450,204,10,4,'#AC82E4');});
  piece(arr,250,c=>plantPiece(c,468,232,1));
  piece(arr,140,c=>plantPiece(c,138,122,0));
}
function deskPieces(arr,seat,emp,prop){
  const {x,y}=seat.desk;
  // chair back
  piece(arr,seat.y-30,c=>{
    R(c,seat.x-10,seat.y-38,20,18,PAL.outline);
    R(c,seat.x-9,seat.y-37,18,16,'#443E54');
    R(c,seat.x-9,seat.y-37,18,2,'rgba(255,255,255,.18)');
    R(c,seat.x-12,seat.y-28,3,8,PAL.outline);R(c,seat.x+9,seat.y-28,3,8,PAL.outline);
    if(!emp){R(c,seat.x-6,seat.y-33,12,12,PAL.outline);R(c,seat.x-5,seat.y-32,10,10,'#4CBF72');
      R(c,seat.x-3,seat.y-31,6,3,'#3AA35C');}
  });
  piece(arr,y+22,(c,t)=>{
    shadow(c,x,y+22,56);
    block(c,x,y,56,12,9,PAL.deskTop,PAL.deskFront);
    R(c,x+17,y-11,22,14,PAL.outline);
    R(c,x+18,y-10,20,11,'#2E2837');
    let scr;
    if(!emp)scr='#26303E';
    else if(emp.busy)scr=(Math.floor(t/700)%2)?'#123324':'#0E2A1E';
    else scr=(Math.floor(t/900)%6===0)?'#A5E4F2':'#8FD8EF';
    R(c,x+19,y-9,18,8,scr);
    if(emp&&emp.busy){R(c,x+20,y-8,8,1,'#4CBF72');R(c,x+20,y-6,11,1,'#4CBF72');R(c,x+20,y-4,6,1,'#7BE3A1');}
    if(emp)R(c,x+37,y-10,3,3,'#F2D040');
    R(c,x+26,y+1,4,2,'#2E2837');
    outlined(c,x+22,y+4,12,4,'#3E3852');R(c,x+23,y+5,10,1,'#4A4658');
    if(prop==='dual'){R(c,x+41,y-8,12,10,PAL.outline);R(c,x+42,y-7,10,8,'#2E2837');
      R(c,x+43,y-6,8,5,emp&&emp.busy?'#0E2A1E':'#7EC8E3');}
    if(prop==='tower'){R(c,x+45,y-6,9,15,PAL.outline);R(c,x+46,y-5,7,13,'#2E2837');R(c,x+47,y-3,3,1,'#4CBF72');}
    if(prop==='plant'){R(c,x+44,y-3,10,9,PAL.outline);R(c,x+45,y-2,8,4,PAL.green2);R(c,x+46,y+2,6,3,'#B06A3F');}
    if(prop==='books'){R(c,x+44,y+1,4,7,'#C4553E');R(c,x+48,y+1,4,7,'#3E5077');}
    if(prop==='mug')outlined(c,x+6,y+4,4,5,emp?emp.frames.top:PAL.accent);
  });
}

function assignSeats(){
  piecesDyn=[];staticScenery(piecesDyn);
  const ceo=employees.find(e=>/ceo|chief|founder/i.test(e.role));
  let podIdx=0,standIdx=0;
  employees.forEach(e=>{
    if(e===ceo){e.x=CABIN_SEAT.x;e.y=CABIN_SEAT.y;e.pose='sit';e.seat='cabin';return;}
    if(podIdx<POD_SEATS.length){
      const s=POD_SEATS[podIdx];
      e.x=s.x;e.y=s.y;e.pose='sit';e.seat=podIdx;podIdx++;
    }else{
      const s=STAND_SPOTS[standIdx%STAND_SPOTS.length];standIdx++;
      e.x=s.x;e.y=s.y;e.pose='stand';e.seat=null;
    }
  });
  POD_SEATS.forEach((s,i)=>{
    const emp=employees.find(e=>e.seat===i);
    deskPieces(piecesDyn,s,emp||null,DESK_PROPS[i]);
  });
}

// ================= OVERLAYS =================
const tags={},bubbles={},znEls=[];
function makeEl(cls,html,click){
  const e=document.createElement(click?'button':'div');
  e.className=cls;e.innerHTML=html;
  if(click)e.addEventListener('click',click);
  stage.appendChild(e);return e;
}
[['CEO cabin',64,48],['Product team',270,42],['Lounge',452,46],
 ['Meeting',66,146],['Kitchen',202,192],['Game corner',406,182]]
 .forEach(([txt,x,y])=>znEls.push({el:makeEl('zn',txt),x,y}));
const bossTag=makeEl('tag you','You');
bossTag.title='This is you — move with the arrow keys, press Enter near an employee to talk';
const bossBubble=makeEl('bubble','');
const catBubble=makeEl('bubble','');
const talkPrompt=makeEl('talkprompt','');
talkPrompt.hidden=true;

function syncOverlays(){
  // create/remove tags & bubbles to match roster
  const ids=new Set(employees.map(e=>e.id));
  Object.keys(tags).forEach(id=>{
    if(!ids.has(id)){tags[id].remove();delete tags[id];bubbles[id].remove();delete bubbles[id];}
  });
  employees.forEach(e=>{
    if(!tags[e.id]){
      tags[e.id]=makeEl('tag','<span class="dot"></span>'+esc(e.name),()=>selectEmployee(e.id));
      tags[e.id].title='Chat with '+e.name+' · '+e.role+' (green dot = idle, amber = working)';
      bubbles[e.id]=makeEl('bubble','');
    }
    tags[e.id].classList.toggle('busy',!!e.busy);
  });
}
function placeOverlays(){
  const r=cv.getBoundingClientRect(),s=r.width/W;
  const put=(el,x,y)=>{el.style.left=(x*s)+'px';el.style.top=(y*s)+'px';};
  employees.forEach(e=>{
    const top=e.y-(e.pose==='sit'?18:22);
    if(tags[e.id])put(tags[e.id],e.x,top-2);
    if(bubbles[e.id])put(bubbles[e.id],e.x,top-6);
  });
  put(bossTag,boss.x,boss.y-24);put(bossBubble,boss.x,boss.y-28);
  if(nearId){
    const e=employees.find(x=>x.id===nearId);
    if(e){talkPrompt.hidden=false;talkPrompt.textContent='⏎ talk to '+e.name;
      put(talkPrompt,boss.x,boss.y+14);}
  }else talkPrompt.hidden=true;
  put(catBubble,cat.x,cat.y-10);
  znEls.forEach(o=>put(o.el,o.x,o.y));
}
addEventListener('resize',placeOverlays);
const sayT={};
function say(id,text,ms){
  const bb=id==='boss'?bossBubble:id==='cat'?catBubble:bubbles[id];
  if(!bb)return;
  bb.textContent=text.length>70?text.slice(0,70)+'…':text;
  bb.classList.add('show');
  clearTimeout(sayT[id]);sayT[id]=setTimeout(()=>bb.classList.remove('show'),ms||3200);
}

// ================= BOSS MOVEMENT (arrow keys) =================
// Walk your avatar around the office; get close to an employee and press Enter to talk.
const SOLIDS=[
  [20,28,34,32],[29,63,62,45],[94,86,18,20],            // cabin: shelf, desk, plant
  [126,26,10,58],[126,114,10,32],                        // glass partition (door gap stays open)
  [412,28,32,30],[408,58,64,28],[424,94,32,17],          // lounge: shelf, sofa, table
  [410,118,20,15],[472,121,20,15],[476,72,12,30],[484,114,18,20],
  [18,150,40,28],[28,180,76,64],                         // whiteboard, meeting set
  [150,212,104,30],[255,206,26,38],[282,170,18,28],      // kitchen counter, fridge, cooler
  [328,204,56,34],[445,200,20,15],[464,214,18,20],       // ping-pong, beanbag, plant
  [134,104,18,20],
];
POD_SEATS.forEach(s=>SOLIDS.push([s.desk.x-2,s.desk.y-12,60,46]));
const keys={};
let nearId=null;
function modalOpen(){return !!document.querySelector('.modal.on');}
addEventListener('keydown',e=>{
  if(officeApp.hidden||modalOpen())return;
  const t=document.activeElement&&document.activeElement.tagName;
  if(t==='INPUT'||t==='TEXTAREA'||t==='SELECT')return;
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)){
    keys[e.key]=true;e.preventDefault();
  }
  if(e.key==='Enter'&&nearId){selectEmployee(nearId);e.preventDefault();}
});
addEventListener('keyup',e=>{delete keys[e.key];});
addEventListener('blur',()=>{for(const k in keys)delete keys[k];});
function bossBlocked(x,y){
  if(x<14||x>498||y<34||y>274)return true;
  const bx=x-6,by=y-13,bw=12,bh=13;
  return SOLIDS.some(([rx,ry,rw,rh])=>bx<rx+rw&&bx+bw>rx&&by<ry+rh&&by+bh>ry);
}
function moveBoss(dt){
  const dx=(keys.ArrowRight?1:0)-(keys.ArrowLeft?1:0);
  const dy=(keys.ArrowDown?1:0)-(keys.ArrowUp?1:0);
  const moving=!!(dx||dy);
  if(moving){
    const sp=72*dt;
    const nx=boss.x+dx*sp, ny=boss.y+dy*sp;
    if(!bossBlocked(nx,boss.y))boss.x=nx;
    if(!bossBlocked(boss.x,ny))boss.y=ny;
  }
  boss.pose=moving?'walk':'stand';
  // proximity: nearest employee within reach
  let best=null,bd=30;
  employees.forEach(e=>{
    const d=Math.hypot(e.x-boss.x,e.y-boss.y);
    if(d<bd){bd=d;best=e.id;}
  });
  nearId=best;
}

// ================= RENDER LOOP =================
const cat={x:280,y:174,tx:280,ty:174};
setInterval(()=>{cat.tx=160+Math.random()*220;cat.ty=170+Math.random()*12;},5200);
setInterval(()=>{if(Math.random()<0.25)say('cat','meow~',1500);},11000);
setInterval(()=>{ // small ambient signs of life for idle folks
  const idle=employees.filter(e=>!e.busy);
  if(idle.length&&Math.random()<0.4){
    const e=idle[Math.floor(Math.random()*idle.length)];
    say(e.id,['☕','📖','💭','🎧'][Math.floor(Math.random()*4)],1600);
  }
},14000);

let last=performance.now();
function frame(t){
  const dt=Math.min(0.05,(t-last)/1000);last=t;
  moveBoss(dt);
  const cdx=cat.tx-cat.x,cdy=cat.ty-cat.y,cd=Math.hypot(cdx,cdy);
  if(cd>0.5){cat.x+=cdx/cd*10*dt;cat.y+=cdy/cd*10*dt;}
  ctx.clearRect(0,0,W,H);
  ctx.drawImage(bg,0,0);
  const list=piecesDyn.map(pc=>({base:pc.base,fn:()=>pc.draw(ctx,t)}));
  [...employees,boss].forEach(p=>{
    list.push({base:p.y,fn:()=>{
      const img=p.frames[p.pose==='walk'?(Math.floor(t/150)%2?'walk':'stand'):(p.pose==='sit'?'sit':'stand')];
      if(p.pose!=='sit')R(ctx,p.x-6,p.y-1,12,2,'rgba(51,40,59,.2)');
      ctx.drawImage(img,Math.round(p.x-7),Math.round(p.y-img.height));
    }});
  });
  list.push({base:cat.y,fn:()=>{
    R(ctx,cat.x-5,cat.y-1,10,2,'rgba(51,40,59,.16)');
    ctx.drawImage(catSpr,Math.round(cat.x-7),Math.round(cat.y-7));
  }});
  list.sort((a,b2)=>a.base-b2.base);
  list.forEach(o=>o.fn());
  ctx.drawImage(lightC,0,0);
  placeOverlays();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ================= DATA + WIRING =================
let companyName=null,selected=null;
const feed=document.getElementById('feed');
const roster=document.getElementById('roster');

function logLine(who,msg){
  const d=document.createElement('div');
  const t=new Date().toTimeString().slice(0,5);
  d.innerHTML='<span style="color:#6E6590">'+t+'</span> <span class="who">'+esc(who)+'</span> '+esc(msg);
  feed.prepend(d);
  while(feed.children.length>60)feed.removeChild(feed.lastChild);
}
function esc(s){const d=document.createElement('div');d.textContent=s??'';return d.innerHTML;}
// Markdown rendering: marked (parse) + DOMPurify (sanitize) — pinned npm deps
// served from /vendor. Falls back to escaped plain text if either is missing.
if(window.marked)marked.setOptions({gfm:true,breaks:true});
if(window.DOMPurify)DOMPurify.addHook('afterSanitizeAttributes',n=>{
  if(n.tagName==='A'){n.setAttribute('target','_blank');n.setAttribute('rel','noopener');}
});
function renderMD(src){
  if(window.marked&&window.DOMPurify)
    return '<div class="md">'+DOMPurify.sanitize(marked.parse(String(src??'')))+'</div>';
  return '<div class="md">'+esc(src).replace(/\n/g,'<br>')+'</div>';
}

async function loadState(){
  if(!companyName)return;
  const names=await (await fetch('/api/companies')).json();
  const sel=document.getElementById('companySel');
  sel.innerHTML=names.map(n=>'<option'+(n===companyName?' selected':'')+'>'+esc(n)+'</option>').join('');
  const data=await (await fetch('/api/company/'+encodeURIComponent(companyName))).json();
  const prev=Object.fromEntries(employees.map(e=>[e.id,e]));
  employees=data.employees.map(e=>({
    ...e,
    frames:prev[e.id]?.frames||framesFor(e.id,e.role),
    busy:e.busy,
  }));
  assignSeats();syncOverlays();renderRoster();fillManagerSelect();
  if(!employees.length)
    logLine('system','empty office — hit 🎉 Hire to bring in your first employee (a CEO makes a good start)');
}
// ---- launcher: pick a company, nothing auto-opens ----
const launcher=document.getElementById('launcher');
const officeApp=document.getElementById('officeApp');
async function showLauncher(){
  companyName=null;selected=null;
  officeApp.hidden=true;launcher.hidden=false;
  const names=await (await fetch('/api/companies')).json();
  const cards=document.getElementById('companyCards');
  cards.innerHTML='';
  for(const n of names){
    const info=await (await fetch('/api/company/'+encodeURIComponent(n))).json();
    const card=document.createElement('button');
    card.className='card';
    card.title='Open the '+n+' office';
    card.innerHTML='<div class="bld">🏢</div><h3>'+esc(n)+'</h3>'+
      '<div class="meta">'+info.employees.length+' employee'+(info.employees.length===1?'':'s')+'</div>'+
      '<span class="enter">Enter office →</span>';
    card.addEventListener('click',()=>enterCompany(n));
    cards.appendChild(card);
  }
  const nc=document.createElement('button');
  nc.className='card newco';
  nc.title='Found a new company — a fresh, empty office';
  nc.innerHTML='<span class="plus">＋</span><span>FOUND A NEW COMPANY</span>';
  nc.addEventListener('click',()=>{companyModal.classList.add('on');document.getElementById('cName').focus();});
  cards.appendChild(nc);
}
function enterCompany(n){
  companyName=n;selected=null;
  chatbox.hidden=true;hint.hidden=false;
  feed.innerHTML='';document.getElementById('approvals').innerHTML='';
  launcher.hidden=true;officeApp.hidden=false;
  loadState().then(()=>logLine('system',n+' office opened · '+employees.length+' employees'));
}
document.getElementById('backBtn').addEventListener('click',showLauncher);
document.getElementById('companySel').addEventListener('change',ev=>enterCompany(ev.target.value));
const companyModal=document.getElementById('companyModal');
document.getElementById('cCancel').addEventListener('click',()=>companyModal.classList.remove('on'));
companyModal.addEventListener('click',e=>{if(e.target===companyModal)companyModal.classList.remove('on');});
document.getElementById('cSubmit').addEventListener('click',async ()=>{
  const nm=document.getElementById('cName').value.trim();
  if(!nm)return;
  const r=await fetch('/api/companies',{method:'POST',
    headers:{'content-type':'application/json'},body:JSON.stringify({name:nm})});
  if(!r.ok){document.getElementById('cErr').textContent='Could not create: '+((await r.json()).error||r.status);return;}
  document.getElementById('cErr').textContent='';
  companyModal.classList.remove('on');document.getElementById('cName').value='';
  enterCompany(nm);
  logLine('🏢','founded "'+nm+'" — time to hire your first employee');
  hireModal.classList.add('on');loadModels('hProvider','hModel','hModelCustom');
});
function renderRoster(){
  roster.innerHTML='';
  employees.forEach(e=>{
    const b=document.createElement('button');
    if(selected===e.id)b.classList.add('sel');
    const c=document.createElement('canvas');
    c.width=14;c.height=e.frames.stand.height;
    c.getContext('2d').drawImage(e.frames.stand,0,0);
    b.appendChild(c);
    b.insertAdjacentHTML('beforeend',esc(e.name)+
      '<span class="rl'+(e.busy?' busy':'')+'">'
      +(e.busy?'⚙ '+esc((typeof progressText!=='undefined'&&progressText[e.id])||'working…'):esc(e.role))
      +'</span>');
    b.title='Open chat with '+e.name+' ('+e.role+')';
    b.addEventListener('click',()=>selectEmployee(e.id));
    roster.appendChild(b);
  });
}

// ---- chat panel ----
const chatbox=document.getElementById('chatbox');
const msgs=document.getElementById('msgs');
const hint=document.getElementById('hint');
async function selectEmployee(id){
  selected=id;
  const e=employees.find(x=>x.id===id);
  if(!e)return;
  chatbox.hidden=false;hint.hidden=true;
  document.getElementById('chatTitle').textContent='Chat with '+e.name+' · '+e.role;
  renderRoster();
  msgs.innerHTML='';
  const hist=await (await fetch('/api/company/'+encodeURIComponent(companyName)+'/history?with='+id)).json();
  hist.forEach(addMsgToPanel);
  msgs.scrollTop=msgs.scrollHeight;
  updateWorkStatus();
}
function addMsgToPanel(m){
  if(!(m.from===selected||m.to===selected))return;
  const d=document.createElement('div');
  if(m.kind==='delegation'||m.kind==='delegation-result'){
    d.className='msg sys';d.textContent='— '+(m.fromName||m.from)+' '+m.text+' —';
  }else{
    d.className='msg '+(m.from==='boss'?'me':'them');
    d.innerHTML='<div class="who">'+esc(m.fromName||m.from)+'</div>'+renderMD(m.text);
  }
  msgs.appendChild(d);msgs.scrollTop=msgs.scrollHeight;
}
document.getElementById('composer').addEventListener('submit',ev=>{
  ev.preventDefault();
  const input=document.getElementById('msgInput');
  const text=input.value.trim();
  if(!text||!selected)return;
  input.value='';
  fetch('/api/company/'+encodeURIComponent(companyName)+'/message',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({to:selected,text}),
  });
});
// ---- employee settings editor ----
const settingsModal=document.getElementById('settingsModal');
function engineOf(p){
  if(!p)return 'claude-cli';
  if(p.type==='cli')return p.tool==='copilot'?'copilot-cli':'claude-cli';
  if(p.type==='anthropic')return 'anthropic';
  if(p.type==='openai'&&(p.baseURL||'').includes('11434'))return 'ollama';
  return 'openai';
}
function buildProvider(engine,mdl,orig){
  if(orig&&engineOf(orig)===engine){
    const p={...orig};
    if(mdl)p.model=mdl;
    else if(engine==='claude-cli'||engine==='copilot-cli')delete p.model;
    return p;
  }
  return engine==='claude-cli'?{type:'cli',tool:'claude',...(mdl?{model:mdl}:{})}
    :engine==='copilot-cli'?{type:'cli',tool:'copilot',...(mdl?{model:mdl}:{})}
    :engine==='anthropic'?{type:'anthropic',model:mdl||'claude-sonnet-5'}
    :engine==='openai'?{type:'openai',model:mdl||'gpt-4o-mini'}
    :{type:'openai',baseURL:'http://localhost:11434/v1',model:mdl||'llama3.2'};
}
document.getElementById('settingsBtn').addEventListener('click',()=>{
  const e=employees.find(x=>x.id===selected);
  if(!e)return;
  document.getElementById('settingsWho').textContent=e.name+' (id: '+e.id+')';
  document.getElementById('sRole').value=e.role||'';
  document.getElementById('sPersona').value=e.persona||'';
  const sm=document.getElementById('sManager');
  sm.innerHTML='<option value="">(no manager)</option>'+employees.filter(x=>x.id!==e.id)
    .map(x=>'<option value="'+esc(x.id)+'"'+(x.id===e.managerId?' selected':'')+'>'
      +esc(x.name)+' · '+esc(x.role)+'</option>').join('');
  document.getElementById('sProvider').value=engineOf(e.provider);
  loadModels('sProvider','sModel','sModelCustom',(e.provider&&e.provider.model)||'');
  settingsModal.classList.add('on');
});
document.getElementById('sCancel').addEventListener('click',()=>settingsModal.classList.remove('on'));
settingsModal.addEventListener('click',e=>{if(e.target===settingsModal)settingsModal.classList.remove('on');});
document.getElementById('sSave').addEventListener('click',async ()=>{
  const e=employees.find(x=>x.id===selected);
  if(!e)return;
  const eng=document.getElementById('sProvider').value;
  await fetch('/api/company/'+encodeURIComponent(companyName)+'/update',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({id:selected,
      role:document.getElementById('sRole').value.trim(),
      persona:document.getElementById('sPersona').value.trim(),
      managerId:document.getElementById('sManager').value||null,
      provider:buildProvider(eng,modelValue('sModel','sModelCustom'),e.provider)}),
  });
  settingsModal.classList.remove('on');
  logLine('⚙','settings updated — takes effect on their next message');
  loadState().then(()=>{const ne=employees.find(x=>x.id===selected);
    if(ne)document.getElementById('chatTitle').textContent='Chat with '+ne.name+' · '+ne.role;});
});

// ---- charter editor ----
const charterModal=document.getElementById('charterModal');
document.getElementById('charterBtn').addEventListener('click',()=>{
  const e=employees.find(x=>x.id===selected);
  if(!e)return;
  document.getElementById('charterWho').textContent=e.name+' · '+e.role+
    ' — on the Claude Code engine these repos are the only paths they can touch.';
  document.getElementById('chRepos').value=(e.charter?.repos||[]).join(', ');
  const perms=(e.charter?.permissions||['read']).join(',');
  document.getElementById('chPerms').value=
    ['read','read,write','read,write,run'].includes(perms)?perms:'read';
  charterModal.classList.add('on');
});
document.getElementById('chCancel').addEventListener('click',()=>charterModal.classList.remove('on'));
charterModal.addEventListener('click',e=>{if(e.target===charterModal)charterModal.classList.remove('on');});
document.getElementById('chSave').addEventListener('click',async ()=>{
  const repos=document.getElementById('chRepos').value.split(',').map(s=>s.trim()).filter(Boolean);
  const permissions=document.getElementById('chPerms').value.split(',');
  await fetch('/api/company/'+encodeURIComponent(companyName)+'/charter',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({id:selected,repos,permissions}),
  });
  charterModal.classList.remove('on');
  logLine('📂','charter updated — takes effect on their next message');
  loadState();
});

document.getElementById('fireBtn').addEventListener('click',async ev=>{
  const btn=ev.currentTarget;
  if(btn.dataset.arm!=='1'){btn.dataset.arm='1';btn.textContent='Really fire? 📦';
    setTimeout(()=>{btn.dataset.arm='';btn.textContent='Fire 📦';},3500);return;}
  btn.dataset.arm='';btn.textContent='Fire 📦';
  await fetch('/api/company/'+encodeURIComponent(companyName)+'/fire',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({id:selected}),
  });
  chatbox.hidden=true;hint.hidden=false;selected=null;
});

// ---- hire modal ----
const hireModal=document.getElementById('hireModal');
// ---- model list per engine ----
const MODEL_QUERY={
  'claude-cli':'type=cli-claude',
  'copilot-cli':'type=cli-copilot',
  'anthropic':'type=anthropic',
  'openai':'type=openai',
  'ollama':'type=openai&baseURL='+encodeURIComponent('http://localhost:11434/v1'),
};
async function loadModels(pvId,mdlId,customId,current){
  const pv=document.getElementById(pvId).value;
  const sel=document.getElementById(mdlId);
  const custom=document.getElementById(customId);
  sel.innerHTML='<option value="">loading…</option>';
  let opts='';
  try{
    const d=await (await fetch('/api/models?'+MODEL_QUERY[pv])).json();
    if(d.error&&!d.models.length)opts='<option value="">default — '+esc(d.error)+'</option>';
    else opts=(d.models.some(m=>m.id==='default')?'':'<option value="">default</option>')+
      d.models.map(m=>'<option value="'+esc(m.id==='default'?'':m.id)+'">'+esc(m.label||m.id)+'</option>').join('');
  }catch{opts='<option value="">default</option>';}
  sel.innerHTML=opts+'<option value="__custom__">custom…</option>';
  custom.hidden=true;
  if(current){
    if([...sel.options].some(o=>o.value===current))sel.value=current;
    else{sel.value='__custom__';custom.hidden=false;custom.value=current;}
  }
}
function modelValue(mdlId,customId){
  const sel=document.getElementById(mdlId);
  return sel.value==='__custom__'?document.getElementById(customId).value.trim():sel.value;
}
function wireModelUI(pvId,mdlId,customId){
  document.getElementById(mdlId).addEventListener('change',()=>{
    document.getElementById(customId).hidden=document.getElementById(mdlId).value!=='__custom__';
  });
  document.getElementById(pvId).addEventListener('change',()=>loadModels(pvId,mdlId,customId));
}
wireModelUI('hProvider','hModel','hModelCustom');
wireModelUI('sProvider','sModel','sModelCustom');
function fillManagerSelect(){
  const sel=document.getElementById('hManager');
  sel.innerHTML='<option value="">(no manager)</option>'+
    employees.map(e=>'<option value="'+esc(e.id)+'">'+esc(e.name)+' · '+esc(e.role)+'</option>').join('');
}
document.getElementById('hireBtn').addEventListener('click',()=>{hireModal.classList.add('on');loadModels('hProvider','hModel','hModelCustom');});
document.getElementById('hCancel').addEventListener('click',()=>hireModal.classList.remove('on'));
hireModal.addEventListener('click',e=>{if(e.target===hireModal)hireModal.classList.remove('on');});
document.getElementById('hSubmit').addEventListener('click',async ()=>{
  const name=document.getElementById('hName').value.trim();
  const role=document.getElementById('hRole').value.trim();
  if(!name||!role)return;
  const pv=document.getElementById('hProvider').value;
  const mdl=modelValue('hModel','hModelCustom');
  const provider=pv==='claude-cli'?{type:'cli',tool:'claude',...(mdl?{model:mdl}:{})}
    :pv==='copilot-cli'?{type:'cli',tool:'copilot'}
    :pv==='anthropic'?{type:'anthropic',model:mdl||'claude-sonnet-5'}
    :pv==='openai'?{type:'openai',model:mdl||'gpt-4o-mini'}
    :{type:'openai',baseURL:'http://localhost:11434/v1',model:mdl||'llama3.2'};
  const repos=document.getElementById('hRepos').value.split(',').map(s=>s.trim()).filter(Boolean);
  const permissions=document.getElementById('hPerms').value.split(',');
  await fetch('/api/company/'+encodeURIComponent(companyName)+'/hire',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({name,role,
      persona:document.getElementById('hPersona').value.trim()||undefined,
      managerId:document.getElementById('hManager').value||null,provider,
      charter:{repos,permissions,notes:''}}),
  });
  document.getElementById('hRepos').value='';
  hireModal.classList.remove('on');
  document.getElementById('hName').value='';document.getElementById('hRole').value='';
  document.getElementById('hPersona').value='';
});

// ---- websocket events ----
let wsWasConnected=false;
function connectWS(){
  const ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host);
  ws.onopen=()=>{if(wsWasConnected)loadState();wsWasConnected=true;};
  ws.onmessage=ev=>{
    const m=JSON.parse(ev.data);
    if(m.company&&m.company!==companyName)return;  // events from other companies
    if(m.type==='chat'){
      if(m.from==='boss')say('boss',m.text);
      else say(m.from,m.text,4200);
      logLine((m.fromName||m.from)+' →',m.kind==='delegation'?m.text:(m.to==='boss'?'replied':'to '+m.to));
      addMsgToPanel(m);
    }
    if(m.type==='delegate'){
      logLine('delegation',m.from+' → '+m.to+': '+m.task);
    }
    if(m.type==='progress'){
      progressText[m.id]=m.text;
      const e=employees.find(x=>x.id===m.id);
      if(e&&!e.busy){e.busy=true;syncOverlays();}
      say(m.id,'⚙ '+m.text,2600);
      renderRoster();updateWorkStatus();
      if(m.id===selected)appendWorkLine(m.text);
    }
    if(m.type==='status'){
      const e=employees.find(x=>x.id===m.id);
      if(m.status!=='working')delete progressText[m.id];
      if(e){e.busy=m.status==='working';assignSeatsKeep();renderRoster();syncOverlays();}
      updateWorkStatus();
    }
    if(m.type==='approval')showApproval(m);
    if(m.type==='approval-resolved')removeApproval(m.id);
    if(m.type==='updated'||m.type==='charter')loadState();
    if(m.type==='hired'){logLine('🎉','hired '+m.name+' ('+m.role+')');loadState();}
    if(m.type==='fired'){logLine('📦',m.name+' has left the company');
      loadState().then(()=>{
        if(selected&&!employees.find(e=>e.id===selected)){
          selected=null;chatbox.hidden=true;hint.hidden=false;renderRoster();
        }
      });}
  };
  ws.onclose=()=>setTimeout(connectWS,1500);
}
function assignSeatsKeep(){assignSeats();} // busy flags feed desk screens via employee refs

// ---- live work logs ----
const progressText={};
function updateWorkStatus(){
  const el=document.getElementById('workStatus');
  const e=selected?employees.find(x=>x.id===selected):null;
  if(e&&e.busy){el.hidden=false;el.textContent=progressText[selected]||'working…';}
  else el.hidden=true;
}
function appendWorkLine(text){
  const d=document.createElement('div');
  d.className='msg work';d.textContent='⚙ '+text;
  msgs.appendChild(d);msgs.scrollTop=msgs.scrollHeight;
}

// ---- delegation approvals ----
function showApproval(m){
  const box=document.getElementById('approvals');
  if(document.getElementById('ap-'+m.id))return;
  const card=document.createElement('div');
  card.className='approval';card.id='ap-'+m.id;
  card.innerHTML='<div class="txt">🔔 <b>'+esc(m.fromName||m.from)+'</b> wants to delegate to <b>'
    +esc(m.toName||m.to)+'</b>: “'+esc(m.task)+'”</div>';
  const ok=document.createElement('button');ok.className='btn ok';ok.textContent='Approve ✓';
  ok.title='Let this delegation run — the report starts working on the subtask';
  const no=document.createElement('button');no.className='btn no';no.textContent='Deny ✕';
  no.title='Refuse — the manager is told to handle it themselves';
  const decide=approve=>{
    fetch('/api/company/'+encodeURIComponent(companyName)+'/approve',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({id:m.id,approve})});
    removeApproval(m.id);
    logLine('you',(approve?'approved ✓':'denied ✕')+' delegation to '+(m.toName||m.to));
  };
  ok.addEventListener('click',()=>decide(true));
  no.addEventListener('click',()=>decide(false));
  card.appendChild(ok);card.appendChild(no);
  box.appendChild(card);
}
function removeApproval(id){document.getElementById('ap-'+id)?.remove();}

connectWS();
showLauncher();
})();
