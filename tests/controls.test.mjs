import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('../src/game.js',import.meta.url),'utf8');
test('camera-relative WASD is correct in all four cardinal camera rotations',()=>{
 const m=code.match(/const dirX=([^;]+);\s*const dirZ=([^;]+);/);
 assert.ok(m,'movement transform exists');
 const move=Function('sx','sz','camYaw','return ['+m[1]+','+m[2]+']');
 const approx=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,actual+' != '+expected);
 const directions=[0,Math.PI/2,Math.PI,Math.PI*1.5];
 for(const yaw of directions){
  const [fx,fz]=move(0,1,yaw);
  approx(fx,-Math.sin(yaw));approx(fz,-Math.cos(yaw));
  const [rx,rz]=move(1,0,yaw);
  approx(rx,Math.cos(yaw));approx(rz,-Math.sin(yaw));
  approx(fx*rx+fz*rz,0);
 }
 assert.match(code,/proposedZ=player\.pos\.z\+dirZ\*speed\*dt/);
});
test('UI mode changes do not reference missing mode element',()=>{
 assert.match(code,/function setMode\(s\)/);
 assert.doesNotMatch(code,/\$\('mode'\)/);
 assert.match(code,/const hotbarSlots=\['pickaxe','shovel','axe','dirt','sand','stone','ironOre','wood'\]/);
 assert.match(code,/equipVisual\(s\)/);
});
test('jump key uses keydown edge; joystick is radial normalized',()=>{
 assert.match(code,/if\(e\.code==='Space'&&!e\.repeat\)jump\(\)/);
 assert.doesNotMatch(code,/if\(keys\.has\('Space'\)\)jump\(\)/);
 assert.match(code,/const len=Math\.hypot\(rawX,rawY\)/);
 assert.match(code,/const scale=len>1\?1\/len:1/);
});
