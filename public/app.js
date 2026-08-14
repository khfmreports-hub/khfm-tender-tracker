(function(){
  let RAW = [];
  const TODAY = new Date();

  const STATUS_META = {
    'Awarded':               { cls:'Awarded',               label:'Awarded' },
    'Not Awarded':           { cls:'NotAwarded',             label:'Not Awarded' },
    'Disqualified':          { cls:'Disqualified',           label:'Disqualified' },
    'Technically Qualified': { cls:'TechnicallyQualified',   label:'Tech. Qualified' },
    'Not Meeting Criteria':  { cls:'NotMeetingCriteria',     label:'Not Meeting Criteria' },
    'Pending':               { cls:'Pending',                label:'Pending' },
  };

  const STAT_ORDER = ['All','Awarded','Not Awarded','Disqualified','Technically Qualified','Not Meeting Criteria','Pending'];
  const STAT_TONE = {
    'All':'', 'Awarded':'tone-green', 'Not Awarded':'tone-red', 'Disqualified':'tone-red',
    'Technically Qualified':'tone-gold', 'Not Meeting Criteria':'tone-slate', 'Pending':'tone-slate'
  };

  let activeStatus = 'All';
  let searchTerm = '';
  let sortMode = 'due-asc';
  let openRow = null;

  function fmtMoney(n){
    if(n === null || n === undefined) return '—';
    return '₹' + Math.round(n).toLocaleString('en-IN');
  }
  function fmtDate(d){
    if(!d) return '—';
    const dt = new Date(d+'T00:00:00');
    return dt.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
  }
  function daysDiff(d){
    if(!d) return null;
    const dt = new Date(d+'T00:00:00');
    return Math.round((dt - TODAY)/86400000);
  }

  function computeStats(){
    const counts = {};
    STAT_ORDER.forEach(s => counts[s]=0);
    counts['All'] = RAW.length;
    RAW.forEach(r => { counts[r.status] = (counts[r.status]||0)+1; });
    return counts;
  }

  function renderStats(){
    const counts = computeStats();
    const el = document.getElementById('stats');
    el.innerHTML = '';
    STAT_ORDER.forEach(s => {
      const div = document.createElement('div');
      div.className = 'stat ' + (STAT_TONE[s]||'') + (activeStatus===s ? ' active':'');
      div.innerHTML = `<span class="n">${counts[s]||0}</span><span class="l">${s}</span>`;
      div.addEventListener('click', () => { activeStatus = s; openRow=null; render(); });
      el.appendChild(div);
    });
  }

  function matches(r){
    if(activeStatus !== 'All' && r.status !== activeStatus) return false;
    if(searchTerm){
      const hay = [r.org, r.tenderId, r.work].filter(Boolean).join(' ').toLowerCase();
      if(!hay.includes(searchTerm.toLowerCase())) return false;
    }
    return true;
  }

  function sortRows(rows){
    const arr = rows.slice();
    switch(sortMode){
      case 'due-asc': arr.sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999')); break;
      case 'due-desc': arr.sort((a,b)=>(b.due||'0000').localeCompare(a.due||'0000')); break;
      case 'est-desc': arr.sort((a,b)=>(b.estimate||0)-(a.estimate||0)); break;
      case 'est-asc': arr.sort((a,b)=>(a.estimate||1e15)-(b.estimate||1e15)); break;
      case 'org-asc': arr.sort((a,b)=>(a.org||'').localeCompare(b.org||'')); break;
    }
    return arr;
  }

  function renderTable(){
    const filtered = sortRows(RAW.filter(matches));
    document.getElementById('countShown').textContent = filtered.length;
    document.getElementById('countTotal').textContent = RAW.length;

    const ledger = document.getElementById('ledger');
    ledger.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'row head';
    head.innerHTML = `
      <div class="c-sr">Sr</div>
      <div class="c-org">Organisation</div>
      <div class="c-work">Scope of Work</div>
      <div class="c-due">Due</div>
      <div class="c-val">Estimate</div>
      <div>Status</div>
    `;
    ledger.appendChild(head);

    if(filtered.length === 0){
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = 'No tenders match this filter.';
      ledger.appendChild(e);
      return;
    }

    filtered.forEach(r => {
      const meta = STATUS_META[r.status] || STATUS_META['Pending'];
      const dd = daysDiff(r.due);
      let tag = '';
      if(dd !== null && r.status === 'Pending'){
        if(dd < 0) tag = `<span class="tag overdue">Overdue ${Math.abs(dd)}d</span>`;
        else if(dd <= 14) tag = `<span class="tag soon">In ${dd}d</span>`;
      }

      const wrap = document.createElement('div');
      wrap.className = 'row-wrap';

      const row = document.createElement('div');
      row.className = 'row' + (openRow === r.sr ? ' open':'');
      row.innerHTML = `
        <div class="c-sr">${r.sr}</div>
        <div class="c-org">
          <span class="org-name">${escapeHtml(r.org||'—')}</span>
          <span class="tender-id">${escapeHtml(r.tenderId||'—')}</span>
        </div>
        <div class="c-work">${escapeHtml(truncate(r.work,110))}</div>
        <div class="c-due">
          <span class="d">${fmtDate(r.due)}</span>
          ${tag}
        </div>
        <div class="c-val">
          <span class="amt">${fmtMoney(r.estimate)}</span>
          <span class="lbl">EMD ${fmtMoney(r.emd)}</span>
        </div>
        <div><span class="stamp ${meta.cls}">${meta.label}</span></div>
      `;
      row.addEventListener('click', () => {
        openRow = (openRow === r.sr) ? null : r.sr;
        renderTable();
      });
      wrap.appendChild(row);

      if(openRow === r.sr){
        const detail = document.createElement('div');
        detail.className = 'row open';
        detail.style.display='block';
        detail.innerHTML = `
          <div class="detail" style="display:block;">
            <div class="grid">
              <div>
                <h4>Full Scope of Work</h4>
                <p>${escapeHtml(r.work||'—')}</p>
              </div>
              <div>
                <h4>Status Detail / Filing Note</h4>
                <p>${escapeHtml([r.note, r.statusDetail].filter(Boolean).join(' — ') || 'No update recorded yet.')}</p>
              </div>
              <div>
                <h4>EMD / Eligibility Note</h4>
                <p>${escapeHtml(truncate(r.emdType,400) || '—')}</p>
              </div>
              <div>
                <h4>Financials</h4>
                <p>Estimate: ${fmtMoney(r.estimate)} &nbsp;·&nbsp; EMD: ${fmtMoney(r.emd)}</p>
              </div>
            </div>
          </div>
        `;
        ledger.appendChild(row);
        ledger.appendChild(detail);
      } else {
        ledger.appendChild(row);
      }
    });
  }

  function truncate(s, n){
    if(!s) return s;
    return s.length > n ? s.slice(0,n-1)+'…' : s;
  }
  function escapeHtml(s){
    if(s===null||s===undefined) return '';
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function render(){
    renderStats();
    renderTable();
  }

  document.getElementById('searchInput').addEventListener('input', e => {
    searchTerm = e.target.value;
    openRow = null;
    render();
  });
  document.getElementById('sortSelect').addEventListener('change', e => {
    sortMode = e.target.value;
    render();
  });

  document.getElementById('asof').textContent = TODAY.toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'});

  async function load(){
    const ledger = document.getElementById('ledger');
    ledger.innerHTML = '<div class="empty">Loading tenders…</div>';
    try{
      const res = await fetch('/api/tenders');
      if(!res.ok) throw new Error('Request failed: ' + res.status);
      RAW = await res.json();
      render();
    }catch(err){
      ledger.innerHTML = '<div class="empty">Could not load tenders. Try refreshing the page.</div>';
      console.error(err);
    }
  }

  load();
})();
