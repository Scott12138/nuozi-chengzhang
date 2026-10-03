# -*- coding: utf-8 -*-
"""把原型里的 CHAPTERS/LEVELS 换成程序化生成版，保证每关至少留 3 个空格。"""
import re, io, os

P = '/Users/consli/WorkBuddy/2026-10-01-19-57-04/chaizi-lianliankan/prototype/index.html'
s = io.open(P, encoding='utf-8').read()

new = """const CHAPTERS = [
  { id:1, name:'第一章 · 木字营', sub:'十八般兵器 · 木 / 钅 / 竹 / 革', cols:6, rows:5 },
  { id:2, name:'第二章 · 花间集', sub:'花卉草木 · 木 / 艹',             cols:6, rows:6 },
  { id:3, name:'第三章 · 逛三园', sub:'果园 / 动物园 / 植物园',          cols:7, rows:6 },
  { id:4, name:'第四章 · 百工坊', sub:'民俗器物 · 钅 / 火 / 虫',         cols:7, rows:7 }
];
const CH_POOL = {
  1:['枪','棍','棒','杖','柄','槌','杵','锤','钩','镰','锏','箭','鞭','斧','弩','剑','靶','鞘'],
  2:['梅','桃','桂','荷','菊','薇','栋','枢'],
  3:['鲤','鲸','鲨','蚁','蝶','蜂'],
  4:['铜','铁','镜','炉','烛','烟']
};
/* 程序化生成 32 关：牌数由“铺满率”推导，并硬性保证每关至少 3 个空格 */
const LEVELS = (function(){
  const out = [];
  CHAPTERS.forEach(function(c){
    for (let i = 0; i < 8; i++){
      const n = (c.id - 1) * 8 + i + 1;
      const nx = i < 3 ? 3 : (i < 6 ? 4 : 5);
      const pool = CH_POOL[c.id];
      const words = pool.slice(0, Math.min(nx, pool.length));
      const junk = i < 2 ? 3 : 4;
      const total = c.cols * c.rows;
      const cap = Math.floor((total - 3 - junk) / 2);
      let pairs = Math.floor((Math.round(total * (0.70 + i * 0.028)) - junk) / 2);
      pairs = Math.max(5, Math.min(pairs, cap));
      const tip = i < 3 ? (WORDS[pool[i]].a + ' + ' + WORDS[pool[i]].b + ' = ' + pool[i]) : '';
      out.push({ n:n, ch:c.id, cols:c.cols, rows:c.rows,
                 time: 150 - Math.min(30, i * 4),
                 words: words, pairs: pairs, junk: junk, tip: tip });
    }
  });
  return out;
})();"""

pat = re.compile(r"const CHAPTERS = \[[\s\S]*?\n\];\s*\nconst LEVELS = \[[\s\S]*?\n\];")
s2, n = pat.subn(new, s, count=1)
print('replace count =', n)
if n != 1:
    raise SystemExit('替换失败：未匹配到 CHAPTERS/LEVELS 块')
io.open(P, 'w', encoding='utf-8').write(s2)
print('written ok')
