(() => {
  const KEY='stockhunter_v02_safety';
  const defaults={policy:'strict',includeMarketplace:true,blockDangerous:true,blockedDomains:[],reviews:[]};
  let cfg;
  try{cfg={...defaults,...JSON.parse(localStorage.getItem(KEY)||'{}')}}catch{cfg={...defaults}}
  const save=()=>localStorage.setItem(KEY,JSON.stringify(cfg));
  const hostOf=u=>{try{return new URL(u).hostname.toLowerCase()}catch{return ''}};
  const knownRisk=h=>/xn--|\.tk$|\.ml$|\.ga$|\.cf$|\.gq$|\.top$|\.xyz$|\.click$|\.shop$/.test(h);
  const isBlocked=h=>cfg.blockedDomains.includes(h)||cfg.blockedDomains.some(x=>h.endsWith('.'+x));
  const assess=(url,seller,shipper,marketplace)=>{
    let h=hostOf(url), reasons=[];
    if(!h)return {level:'blocked',label:'URL不正',reasons:['正しいURLを入力してください']};
    let u=new URL(url);
    if(u.protocol!=='https:')reasons.push('HTTPSではありません');
    if(u.username||u.password)reasons.push('URLに認証情報が含まれています');
    if(/^\d{1,3}(\.\d{1,3}){3}$/.test(h))reasons.push('IPアドレス形式の販売サイトです');
    if(knownRisk(h))reasons.push('不審なドメイン形式が含まれています');
    if(isBlocked(h))return {level:'blocked',label:'ブロック対象',reasons:['登録済みブロックリストに一致']};
    if(!seller.trim())reasons.push('販売元の会社名・店舗名が未確認です');
    if(!shipper.trim())reasons.push('発送元が未確認です');
    if(marketplace)reasons.push('モール内の第三者出品者です。出品者評価・販売実績・返品条件を確認してください');
    if(reasons.some(x=>x.includes('HTTPS')||x.includes('認証情報')||x.includes('IPアドレス')||x.includes('不審なドメイン')))return {level:'blocked',label:'危険の疑い・利用停止',reasons};
    if(reasons.length)return {level:'review',label:'要確認（購入を保留）',reasons};
    return {level:'review',label:'個別確認済みでも安全保証なし',reasons:['公式情報・会社概要・返品条件・支払方法を別途確認してください']};
  };
  const panel=document.createElement('div');
  panel.className='panel';
  panel.innerHTML='<h3 style="margin-top:0">販売元安全性チェック（厳格設定）</h3><p class="hint">第三者出品者も審査対象です。危険判定したドメインは商品一覧の購入リンクをブロックします。入力内容はこの端末に保存されます。</p><div class="formgrid"><div class="field full"><label>販売ページURL</label><input id="shUrl" type="url" placeholder="https://..."></div><div class="field"><label>販売元（会社・店舗名）</label><input id="shSeller" placeholder="例：○○株式会社"></div><div class="field"><label>発送元</label><input id="shShipper" placeholder="例：販売元と同じ"></div><div class="field full"><label><input id="shMarket" type="checkbox" style="width:auto;margin-right:7px">モール内の第三者出品者</label></div><div class="field full"><button id="shCheck">安全性を確認</button></div></div><div id="shResult" class="hint" style="margin-top:12px"></div><hr style="border:0;border-top:1px solid var(--line);margin:16px 0"><div class="field"><label>危険と判断したドメインをブロック登録</label><input id="shBlock" placeholder="例：example.com"><button id="shAddBlock" class="danger">このドメインをブロック</button></div><div id="shBlocked" class="hint" style="margin-top:10px"></div><p class="hint" style="margin-top:14px">重要：この試作版はURL形式と入力情報の簡易審査です。詐欺サイトの最新リスト照合、販売会社の実在確認、価格の相場判定は未接続です。HTTPSや大手モールであることだけでは安全と判定できません。安全性を保証する機能ではありません。</p>';
  const settings=document.getElementById('view-settings');
  settings.insertBefore(panel,settings.children[1]||null);
  const result=document.getElementById('shResult');
  document.getElementById('shCheck').onclick=()=>{
    const a=assess(document.getElementById('shUrl').value,document.getElementById('shSeller').value,document.getElementById('shShipper').value,document.getElementById('shMarket').checked);
    result.innerHTML='<strong>'+a.label+'</strong><ul>'+a.reasons.map(x=>'<li>'+x.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))+'</li>').join('')+'</ul>';
    if(a.level==='blocked')result.style.color='var(--red)';else result.style.color='var(--amber)';
    cfg.reviews.unshift({url:document.getElementById('shUrl').value,host:hostOf(document.getElementById('shUrl').value),seller:document.getElementById('shSeller').value,level:a.level,date:new Date().toISOString()});save();
  };
  const drawBlocked=()=>{document.getElementById('shBlocked').textContent=cfg.blockedDomains.length?'ブロック中：'+cfg.blockedDomains.join('、'):'ブロック登録はありません'};
  document.getElementById('shAddBlock').onclick=()=>{
    const h=hostOf('https://'+document.getElementById('shBlock').value.trim().replace(/^https?:\/\//,''));
    if(!h){alert('ドメイン名を入力してください');return}
    if(!cfg.blockedDomains.includes(h))cfg.blockedDomains.push(h);
    save();drawBlocked();document.getElementById('shBlock').value='';
    alert(h+' をブロック登録しました');
  };
  drawBlocked();
  const enforce=()=>{
    document.querySelectorAll('#productList a.button[href]').forEach(a=>{
      const h=hostOf(a.href);
      if(isBlocked(h)){a.removeAttribute('href');a.removeAttribute('target');a.textContent='危険サイトのためブロック';a.style.background='#542b36';a.style.pointerEvents='none';a.setAttribute('aria-disabled','true')}
    });
  };
  new MutationObserver(enforce).observe(document.getElementById('productList'),{childList:true,subtree:true});
  enforce();
})();