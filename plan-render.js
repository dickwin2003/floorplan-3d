/* ============================================================
 *  plan-render.js —— 户型方案渲染引擎（2D CAD 图 + 3D three.js 场景）
 *  plan 数据结构（单位 mm，原点 = 左上外墙外皮，x 向右，y 向下）：
 *  {
 *    title, outer:{w,h},
 *    walls:    [[x0,y0,x1,y1],...],            // 墙段（窗洞处保持连续）
 *    windows:  [[x0,y0,x1,y1],...],
 *    doors:    [{gap:[..],h:[x,y],dir:[dx,dy],len,double}],
 *    openings: [[x0,y0,x1,y1],...],
 *    rooms:    [{name,x0,y0,x1,y1,floor}],
 *    furniture:[{t,n,x,y,w,d,rot,c,lamp}],
 *    dims?:    {h:[[y,[[a,b,label],...]],...], v:[[x,[[a,b,label],...]],...]}
 *  }
 * ============================================================ */
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';

const INK = '#33322e';
const FLOORS = {
  marble:'#ece7dd', wood:'#cfa870', walnut:'#a5795a', carpet:'#b3a08a',
  tile:'#ddd8cb', tile600:'#dfe3e1', tile800:'#eae5db', antislip:'#d3d8d4', terrazzo:'#e6dfd3',
};
const floorColor = f => FLOORS[f] || '#e8e4da';
const clamp = (v,a,b) => Math.max(a, Math.min(b,v));
const num = v => { const n = Math.round(Number(v)); return isFinite(n) ? n : 0; };

/* 房间边界 → 墙网（AI 漏墙时的兜底）：
 * 共享边 = 内墙 120 居中；非共享边 = 外墙 240（贴外包络）或 120 向外 */
export function wallsFromRooms(rooms){
  const T_OUT = 240, T_IN = 120, SNAP = 40;
  const r2 = v => Math.round(v / SNAP) * SNAP;
  const xs = rooms.flatMap(r => [r.x0, r.x1]), ys = rooms.flatMap(r => [r.y0, r.y1]);
  const bx0 = Math.min(...xs), bx1 = Math.max(...xs), by0 = Math.min(...ys), by1 = Math.max(...ys);
  const edges = [];
  for(const r of rooms){
    edges.push({o:'h', p:r.y0, a:r.x0, b:r.x1, side:-1});  // 上边，房间在其下
    edges.push({o:'h', p:r.y1, a:r.x0, b:r.x1, side: 1});  // 下边，房间在其上
    edges.push({o:'v', p:r.x0, a:r.y0, b:r.y1, side:-1});  // 左边
    edges.push({o:'v', p:r.x1, a:r.y0, b:r.y1, side: 1});  // 右边
  }
  const shared = (e) => edges.some(f => f !== e && f.o === e.o && f.side === -e.side
    && Math.abs(f.p - e.p) <= SNAP && Math.min(f.b, e.b) - Math.max(f.a, e.a) > SNAP);
  const segs = [];
  for(const e of edges){
    const lineP = e.o === 'h' ? (e.side === -1 ? by0 : by1) : (e.side === -1 ? bx0 : bx1);
    const outer = !shared(e) && Math.abs(e.p - lineP) <= SNAP;
    const T = outer ? T_OUT : T_IN;
    if(e.o === 'h'){
      const y = outer && e.side === -1 ? e.p - T : (shared(e) ? e.p - T/2 : (e.side === -1 ? e.p - T : e.p));
      segs.push([r2(e.a), r2(y), r2(e.b), r2(y + T)]);
    } else {
      const x = outer && e.side === -1 ? e.p - T : (shared(e) ? e.p - T/2 : (e.side === -1 ? e.p - T : e.p));
      segs.push([r2(x), r2(e.a), r2(x + T), r2(e.b)]);
    }
  }
  const seen = new Set(), out = [];
  for(const s of segs){
    const k = s.map(v => Math.round(v / SNAP)).join(',');
    if(!seen.has(k)){ seen.add(k); out.push(s); }
  }
  return out;
}

/* 解析 / 修复外部输入（AI 返回或 JSON 文件）为可靠 plan */
export function normalizePlan(raw){
  const p = raw && typeof raw === 'object' ? raw : {};
  const arr = v => Array.isArray(v) ? v : [];
  const rect = r => { // 兼容 [x0,y0,x1,y1] 与 {x0,y0,x1,y1}；过滤退化矩形
    if(r && typeof r === 'object' && !Array.isArray(r)) r = [r.x0, r.y0, r.x1, r.y1];
    if(!Array.isArray(r) || r.length < 4) return null;
    const v = r.slice(0,4).map(num);
    return Math.abs(v[2]-v[0]) >= 40 && Math.abs(v[3]-v[1]) >= 40 ? v : null;
  };
  let walls = arr(p.walls).map(rect).filter(Boolean);
  const windows = arr(p.windows).map(rect).filter(Boolean);
  const openings = arr(p.openings).map(rect).filter(Boolean);
  const doors = arr(p.doors).map(d => d && d.gap && rect(d.gap) ? {
    gap: rect(d.gap), h: Array.isArray(d.h) ? d.h.map(num) : [d.gap[0], d.gap[1]],
    dir: Array.isArray(d.dir) && d.dir.length >= 2 ? [num(d.dir[0])||0, num(d.dir[1])||0] : [0,-1],
    len: Math.max(300, num(d.len) || (d.gap[2]-d.gap[0])),
    double: !!d.double,
  } : null).filter(Boolean);
  const rooms = arr(p.rooms).map(r => r && typeof r === 'object' ? {
    name: String(r.name || '房间'), x0:num(r.x0), y0:num(r.y0), x1:num(r.x1), y1:num(r.y1),
    floor: String(r.floor || 'tile'),
  } : null).filter(r => r && r.x1 > r.x0 && r.y1 > r.y0);
  const furniture = arr(p.furniture).map(f => f && typeof f === 'object' ? {
    t: String(f.t || 'counter'), n: String(f.n || ''), x:num(f.x), y:num(f.y),
    w: Math.max(150, num(f.w) || 600), d: Math.max(150, num(f.d) || 600),
    rot: [0,90,180,270].includes(num(f.rot)) ? num(f.rot) : (num(f.rot)%360+360)%360,
    c: typeof f.c === 'string' && /^#[0-9a-f]{3,8}$/i.test(f.c) ? f.c : undefined,
    lamp: !!f.lamp,
  } : null).filter(Boolean);
  let w = num(p.outer?.w), h = num(p.outer?.h);
  if(!w || !h){ // 依墙体外包络推算
    const xs = walls.flatMap(r => [r[0], r[2]]), ys = walls.flatMap(r => [r[1], r[3]]);
    w = w || (xs.length ? Math.max(...xs) - Math.min(...xs) : 10000);
    h = h || (ys.length ? Math.max(...ys) - Math.min(...ys) : 8000);
  }
  // 兜底：AI 没给出有效墙体时，从房间边界自动推墙网
  if(walls.length < 4 && rooms.length) walls = wallsFromRooms(rooms);
  return { title: String(p.title || '平面设计图'), outer:{w,h},
    walls, windows, doors, openings, rooms, furniture,
    dims: p.dims && typeof p.dims === 'object' ? p.dims : null };
}

/* ============================================================
 *  Plan2D —— CAD 风格平面图（Canvas）
 * ============================================================ */
export class Plan2D {
  constructor(canvas, plan, {interactive = true} = {}){
    this.c = canvas; this.ctx = canvas.getContext('2d');
    this.view = {s:.1, tx:0, ty:0}; this.exporting = false; this.drag = null;
    this.plan = normalizePlan(plan);
    if(interactive) this.#bind();
  }
  setPlan(plan){ this.plan = normalizePlan(plan); this.fit(); }
  #bind(){
    const c = this.c;
    c.addEventListener('wheel', e => {
      e.preventDefault();
      const k = e.deltaY < 0 ? 1.12 : 1/1.12;
      const r = c.getBoundingClientRect(), mx = e.clientX-r.left, my = e.clientY-r.top;
      this.view.tx = mx - (mx-this.view.tx)*k; this.view.ty = my - (my-this.view.ty)*k;
      this.view.s *= k; this.draw();
    }, {passive:false});
    c.addEventListener('pointerdown', e => { this.drag = {x:e.clientX, y:e.clientY, tx:this.view.tx, ty:this.view.ty}; c.setPointerCapture(e.pointerId); c.style.cursor='grabbing'; });
    c.addEventListener('pointermove', e => { if(!this.drag) return; this.view.tx = this.drag.tx + e.clientX-this.drag.x; this.view.ty = this.drag.ty + e.clientY-this.drag.y; this.draw(); });
    c.addEventListener('pointerup', () => { this.drag=null; c.style.cursor='grab'; });
    c.addEventListener('dblclick', () => this.fit());
  }
  #world(){ // 图形内容世界范围（墙/房间/门窗） + 标注边距
    const p = this.plan;
    const xs = [...p.walls, ...p.windows, ...p.openings].flatMap(r => [r[0], r[2]]);
    const ys = [...p.walls, ...p.windows, ...p.openings].flatMap(r => [r[1], r[3]]);
    for(const r of p.rooms){ xs.push(r.x0, r.x1); ys.push(r.y0, r.y1); }
    if(!xs.length){ xs.push(0, p.outer.w); ys.push(0, p.outer.h); }
    return {x0:Math.min(...xs), y0:Math.min(...ys), x1:Math.max(...xs), y1:Math.max(...ys)};
  }
  fitView(W, H){
    const b = this.#world(), M = {l:2000, t:1800, r:1700, b:2400};
    const w = b.x1-b.x0+M.l+M.r, h = b.y1-b.y0+M.t+M.b;
    const s = Math.min(W/w, H/h);
    return {s, tx:(W-w*s)/2 + (M.l-b.x0)*s, ty:(H-h*s)/2 + (M.t-b.y0)*s};
  }
  fit(){ Object.assign(this.view, this.fitView(this.c.clientWidth, this.c.clientHeight)); this.draw(); }
  exportPNG(px = 3200, py = 2400, filename){
    const c = this.c, old = {...this.view}, oldW = c.width, oldH = c.height;
    this.exporting = true; c.width = px; c.height = py;
    Object.assign(this.view, this.fitView(px, py));
    this.draw();
    const url = c.toDataURL('image/png');
    this.exporting = false; Object.assign(this.view, old); c.width = oldW; c.height = oldH;
    this.draw();
    const a = document.createElement('a'); a.href = url; a.download = filename || (this.plan.title + '-2D设计图.png'); a.click();
  }

  /* ---------- 绘制 ---------- */
  draw(){
    const ctx = this.ctx, c = this.c, dpr = devicePixelRatio||1;
    if(!this.exporting){
      const W=c.clientWidth, H=c.clientHeight;
      if(c.width!==Math.round(W*dpr)||c.height!==Math.round(H*dpr)){ c.width=Math.round(W*dpr); c.height=Math.round(H*dpr); }
    }
    const W = c.width, H = c.height, k = this.exporting?1:dpr, p = this.plan;
    ctx.setTransform(k,0,0,k,0,0);
    ctx.fillStyle = '#f5f1e8'; ctx.fillRect(0,0,W,H);
    ctx.translate(this.view.tx, this.view.ty); ctx.scale(this.view.s, this.view.s);
    ctx.lineJoin='round'; ctx.lineCap='round';

    // 房间地面
    for(const r of p.rooms){
      ctx.fillStyle = floorColor(r.floor); ctx.globalAlpha=.45;
      ctx.fillRect(r.x0, r.y0, r.x1-r.x0, r.y1-r.y0); ctx.globalAlpha=1;
    }
    // 地毯垫底
    for(const f of p.furniture) if(f.t==='rug') this.#sym(f);
    // 墙体
    ctx.fillStyle = INK;
    for(const [x0,y0,x1,y1] of p.walls) ctx.fillRect(x0,y0,x1-x0,y1-y0);
    // 窗
    for(const [x0,y0,x1,y1] of p.windows){
      ctx.fillStyle='#fff'; ctx.fillRect(x0,y0,x1-x0,y1-y0);
      ctx.strokeStyle=INK; ctx.lineWidth=10;
      const hor = y1-y0 < x1-x0;
      ctx.beginPath();
      if(hor){ const ym=(y0+y1)/2; ctx.rect(x0,y0,x1-x0,y1-y0); ctx.moveTo(x0,ym); ctx.lineTo(x1,ym); }
      else{ const xm=(x0+x1)/2; ctx.rect(x0,y0,x1-x0,y1-y0); ctx.moveTo(xm,y0); ctx.lineTo(xm,y1); }
      ctx.stroke();
    }
    // 门
    for(const dr of p.doors) this.#door(dr);
    // 家具
    for(const f of p.furniture) if(f.t!=='rug') this.#sym(f);
    // 房间名 + 面积
    ctx.textAlign='center'; ctx.lineJoin='round';
    for(const r of p.rooms){
      const A = ((r.x1-r.x0)*(r.y1-r.y0))/1e6;
      const fs = clamp(Math.sqrt((r.x1-r.x0)*(r.y1-r.y0))*.096, 240, 640);
      const cx=(r.x0+r.x1)/2, cy=(r.y0+r.y1)/2;
      ctx.strokeStyle = 'rgba(245,241,232,.88)'; ctx.fillStyle = INK;
      ctx.font = `600 ${fs}px 'Segoe UI','Microsoft YaHei'`;
      ctx.lineWidth = fs*.17; ctx.strokeText(r.name, cx, cy-80); ctx.fillText(r.name, cx, cy-80);
      ctx.font = `${Math.round(fs*.7)}px 'Segoe UI'`; ctx.fillStyle='#6e675a';
      ctx.strokeText(A.toFixed(1)+' ㎡', cx, cy+fs*.85); ctx.fillText(A.toFixed(1)+' ㎡', cx, cy+fs*.85);
    }
    // 尺寸标注：自定义或自动（四周总尺寸）
    const dims = p.dims || this.#autoDims();
    for(const [y, segs] of dims.h) this.#dimH(segs, y);
    for(const [x, segs] of dims.v) this.#dimV(segs, x);
    // 图名 + 双线
    const b = this.#world(), cx = (b.x0+b.x1)/2, ty = b.y1 + 1350, S = p.outer.w;
    ctx.textAlign='center'; ctx.fillStyle=INK;
    ctx.font = `700 ${Math.round(clamp(S*.052, 380, 720))}px 'Segoe UI','Microsoft YaHei'`;
    ctx.fillText(p.title, cx, ty);
    const lw = clamp(S*.56, 3800, 7200);
    ctx.fillRect(cx-lw/2, ty+170, lw, 66);
    ctx.fillRect(cx-lw/2+280, ty+352, lw-560, 38);
  }
  #autoDims(){
    const b = this.#world(), p = this.plan;
    const W = b.x1-b.x0, H = b.y1-b.y0;
    return {
      h: [[b.y0-600, [[b.x0, b.x1, String(W)]]], [b.y1+700, [[b.x0, b.x1, String(W)]]]],
      v: [[b.x0-600, [[b.y0, b.y1, String(H)]]], [b.x1+700, [[b.y0, b.y1, String(H)]]]],
    };
  }
  #dimH(segs, y){
    const ctx = this.ctx, b = this.#world(), fs = clamp((b.x1-b.x0)*.028, 220, 360);
    ctx.strokeStyle = '#7a7466'; ctx.fillStyle = '#5c574c'; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(segs[0][0], y); ctx.lineTo(segs[segs.length-1][1], y); ctx.stroke();
    ctx.font = `${fs}px 'Segoe UI'`; ctx.textAlign='center';
    for(const [a,b2,label] of segs){
      for(const x of [a,b2]){ ctx.beginPath(); ctx.moveTo(x-110,y+110); ctx.lineTo(x+110,y-110); ctx.stroke(); }
      ctx.fillText(label, (a+b2)/2, y-140);
    }
  }
  #dimV(segs, x){
    const ctx = this.ctx, b = this.#world(), fs = clamp((b.x1-b.x0)*.028, 220, 360);
    ctx.strokeStyle = '#7a7466'; ctx.fillStyle = '#5c574c'; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(x, segs[0][0]); ctx.lineTo(x, segs[segs.length-1][1]); ctx.stroke();
    ctx.font = `${fs}px 'Segoe UI'`;
    for(const [a,b2,label] of segs){
      for(const y of [a,b2]){ ctx.beginPath(); ctx.moveTo(x-110,y+110); ctx.lineTo(x+110,y-110); ctx.stroke(); }
      ctx.save(); ctx.translate(x-140,(a+b2)/2); ctx.rotate(-Math.PI/2); ctx.fillText(label,0,0); ctx.restore();
    }
  }
  #doorArc(x,y,r,a0,a1){
    const ctx = this.ctx;
    let d0 = a1-a0; while(d0>Math.PI) d0-=2*Math.PI; while(d0<-Math.PI) d0+=2*Math.PI;
    ctx.lineWidth=8; ctx.setLineDash([90,70]);
    ctx.beginPath(); ctx.arc(x,y,r,a0,a0+d0,d0<0); ctx.stroke();
    ctx.setLineDash([]);
  }
  #door(dr){
    const ctx = this.ctx, [gx0,gy0,gx1,gy1] = dr.gap, [hx,hy] = dr.h, [dx,dy] = dr.dir;
    const hor = gy1-gy0 < gx1-gx0;
    ctx.strokeStyle=INK; ctx.lineWidth=16;
    if(dr.double){
      const L = hor ? (gx1-gx0)/2 : (gy1-gy0)/2;
      if(hor){
        const ym=(gy0+gy1)/2;
        ctx.beginPath(); ctx.moveTo(gx0,ym); ctx.lineTo(gx0,ym+dy*L); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(gx1,ym); ctx.lineTo(gx1,ym+dy*L); ctx.stroke();
        this.#doorArc(gx0,ym,L, 0, Math.atan2(dy,dx));
        this.#doorArc(gx1,ym,L, Math.PI, Math.atan2(dy,-dx));
      } else {
        const xm=(gx0+gx1)/2;
        ctx.beginPath(); ctx.moveTo(xm,gy0); ctx.lineTo(xm+dx*L,gy0); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(xm,gy1); ctx.lineTo(xm+dx*L,gy1); ctx.stroke();
        this.#doorArc(xm,gy0,L, Math.PI/2, Math.atan2(dy,dx));
        this.#doorArc(xm,gy1,L, -Math.PI/2, Math.atan2(dy,-dx));
      }
    } else {
      const cx=(gx0+gx1)/2, cy=(gy0+gy1)/2;
      const wallAng = hor ? Math.atan2(0, Math.sign(cx-hx)||1) : Math.atan2(Math.sign(cy-hy)||1, 0);
      ctx.beginPath(); ctx.moveTo(hx,hy); ctx.lineTo(hx+dx*dr.len, hy+dy*dr.len); ctx.stroke();
      this.#doorArc(hx,hy,dr.len, wallAng, Math.atan2(dy,dx));
    }
  }
  #rot(f, fn){ const ctx=this.ctx; ctx.save(); ctx.translate(f.x,f.y); ctx.rotate((f.rot||0)*Math.PI/180); fn(); ctx.restore(); }
  #rr(x,y,w,h,r){ const ctx=this.ctx; ctx.beginPath(); ctx.roundRect(x,y,w,h,r); }

  /* 家具平面符号 */
  #sym(f){
    const ctx = this.ctx, w=f.w, d=f.d, hw=w/2, hd=d/2;
    ctx.lineWidth = 14; ctx.strokeStyle = INK; ctx.fillStyle = f.c || '#eee';
    this.#rot(f, () => {
      switch(f.t){
        case 'sofa': case 'cornersofa': {
          this.#rr(-hw,-hd,w,d,60); ctx.fill(); ctx.stroke();
          this.#rr(-hw,-hd,w,150,60); ctx.fillStyle='#00000014'; ctx.fill(); ctx.stroke();
          this.#rr(-hw,-hd,150,d,60); ctx.fill(); ctx.stroke(); this.#rr(hw-150,-hd,150,d,60); ctx.fill(); ctx.stroke();
          const n = Math.max(2, Math.round(w/850));
          ctx.beginPath();
          for(let i=1;i<n;i++){ ctx.moveTo(-hw+150+i*(w-300)/n, -hd+150); ctx.lineTo(-hw+150+i*(w-300)/n, hd); }
          ctx.moveTo(-hw+150, 150-hd); ctx.lineTo(hw-150, 150-hd);
          ctx.stroke();
          if(f.t==='cornersofa'){
            ctx.fillStyle = f.c || '#eee';
            this.#rr(hw-650,-hd+150,650,d-150,60); ctx.fill(); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(hw-650, 150-hd+(d-150)/2); ctx.lineTo(hw, 150-hd+(d-150)/2); ctx.stroke();
          }
          break; }
        case 'armchair': {
          this.#rr(-hw,-hd,w,d,90); ctx.fill(); ctx.stroke();
          this.#rr(-hw,-hd,w,140,70); ctx.fillStyle='#00000014'; ctx.fill(); ctx.stroke();
          this.#rr(-hw,-hd,140,d,70); ctx.fill(); ctx.stroke(); this.#rr(hw-140,-hd,140,d,70); ctx.fill(); ctx.stroke();
          this.#rr(-hw+140,-hd+140,w-280,d-140,40); ctx.stroke();
          break; }
        case 'chair': {
          this.#rr(-hw,-hd,w,d,40); ctx.fill(); ctx.stroke();
          this.#rr(-hw,-hd,w,110,40); ctx.fillStyle='#00000018'; ctx.fill(); ctx.stroke();
          break; }
        case 'roundtable': {
          ctx.beginPath(); ctx.arc(0,0,hw,0,7); ctx.fill(); ctx.stroke();
          ctx.beginPath(); ctx.arc(0,0,hw-140,0,7); ctx.stroke();
          break; }
        case 'coffeetable': case 'table': {
          this.#rr(-hw,-hd,w,d,f.t==='table'?40:80); ctx.fill(); ctx.stroke();
          this.#rr(-hw+90,-hd+90,w-180,d-180,50); ctx.stroke();
          break; }
        case 'sidetable': {
          ctx.beginPath(); ctx.arc(0,0,hw,0,7); ctx.fill(); ctx.stroke();
          if(f.lamp){ ctx.beginPath(); ctx.arc(0,0,hw*.55,0,7); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(-hw*.35,0); ctx.lineTo(hw*.35,0); ctx.moveTo(0,-hw*.35); ctx.lineTo(0,hw*.35); ctx.stroke(); }
          break; }
        case 'bed': {
          this.#rr(-hw,-hd,w,d,40); ctx.fill(); ctx.stroke();
          this.#rr(-hw,-hd,w,d*.28,40); ctx.fillStyle='#ffffff88'; ctx.fill(); ctx.stroke();   // 床头
          this.#rr(-hw+80,-hd+d*.32,(w-200)/2-40,d*.22,40); ctx.stroke();                      // 枕头
          this.#rr((w-200)/2+60,-hd+d*.32,(w-200)/2-40,d*.22,40); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(-hw,-hd+d*.6); ctx.lineTo(hw,-hd+d*.6); ctx.stroke();    // 翻被线
          break; }
        case 'nightstand': case 'wardrobe': case 'desk': case 'bookshelf':
        case 'counter': case 'tvstand': case 'shoecab': case 'vanity': case 'fridge': case 'washer': {
          this.#rr(-hw,-hd,w,d,20); ctx.fill(); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(-hw,-hd+110); ctx.lineTo(hw,-hd+110); ctx.stroke();
          if(f.t==='wardrobe'){ ctx.beginPath(); ctx.moveTo(0,-hd); ctx.lineTo(0,hd); ctx.stroke(); }
          if(f.t==='washer'){ ctx.beginPath(); ctx.arc(0,0,hw*.5,0,7); ctx.stroke(); ctx.beginPath(); ctx.arc(0,0,hw*.28,0,7); ctx.stroke(); }
          break; }
        case 'ksink': {
          this.#rr(-hw,-hd,w,d,30); ctx.fillStyle='#fff'; ctx.fill(); ctx.stroke();
          ctx.beginPath(); ctx.ellipse(0,40,hw*.32,hd*.5,0,0,7); ctx.stroke();
          ctx.beginPath(); ctx.arc(0,-hd+70,50,0,7); ctx.stroke();
          break; }
        case 'stove': {
          this.#rr(-hw,-hd,w,d,20); ctx.fillStyle='#eee'; ctx.fill(); ctx.stroke();
          for(const bx of [-hw*.45, hw*.15]){ ctx.beginPath(); ctx.arc(bx+60,0,hd*.55,0,7); ctx.stroke(); ctx.beginPath(); ctx.arc(bx+60,0,hd*.28,0,7); ctx.stroke(); }
          break; }
        case 'toilet': {
          ctx.fillStyle='#fff';
          this.#rr(-hw*.45,-hd,w*.45,d*.4,30); ctx.fill(); ctx.stroke();                       // 水箱
          ctx.beginPath(); ctx.ellipse(0,hd*.15,hw*.48,hd*.42,0,0,7); ctx.fill(); ctx.stroke();// 坐圈
          break; }
        case 'shower': {
          this.#rr(-hw,-hd,w,d,30); ctx.fillStyle='#eef3f6'; ctx.fill(); ctx.stroke();
          ctx.beginPath(); ctx.arc(-hw*.3,-hd*.3,hw*.16,0,7); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(-hw,-hd); ctx.lineTo(hw*.5,-hd); ctx.stroke();
          break; }
        case 'bathtub': {
          this.#rr(-hw,-hd,w,d,60); ctx.fillStyle='#eef3f6'; ctx.fill(); ctx.stroke();
          this.#rr(-hw+110,-hd+110,w-220,d-220,50); ctx.stroke();
          ctx.beginPath(); ctx.arc(-hw+180,0,60,0,7); ctx.stroke();
          break; }
        case 'plant': {
          ctx.beginPath(); ctx.arc(0,0,hw,0,7); ctx.stroke();
          ctx.beginPath();
          for(let i=0;i<7;i++){ const a=i*2*Math.PI/7;
            ctx.moveTo(0,0); ctx.quadraticCurveTo(Math.cos(a-.35)*hw*.9, Math.sin(a-.35)*hw*.9, Math.cos(a)*hw*.85, Math.sin(a)*hw*.85); }
          ctx.stroke();
          ctx.beginPath(); ctx.arc(0,0,hw*.18,0,7); ctx.fill();
          break; }
        case 'tv': {
          ctx.fillStyle=INK; this.#rr(-hw,-hd,w,d,10); ctx.fill();
          break; }
        case 'rug': {
          ctx.setLineDash([160,90]); ctx.strokeStyle='#a89a7e'; ctx.lineWidth=10;
          this.#rr(-hw,-hd,w,d,40); ctx.stroke();
          this.#rr(-hw+120,-hd+120,w-240,d-240,30); ctx.stroke();
          ctx.setLineDash([]);
          break; }
        default: { // 未知类型：通用矩形 + 名称
          this.#rr(-hw,-hd,w,d,20); ctx.fill(); ctx.stroke();
          if(f.n && w>500){ ctx.fillStyle=INK; ctx.font="300px 'Segoe UI'"; ctx.textAlign='center'; ctx.fillText(f.n, 0, 100); }
        }
      }
    });
  }
}

/* ============================================================
 *  Plan3D —— three.js 场景（动态旋转 / 交互 / 导出）
 * ============================================================ */
const mat = (c, r=.85, m=0) => new THREE.MeshStandardMaterial({color:c, roughness:r, metalness:m});
function box(w,h,d,material,x,y,z,ry=0){
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), material);
  mesh.position.set(x,y,z); mesh.rotation.y = ry; mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
function rbox(w,h,d,material,x,y,z,r=60){
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(w,h,d,3,r), material);
  mesh.position.set(x,y,z); mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
const cyl = (rt,rb,h,material,x,y,z,seg=24) => {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,seg), material);
  mesh.position.set(x,y,z); mesh.castShadow = mesh.receiveShadow = true; return mesh;
};

export class Plan3D {
  constructor(canvas){ this.c = canvas; this.inited = false; }
  setPlan(plan){ this.plan = normalizePlan(plan); this.init(); }   // init 内部先 dispose 再重建
  setAutoRotate(b){ if(this.controls) this.controls.autoRotate = b; }
  resize(){
    if(!this.renderer) return;
    const W = this.c.clientWidth, H = this.c.clientHeight;
    this.renderer.setSize(W, H, false); this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.camera.aspect = W/H; this.camera.updateProjectionMatrix();
  }
  dispose(){
    if(this.renderer){ this.renderer.setAnimationLoop(null); }
    if(this.scene) this.scene.traverse(o => { o.geometry?.dispose?.(); if(Array.isArray(o.material)) o.material.forEach(m=>m.dispose()); else o.material?.dispose?.(); });
    this.controls?.dispose?.(); this.renderer?.dispose?.();
    if(this.c) this.c.width = this.c.width; // 清空画布
    this.renderer = this.scene = this.camera = this.controls = null; this.inited = false;
  }
  init(){
    this.dispose();
    const plan = this.plan, S = Math.max(plan.outer.w, plan.outer.h), wallH = 3200;
    this.wallH = wallH;
    const renderer = this.renderer = new THREE.WebGLRenderer({canvas:this.c, antialias:true, preserveDrawingBuffer:true});
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color('#e6e0d2');
    scene.fog = new THREE.Fog('#e6e0d2', S*4, S*9);
    const camera = this.camera = new THREE.PerspectiveCamera(50, 1, 10, S*20);
    const cx = plan.outer.w/2, cz = plan.outer.h/2;
    camera.position.set(cx + S*.43, S*1.77, cz + S*.88);
    const controls = this.controls = new OrbitControls(camera, this.c);
    controls.enableDamping = true; controls.dampingFactor = .08;
    controls.target.set(cx, 0, cz);
    controls.maxPolarAngle = Math.PI/2 - .02; controls.minDistance = S*.15; controls.maxDistance = S*6;
    controls.autoRotate = true; controls.autoRotateSpeed = 1.1;

    scene.add(new THREE.HemisphereLight('#fdf6e8', '#b8ad98', .85));
    const sun = new THREE.DirectionalLight('#fff3dd', 2.2);
    sun.position.set(-S*1.2, S*1.9, -S*.7); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, {left:-S*1.1, right:S*1.1, top:S*1.1, bottom:-S*1.1, far:S*7});
    scene.add(sun);
    scene.add(new THREE.AmbientLight('#e8e0d0', .25));

    const ground = new THREE.Mesh(new THREE.CircleGeometry(S*5, 48), mat('#cdc5b2', 1));
    ground.rotation.x = -Math.PI/2; ground.position.y = -20; ground.receiveShadow = true;
    scene.add(ground);
    scene.add(this.#floors());
    scene.add(this.#walls());
    for(const f of plan.furniture) scene.add(this.#furn(f));

    this.resize();
    // 开场动画：正上方鸟瞰 → 斜视角飞入
    this.fly = {t:0, from:new THREE.Vector3(cx, S*3, cz), to:camera.position.clone()};
    renderer.setAnimationLoop(() => this.#tick());
    this.inited = true;
  }
  #tick(){
    if(this.fly){
      this.fly.t += .012;
      const k = 1 - Math.pow(1 - Math.min(this.fly.t,1), 3);
      this.camera.position.lerpVectors(this.fly.from, this.fly.to, k);
      if(this.fly.t >= 1) this.fly = null;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
  exportPNG(filename){
    if(!this.renderer) return false;
    this.renderer.render(this.scene, this.camera);
    const a = document.createElement('a');
    a.href = this.c.toDataURL('image/png');
    a.download = filename || (this.plan.title + '-3D视图.png'); a.click();
    return true;
  }
  #floors(){
    const g = new THREE.Group();
    for(const r of this.plan.rooms){
      const m = new THREE.Mesh(new THREE.BoxGeometry(r.x1-r.x0, 30, r.y1-r.y0), mat(floorColor(r.floor), .9));
      m.position.set((r.x0+r.x1)/2, 15, (r.y0+r.y1)/2); m.receiveShadow = true;
      g.add(m);
    }
    return g;
  }
  /* 墙体：整段墙 + 门窗洞（窗留上下坎 + 玻璃；门留上坎 + 门扇） */
  #walls(){
    const plan = this.plan, wallH = this.wallH;
    const wallMat = mat('#f2ede2', .95), frameMat = mat('#8a8378', .6);
    const glassMat = new THREE.MeshPhysicalMaterial({color:'#bcd6e2', transparent:true, opacity:.35, roughness:.1, metalness:0});
    const doorMat = mat('#8a6b46', .7);
    const g = new THREE.Group();
    const holes = [
      ...plan.windows.map(r => ({r, type:'win'})),
      ...plan.doors.map(d => ({r:d.gap, type:'door'})),
      ...plan.openings.map(r => ({r, type:'open'})),
    ];
    for(const w of plan.walls){
      const hor = (w[3]-w[1]) < (w[2]-w[0]);           // 水平墙
      const lo = hor ? w[0] : w[1], hi = hor ? w[2] : w[3];
      const mine = holes.filter(h => {
        const r = h.r, ch = hor ? r[1] : r[0], ct = hor ? r[3] : r[2];
        const mid = hor ? (r[0]+r[2])/2 : (r[1]+r[3])/2;
        return mid > lo-1 && mid < hi+1 && Math.abs(ch-(hor?w[1]:w[0]))<5 && Math.abs(ct-(hor?w[3]:w[2]))<5;
      }).sort((a,b) => (hor?a.r[0]:a.r[1]) - (hor?b.r[0]:b.r[1]));
      let cur = lo;
      const put = (a,b) => { if(b-a<1) return;
        if(hor) g.add(box(b-a, wallH, w[3]-w[1], wallMat, (a+b)/2, wallH/2, (w[1]+w[3])/2));
        else    g.add(box(w[2]-w[0], wallH, b-a, wallMat, (w[0]+w[2])/2, wallH/2, (a+b)/2));
      };
      for(const h of mine){
        const r = h.r, a = hor?r[0]:r[1], b = hor?r[2]:r[3];
        put(cur, a); cur = b;
        const ccx = (r[0]+r[2])/2, ccz = (r[1]+r[3])/2;
        const L = hor? r[2]-r[0] : r[3]-r[1], T = hor? r[3]-r[1] : r[2]-r[0];
        if(h.type==='win'){
          if(hor){ g.add(box(L,900,T,wallMat,ccx,450,ccz)); g.add(box(L,wallH-2600,T,wallMat,ccx,(2600+wallH)/2,ccz)); }
          else   { g.add(box(T,900,L,wallMat,ccx,450,ccz)); g.add(box(T,wallH-2600,L,wallMat,ccx,(2600+wallH)/2,ccz)); }
          g.add(box(hor?L:T, 1700, 40, glassMat, ccx, 1750, ccz, hor?0:Math.PI/2));
          g.add(box(hor?L:60, 1700, hor?60:T, frameMat, ccx, 1750, ccz));
        } else if(h.type==='door'){
          const head = 2100;
          if(hor) g.add(box(L, wallH-head, T, wallMat, ccx, (head+wallH)/2, ccz));
          else    g.add(box(T, wallH-head, L, wallMat, ccx, (head+wallH)/2, ccz));
          g.add(box(hor?L:45, head-40, hor?45:L, doorMat, ccx, (head-40)/2+40, ccz));
          const knob = new THREE.Mesh(new THREE.SphereGeometry(40), mat('#c9b370',.3,.8));
          knob.position.set(hor ? ccx + (r[2]-ccx)*.7 : ccx + T/2, 1000, hor ? ccz + T/2 : ccz + (r[3]-ccz)*.7);
          g.add(knob);
        } else {
          if(hor) g.add(box(L, wallH-2300, T, wallMat, ccx, (2300+wallH)/2, ccz));
          else    g.add(box(T, wallH-2300, L, wallMat, ccx, (2300+wallH)/2, ccz));
        }
      }
      put(cur, hi);
    }
    return g;
  }
  /* 家具 3D */
  #furn(f){
    const g = new THREE.Group();
    const wood = mat('#c9a26b',.6), woodD = mat('#8a6b46',.65), dark = mat('#3a3a3c',.5,.3);
    const white = mat('#f0f0ee',.5), steel = mat('#c9ced3',.3,.6);
    const green = mat('#7da05f',.9), greenD = mat('#5d8547',.9), pot = mat('#b0703f',.8);
    const w=f.w, d=f.d;
    switch(f.t){
      case 'sofa': case 'armchair': {
        const fab = mat(f.c||'#b7c4b0',.95);
        const m = f.t==='armchair' ? 120 : 150;
        g.add(rbox(w, 420, d-m, fab, 0, 210+m/2, m/2, 70));
        g.add(rbox(w, 620, m, fab, 0, 310+m/2, -d/2+m/2, 70));
        g.add(rbox(m, 260, d, fab, -w/2+m/2, 480, 0, 70));
        g.add(rbox(m, 260, d, fab, w/2-m/2, 480, 0, 70));
        const n = Math.max(1, Math.round((w-2*m)/850));
        for(let i=0;i<n;i++) g.add(rbox((w-2*m)/n-40, 160, d-m-60, fab, -w/2+m+(w-2*m)*(i+.5)/n, 460, 60, 60));
        break; }
      case 'cornersofa': {
        const fab = mat(f.c||'#b7c4b0',.95);
        g.add(rbox(w-650, 420, d, fab, -325, 210, 0, 70));
        g.add(rbox(650, 420, 650, fab, w/2-325, 210, d/2-325, 70));
        g.add(rbox(w-650, 620, 150, fab, -325, 310, -d/2+75, 70));
        g.add(rbox(150, 620, d, fab, -w/2+650+75, 310, 0, 70));
        g.add(rbox(650, 620, 150, fab, w/2-325, 310, -d/2+650+75, 70));
        g.add(rbox(500, 160, 500, fab, w/2-325, 460, d/2-325, 60));
        break; }
      case 'chair': {
        g.add(rbox(w, 120, d, wood, 0, 450, 0, 30));
        g.add(rbox(w, 520, 90, wood, 0, 720, -d/2+45, 30));
        for(const [lx,lz] of [[-1,-1],[1,-1],[-1,1],[1,1]]) g.add(box(60,450,60,woodD, lx*(w/2-60), 225, lz*(d/2-60)));
        break; }
      case 'roundtable': {
        const r = w/2;
        g.add(cyl(r, r, 80, wood, 0, 760, 0, 36));
        g.add(cyl(120, 150, 720, woodD, 0, 360, 0));
        g.add(cyl(r*.55, r*.6, 60, woodD, 0, 30, 0, 36));
        break; }
      case 'coffeetable': {
        g.add(rbox(w, 70, d, wood, 0, 420, 0, 30));
        for(const [lx,lz] of [[-1,-1],[1,-1],[-1,1],[1,1]]) g.add(box(70,420,70,woodD, lx*(w/2-80), 210, lz*(d/2-80)));
        break; }
      case 'table': {
        g.add(rbox(w, 70, d, wood, 0, 730, 0, 30));
        for(const [lx,lz] of [[-1,-1],[1,-1],[-1,1],[1,1]]) g.add(box(70,730,70,woodD, lx*(w/2-80), 365, lz*(d/2-80)));
        break; }
      case 'sidetable': {
        const r = w/2;
        g.add(cyl(r, r, 60, wood, 0, 500, 0, 24));
        g.add(cyl(60, 80, 470, dark, 0, 235, 0));
        if(f.lamp) g.add(cyl(r*.45, r*.6, 220, mat('#e8d9b0',.7), 0, 640, 0));
        break; }
      case 'bed': {
        const fab = mat(f.c||'#e7e2d6',.95);
        g.add(rbox(w, 350, d, fab, 0, 175, 0, 40));                        // 床体
        g.add(rbox(w-100, 200, d*.62, mat('#ffffff',.9), 0, 440, d*.15, 60)); // 被褥
        g.add(rbox(w*.38, 110, d*.2, white, -w*.22, 420, -d/2+d*.16, 40));  // 枕头
        g.add(rbox(w*.38, 110, d*.2, white, w*.22, 420, -d/2+d*.16, 40));
        g.add(rbox(w, 900, 90, woodD, 0, 450, -d/2+45, 30));               // 床头板
        break; }
      case 'nightstand': { g.add(box(w, 500, d, mat(f.c||'#e8dccb',.8), 0, 250, 0)); break; }
      case 'wardrobe': {
        g.add(box(w, 2200, d, mat(f.c||'#efe6d8',.8), 0, 1100, 0));
        g.add(box(30, 2000, 20, woodD, 0, 1050, d/2+5));
        for(const lx of [-w*.22, w*.22]) g.add(cyl(35,35,220,steel,lx,1050,d/2+40,12));
        break; }
      case 'desk': case 'counter': case 'tvstand': case 'shoecab': {
        const h = f.t==='counter' ? 850 : f.t==='desk' ? 750 : 500;
        const b = mat(f.c||'#e9e5de',.8);
        g.add(box(w, h, d, b, 0, h/2, 0));
        g.add(box(w+40, 40, d+40, mat('#7a6a52',.5), 0, h+20, 0));
        break; }
      case 'bookshelf': { g.add(box(w, 1800, d, mat(f.c||'#e2cfb4',.8), 0, 900, 0)); break; }
      case 'ksink': {
        g.add(box(w, 120, d, mat('#e9e5de',.8), 0, 870, 0));
        g.add(cyl(Math.min(w,d)*.28, Math.min(w,d)*.28, 30, steel, 0, 900, 60));
        g.add(cyl(30,30,160, mat('#b8b8ba',.3,.8), 0, 980, -d/2+80));
        break; }
      case 'stove': {
        g.add(box(w, 100, d, dark, 0, 890, 0));
        for(const bx of [-w*.3, w*.1]) g.add(cyl(d*.32, d*.32, 20, mat('#1f1f22',.4), bx+40, 950, 0, 20));
        break; }
      case 'fridge': {
        g.add(box(w, 1800, d, mat(f.c||'#dfe4e8',.5,.25), 0, 900, 0));
        g.add(box(20, 700, 30, steel, w*.3, 1250, d/2+10));
        break; }
      case 'toilet': {
        g.add(box(w*.5, 380, d*.32, white, 0, 190, -d/2+d*.16));           // 水箱
        g.add(cyl(w*.36, w*.42, 400, white, 0, 200, d*.08));               // 坐体
        g.add(cyl(w*.36, w*.4, 60, white, 0, 420, d*.08));
        break; }
      case 'vanity': {
        g.add(box(w, 800, d, mat(f.c||'#eef1f3',.7), 0, 400, 0));
        g.add(cyl(w*.3, w*.32, 40, white, 0, 820, 0));
        break; }
      case 'shower': {
        g.add(box(w, 60, d, mat('#e4edf2',.8), 0, 30, 0));
        const glass = new THREE.MeshPhysicalMaterial({color:'#cfe2ec', transparent:true, opacity:.3, roughness:.05});
        g.add(box(30, 2000, d, glass, -w/2+15, 1000, 0));
        g.add(box(w, 2000, 30, glass, 0, 1000, -d/2+15));
        break; }
      case 'bathtub': {
        g.add(box(w, 550, d, mat(f.c||'#eef3f6',.5), 0, 275, 0));
        g.add(box(w-160, 420, d-160, mat('#dce8ef',.6), 0, 420, 0));
        g.add(cyl(45,45,200, steel, -w/2+140, 500, 0));
        break; }
      case 'washer': {
        g.add(box(w, 850, d, mat(f.c||'#e6ebee',.6), 0, 425, 0));
        g.add(cyl(d*.36, d*.36, 20, mat('#aab4ba',.3,.5), 0, 480, d/2-8, 24));
        break; }
      case 'plant': {
        const s = w/2;
        g.add(cyl(s*.5, s*.38, s*.55, pot, 0, s*.27, 0));
        g.add(cyl(40, 50, s*.7, mat('#6b4f2e',.9), 0, s*.85, 0));
        for(const [ox,oy,oz,r,mm] of [[0,1.35,0,.62,green],[.3,1.7,.15,.45,greenD],[-.3,1.55,-.2,.38,green]]){
          const b = new THREE.Mesh(new THREE.IcosahedronGeometry(s*r,1), mm);
          b.position.set(s*ox, s*oy, s*oz); b.castShadow = true; g.add(b);
        }
        break; }
      case 'tv': {
        g.add(box(w, 600, 60, dark, 0, 820, 0));
        g.add(box(w-80, 520, 15, mat('#101014',.2,.4), 0, 820, 32));
        break; }
      case 'rug': {
        const mesh = rbox(w, 24, d, mat(f.c||'#d9cdb4',1), 0, 12, 0, 20);
        mesh.castShadow = false; g.add(mesh);
        break; }
      default: { // 未知类型：通用矮柜体
        g.add(box(w, 600, d, mat(f.c||'#e0d8c8',.85), 0, 300, 0));
      }
    }
    g.position.set(f.x, 0, f.y);
    g.rotation.y = -(f.rot||0)*Math.PI/180;
    return g;
  }
}
