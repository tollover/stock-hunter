(() => {
  'use strict';
  const KEY='stockhunter_v02_safety';
  const defaults={policy:'strict',includeMarketplace:true,blockDangerous:true,blockedDomains:[],reviews:[],history:[]};
  let cfg;
  try{cfg={...defaults,...JSON.parse(localStorage.getItem(KEY)||'{}')}}catch{cfg={...defaults}}
  if(!Array.isArray(cfg.blockedDomains))cfg.blockedDomains=[];
  if(!Array.isArray(cfg.reviews))cfg.reviews=[];
  if(!Array.isArray(cfg.history))cfg.history=[];
  const save=()=>{localStorage.setItem(KEY,JSON.stringify(cfg));drawHistory()};
  const logHistory=entry=>{cfg.history.unshift({...entry,date:new Date().toISOString()});cfg.history=cfg.history.slice(0,100);save()};
  const hostOf=u=>{try{return new URL(u).hostname.toLowerCase()}catch{return ''}};
  const knownRisk=h=>/xn--|\.tk$|\.ml$|\.ga$|\.cf$|\.gq$|\.top$|\.xyz$|\.click$/.test(h);
  const isBlocked=h=>cfg.blockedDomains.includes(h)||cfg.blockedDomains.some(x=>h.endsWith('.'+x));
  const reviewFor=url=>cfg.reviews.find(x=>x.url===url&&x.approved===true);
  const assess=(url,seller,shipper,marketplace)=>{
    let h=hostOf(url),reasons=[];
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
    if(reasons.some(x=>/HTTPS|認証情報|IPアドレス|不審なドメイン/.test(x)))return {level:'blocked',label:'危険の疑い・利用停止',reasons};
    if(reasons.length)return {level:'review',label:'要確認（購入を保留）',reasons};
    return {level:'review',label:'確認情報あり・安全保証なし',reasons:['入力情報だけでは安全性を断定できません。公式情報・返品条件・支払方法を必ず確認してください']};
  };

  const panel=document.createElement('div');
  panel.className='panel';
  panel.innerHTML='<h3 style="margin-top:0">販売元安全性チェック（厳格設定）</h3><p class="hint">厳格設定：商品ごとに販売元を確認するまで購入リンクを停止します。第三者出品者も審査対象です。</p><div class="formgrid"><div class="field full"><label>販売ページURL</label><input id="shUrl" type="url" placeholder="https://..."></div><div class="field"><label>販売元（会社・店舗名）</label><input id="shSeller" placeholder="例：○○株式会社"></div><div class="field"><label>発送元</label><input id="shShipper" placeholder="例：販売元と同じ"></div><div class="field full"><label><input id="shMarket" type="checkbox" style="width:auto;margin-right:7px">モール内の第三者出品者</label></div><div class="field full"><button id="shCheck">安全性を確認</button></div></div><div id="shResult" class="hint" style="margin-top:12px"></div><hr style="border:0;border-top:1px solid var(--line);margin:16px 0"><div class="field"><label>危険と判断したドメインをブロック登録</label><input id="shBlock" placeholder="例：example.com"><button id="shAddBlock" class="danger">このドメインをブロック</button></div><div id="shBlocked" class="hint" style="margin-top:10px"></div><p class="hint" style="margin-top:14px">重要：最新の詐欺サイトリスト照合、会社の実在確認、価格相場の自動判定は未接続です。HTTPSや大手モールであることだけでは安全と判定できません。審査済み表示も安全を保証するものではありません。</p>';
  panel.innerHTML+='<hr style="border:0;border-top:1px solid var(--line);margin:16px 0"><h3>審査履歴（直近100件）</h3><div id="shHistory" class="hint">履歴はまだありません。</div>';
  const settings=document.getElementById('view-settings');
  if(settings)settings.insertBefore(panel,settings.children[1]||null);
  const safeText=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  function drawHistory(){const el=document.getElementById('shHistory');if(!el)return;el.innerHTML=cfg.history.length?cfg.history.map(x=>'<div style="padding:8px 0;border-bottom:1px solid var(--line)"><strong>'+(x.status==='approved'?'審査記録あり':x.status==='blocked'?'購入リンク停止':x.status==='cancelled'?'審査中断':'再審査開始')+'</strong><br>'+safeText(x.seller||'販売元未入力')+' ／ '+safeText(x.host||'URL不明')+'<br>'+safeText(new Date(x.date).toLocaleString('ja-JP'))+'</div>').join(''):'履歴はまだありません。'}
  drawHistory();
  const result=document.getElementById('shResult');
  document.getElementById('shCheck').onclick=()=>{
    const url=document.getElementById('shUrl').value.trim();
    const seller=document.getElementById('shSeller').value;
    const shipper=document.getElementById('shShipper').value;
    const market=document.getElementById('shMarket').checked;
    const a=assess(url,seller,shipper,market);
    result.innerHTML='<strong>'+a.label+'</strong><ul>'+a.reasons.map(x=>'<li>'+x.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))+'</li>').join('')+'</ul>';
    result.style.color=a.level==='blocked'?'var(--red)':'var(--amber)';
    cfg.reviews.unshift({url,host:hostOf(url),seller,shipper,marketplace:market,approved:false,level:a.level,date:new Date().toISOString()});
    save();
  };
  const drawBlocked=()=>{
    const el=document.getElementById('shBlocked');
    if(el)el.textContent=cfg.blockedDomains.length?'ブロック中：'+cfg.blockedDomains.join('、'):'ブロック登録はありません';
  };
  document.getElementById('shAddBlock').onclick=()=>{
    const raw=document.getElementById('shBlock').value.trim().replace(/^https?:\/\//,'');
    const h=hostOf('https://'+raw);
    if(!h){alert('ドメイン名を入力してください');return}
    if(!cfg.blockedDomains.includes(h))cfg.blockedDomains.push(h);
    cfg.reviews=cfg.reviews.filter(x=>hostOf(x.url)!==h);
    save();drawBlocked();enforce();
    document.getElementById('shBlock').value='';
    alert(h+' をブロック登録しました');
  };

  function askAndReview(url,link,card){
    const host=hostOf(url);
    if(!host||isBlocked(host)||knownRisk(host)){alert('危険の疑いがあるため、この購入リンクはブロックしています。');return}
    // 再審査を開始した時点で以前の承認を取り消し、途中中断でもリンクを停止する
    cfg.reviews=cfg.reviews.filter(x=>x.url!==url);
    logHistory({url,host,status:'recheck_started',seller:''});
    enforce();
    const seller=prompt('販売元の正式な会社名・店舗名を入力してください（不明ならキャンセル）');
    if(!seller||!seller.trim()){logHistory({url,host,status:'cancelled',seller:''});enforce();alert('販売元が未確認のため、購入リンクは停止したままです。');return}
    const shipper=prompt('発送元の会社名・店舗名を入力してください（不明ならキャンセル）');
    if(!shipper||!shipper.trim()){logHistory({url,host,status:'cancelled',seller:seller.trim()});enforce();alert('発送元が未確認のため、購入リンクは停止したままです。');return}
    const market=confirm('モール内の第三者出品者ですか？\n「OK」＝第三者出品者、「キャンセル」＝公式・直販');
    const checks=[
      confirm('販売元の会社概要・所在地・連絡先を、販売サイト以外の公式情報でも確認しましたか？'),
      confirm('返品・キャンセル条件と支払方法を確認しましたか？'),
      confirm('商品名・型番・JAN等が目的の商品と一致していますか？')
    ];
    const marketplaceOk=!market||confirm('第三者出品者の評価・販売実績・出品者名を確認しましたか？');
    const a=assess(url,seller,shipper,market);
    const approved=checks.every(Boolean)&&marketplaceOk&&a.level!=='blocked'&&!isBlocked(host);
    cfg.reviews=cfg.reviews.filter(x=>x.url!==url);
    if(approved)cfg.reviews.unshift({url,host,seller:seller.trim(),shipper:shipper.trim(),marketplace:market,approved:true,level:'reviewed',date:new Date().toISOString()});
    logHistory({url,host,seller:seller.trim(),shipper:shipper.trim(),marketplace:market,status:approved?'approved':'blocked',reasons:a.reasons});
    enforce();
    alert(approved?'確認項目を記録しました。リンクを利用できますが、安全を保証するものではありません。':'確認が不足しているため、購入リンクは停止したままです。');
  }

  function enforce(){
    document.querySelectorAll('#productList .product').forEach(card=>{
      const link=card.querySelector('a.button[href],a.button[data-sh-original]');
      if(!link)return;
      const url=link.dataset.shOriginal||link.href;
      if(!link.dataset.shOriginal)link.dataset.shOriginal=url;
      let action=card.querySelector('.sh-review-action');
      if(!action){
        action=document.createElement('button');
        action.type='button';action.className='secondary sh-review-action small';
        const actions=card.querySelector('.actions');
        if(actions)actions.appendChild(action);
      }
      const host=hostOf(url),review=reviewFor(url),blocked=!host||isBlocked(host)||knownRisk(host)||!url.startsWith('https://');
      if(blocked){
        link.removeAttribute('href');link.removeAttribute('target');if(link.textContent!=='危険の疑い・購入リンク停止')link.textContent='危険の疑い・購入リンク停止';link.style.background='#542b36';link.style.pointerEvents='none';link.setAttribute('aria-disabled','true');
        if(action.textContent!=='ブロック中')action.textContent='ブロック中';action.disabled=true;
      }else if(review){
        link.href=url;link.target='_blank';link.rel='noopener';if(link.textContent!=='審査記録あり・商品ページ ↗')link.textContent='審査記録あり・商品ページ ↗';link.style.background='#246fc1';link.style.pointerEvents='auto';link.removeAttribute('aria-disabled');
        if(action.textContent!=='審査内容を再確認')action.textContent='審査内容を再確認';action.disabled=false;
        action.onclick=()=>askAndReview(url,link,card);
      }else{
        link.removeAttribute('href');link.removeAttribute('target');if(link.textContent!=='審査完了まで購入リンク停止')link.textContent='審査完了まで購入リンク停止';link.style.background='#6a5424';link.style.pointerEvents='none';link.setAttribute('aria-disabled','true');
        if(action.textContent!=='販売元を審査する')action.textContent='販売元を審査する';action.disabled=false;
        action.onclick=()=>askAndReview(url,link,card);
      }
    });
  }
  drawBlocked();
  const originalRender=window.render;
  if(typeof originalRender==='function'){
    window.render=function(){originalRender();enforce();};
  }
  enforce();
})();