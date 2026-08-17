(function(){
  let RAW = [];
  let ROLE = null;

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
    const today = new Date(); today.setHours(0,0,0,0);
    return Math.round((dt - today)/86400000);
  }
  function escapeHtml(s){
    if(s===null||s===undefined) return '';
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function truncate(s, n){
    if(!s) return s;
    return s.length > n ? s.slice(0,n-1)+'…' : s;
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

  const canWrite = () => ROLE === 'admin' || ROLE === 'entry';
  const canDelete = () => ROLE === 'admin';

  function renderTable(){
    const filtered = sortRows(RAW.filter(matches));
    document.getElementById('countShown').textContent = filtered.length;
    document.getElementById('countTotal').textContent = RAW.length;

    const ledger = document.getElementById('ledger');
    ledger.innerHTML = '';

    const withActions = canWrite();

    const head = document.createElement('div');
    head.className = 'row head' + (withActions ? ' hasactions' : '');
    head.innerHTML = `
      <div>Sr</div>
      <div>Organisation</div>
      <div>Scope of Work</div>
      <div>Due</div>
      <div>Estimate</div>
      <div>Status</div>
      ${withActions ? '<div>Actions</div>' : ''}
    `;
    ledger.appendChild(head);

    if(filtered.length === 0){
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = RAW.length === 0 ? 'No tenders logged yet.' : 'No tenders match this filter.';
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

      const row = document.createElement('div');
      row.className = 'row' + (withActions ? ' hasactions' : '') + (openRow === r.id ? ' open':'');
      row.innerHTML = `
        <div class="c-sr">${r.sr ?? ''}</div>
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
        ${withActions ? `<div class="row-actions">
            <button class="btn-edit" data-id="${r.id}">Edit</button>
            ${canDelete() ? `<button class="btn-delete" data-id="${r.id}">Delete</button>` : ''}
          </div>` : ''}
      `;
      row.addEventListener('click', (e) => {
        if(e.target.closest('.row-actions')) return;
        openRow = (openRow === r.id) ? null : r.id;
        renderTable();
      });
      ledger.appendChild(row);

      if(openRow === r.id){
        const detail = document.createElement('div');
        detail.className = 'row open';
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
        ledger.appendChild(detail);
      }
    });

    if(withActions){
      ledger.querySelectorAll('.btn-edit').forEach(btn => {
        btn.addEventListener('click', () => openModal(RAW.find(r => String(r.id) === btn.dataset.id)));
      });
      ledger.querySelectorAll('.btn-delete').forEach(btn => {
        btn.addEventListener('click', () => deleteTender(btn.dataset.id));
      });
    }
  }

  // ---------- Modal ----------
  const modalBackdrop = document.getElementById('modalBackdrop');
  const tenderForm = document.getElementById('tenderForm');

  function openModal(record){
    document.getElementById('modalTitle').textContent = record ? 'Edit Tender' : 'Add Tender';
    document.getElementById('f-id').value = record ? record.id : '';
    document.getElementById('f-org').value = record ? (record.org||'') : '';
    document.getElementById('f-tenderId').value = record ? (record.tenderId||'') : '';
    document.getElementById('f-due').value = record ? (record.due||'') : '';
    document.getElementById('f-status').value = record ? record.status : 'Pending';
    document.getElementById('f-work').value = record ? (record.work||'') : '';
    document.getElementById('f-estimate').value = record && record.estimate !== null ? record.estimate : '';
    document.getElementById('f-emd').value = record && record.emd !== null ? record.emd : '';
    document.getElementById('f-emdType').value = record ? (record.emdType||'') : '';
    document.getElementById('f-note').value = record ? (record.note||'') : '';
    document.getElementById('f-statusDetail').value = record ? (record.statusDetail||'') : '';
    modalBackdrop.classList.add('open');
  }
  function closeModal(){
    modalBackdrop.classList.remove('open');
    tenderForm.reset();
  }

  document.getElementById('addBtn').addEventListener('click', () => openModal(null));
  document.getElementById('modalCancel').addEventListener('click', closeModal);
  modalBackdrop.addEventListener('click', (e) => { if(e.target === modalBackdrop) closeModal(); });

  tenderForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('f-id').value;
    const payload = {
      org: document.getElementById('f-org').value,
      tenderId: document.getElementById('f-tenderId').value,
      due: document.getElementById('f-due').value || null,
      status: document.getElementById('f-status').value,
      work: document.getElementById('f-work').value,
      estimate: document.getElementById('f-estimate').value ? Number(document.getElementById('f-estimate').value) : null,
      emd: document.getElementById('f-emd').value ? Number(document.getElementById('f-emd').value) : null,
      emdType: document.getElementById('f-emdType').value,
      note: document.getElementById('f-note').value,
      statusDetail: document.getElementById('f-statusDetail').value,
    };
    try{
      const res = await fetch(id ? `/api/tenders/${id}` : '/api/tenders', {
        method: id ? 'PUT' : 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(payload)
      });
      if(!res.ok) throw new Error('Save failed');
      closeModal();
      await loadTenders();
    }catch(err){
      alert('Could not save tender. Please try again.');
    }
  });

  async function deleteTender(id){
    if(!confirm('Delete this tender? This cannot be undone.')) return;
    try{
      const res = await fetch(`/api/tenders/${id}`, { method:'DELETE' });
      if(!res.ok) throw new Error('Delete failed');
      openRow = null;
      await loadTenders();
    }catch(err){
      alert('Could not delete tender. Please try again.');
    }
  }

  function render(){
    renderStats();
    renderTable();
  }

  async function loadTenders(){
    const res = await fetch('/api/tenders');
    if(res.status === 401){ window.location.href = '/login'; return; }
    RAW = await res.json();
    render();
  }

  async function init(){
    const who = await fetch('/api/whoami');
    if(who.status === 401){ window.location.href = '/login'; return; }
    const whoData = await who.json();
    ROLE = whoData.role;

    const roleLabel = ROLE === 'admin' ? 'Admin (full access)' : ROLE === 'entry' ? 'Entry (add/edit)' : ROLE;
    const manageLink = ROLE === 'admin' ? ' · <a href="/manage" style="color:rgba(247,243,233,0.6);">Manage</a>' : '';
    document.getElementById('roleTag').innerHTML = `Signed in as: ${roleLabel}${manageLink}`;
    if(canWrite()){
      document.getElementById('addBtn').style.display = 'inline-block';
    }

    document.getElementById('asof').textContent = new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'});

    document.getElementById('searchInput').addEventListener('input', e => {
      searchTerm = e.target.value;
      openRow = null;
      render();
    });
    document.getElementById('sortSelect').addEventListener('change', e => {
      sortMode = e.target.value;
      render();
    });

    await loadTenders();
  }

  init();
})();
