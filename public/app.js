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
  function fmtSize(bytes){
    if(bytes < 1024) return bytes + ' B';
    if(bytes < 1024*1024) return (bytes/1024).toFixed(0) + ' KB';
    return (bytes/(1024*1024)).toFixed(1) + ' MB';
  }

  async function fetchAttachments(tenderId){
    const res = await fetch(`/api/tenders/${tenderId}/attachments`);
    if(!res.ok) return [];
    return res.json();
  }

  function renderAttachList(container, tenderId, list, allowDelete){
    if(list.length === 0){
      container.innerHTML = '<span class="attach-empty">No documents uploaded yet.</span>';
      return;
    }
    container.innerHTML = list.map(a => `
      <div class="attach-item" data-att="${a.id}">
        <div>
          <a href="/api/attachments/${a.id}/download" target="_blank" rel="noopener">${escapeHtml(a.filename)}</a>
          <div class="meta">${fmtSize(a.sizeBytes)} · ${new Date(a.uploadedAt).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}</div>
        </div>
        ${allowDelete ? `<button class="del" data-att-del="${a.id}">Remove</button>` : ''}
      </div>
    `).join('');
    if(allowDelete){
      container.querySelectorAll('[data-att-del]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if(!confirm('Remove this document?')) return;
          try{
            const res = await fetch(`/api/attachments/${btn.dataset.attDel}`, { method:'DELETE' });
            if(!res.ok) throw new Error('failed');
            const list = await fetchAttachments(tenderId);
            renderAttachList(container, tenderId, list, allowDelete);
          }catch(err){
            alert('Could not remove document.');
          }
        });
      });
    }
  }

  async function loadAttachmentsInto(tenderId, container){
    const list = await fetchAttachments(tenderId);
    renderAttachList(container, tenderId, list, canWrite());
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

  const MOBILE_BREAKPOINT = 760;
  const isMobile = () => window.innerWidth <= MOBILE_BREAKPOINT;

  function detailHtml(r){
    return `
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
          <div style="grid-column:1/-1;">
            <h4>Price Bid Documents</h4>
            <div class="attach-list-inline" data-tender="${r.id}">
              <span class="attach-empty">Loading…</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderTable(){
    const filtered = sortRows(RAW.filter(matches));
    document.getElementById('countShown').textContent = filtered.length;
    document.getElementById('countTotal').textContent = RAW.length;

    const ledger = document.getElementById('ledger');
    ledger.innerHTML = '';

    const withActions = canWrite();

    if(filtered.length === 0){
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = RAW.length === 0 ? 'No tenders logged yet.' : 'No tenders match this filter.';
      ledger.appendChild(e);
      return;
    }

    if(isMobile()){
      renderTableMobile(ledger, filtered, withActions);
      return;
    }

    const head = document.createElement('div');
    head.className = 'row head' + (withActions ? ' hasactions' : '');
    head.innerHTML = `
      <div>Sr</div>
      <div>Organisation</div>
      <div>Scope of Work</div>
      <div>Entered</div>
      <div>Due</div>
      <div>Estimate</div>
      <div>Status</div>
      ${withActions ? '<div>Actions</div>' : ''}
    `;
    ledger.appendChild(head);

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
        <div class="c-entered">
          <span class="d">${fmtDate(r.enteredDate)}</span>
        </div>
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
        detail.innerHTML = detailHtml(r);
        ledger.appendChild(detail);
        loadAttachmentsInto(r.id, detail.querySelector('.attach-list-inline'));
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

  function renderTableMobile(ledger, filtered, withActions){
    filtered.forEach(r => {
      const meta = STATUS_META[r.status] || STATUS_META['Pending'];
      const dd = daysDiff(r.due);
      let tag = '';
      if(dd !== null && r.status === 'Pending'){
        if(dd < 0) tag = ` <span class="tag overdue">Overdue ${Math.abs(dd)}d</span>`;
        else if(dd <= 14) tag = ` <span class="tag soon">In ${dd}d</span>`;
      }

      const card = document.createElement('div');
      card.className = 'tcard';
      card.innerHTML = `
        <div class="tcard-top">
          <div class="tcard-title">
            <span class="org-name">${escapeHtml(r.org||'—')}</span>
            <span class="tender-id">${escapeHtml(r.tenderId||'—')}</span>
          </div>
          <span class="stamp ${meta.cls}">${meta.label}</span>
        </div>
        <div class="tcard-work">${escapeHtml(truncate(r.work,140))}</div>
        <div class="tcard-meta">
          <div><span class="m-lbl">Entered</span><span class="m-val">${fmtDate(r.enteredDate)}</span></div>
          <div><span class="m-lbl">Due</span><span class="m-val">${fmtDate(r.due)}${tag}</span></div>
          <div><span class="m-lbl">Estimate</span><span class="m-val">${fmtMoney(r.estimate)}</span></div>
          <div><span class="m-lbl">EMD</span><span class="m-val">${fmtMoney(r.emd)}</span></div>
        </div>
        ${withActions ? `<div class="tcard-actions">
            <button class="btn-edit" data-id="${r.id}">Edit</button>
            ${canDelete() ? `<button class="btn-delete" data-id="${r.id}">Delete</button>` : ''}
          </div>` : ''}
      `;
      card.addEventListener('click', (e) => {
        if(e.target.closest('.tcard-actions')) return;
        openRow = (openRow === r.id) ? null : r.id;
        renderTable();
      });
      ledger.appendChild(card);

      if(openRow === r.id){
        const detail = document.createElement('div');
        detail.className = 'tcard';
        detail.style.paddingTop = '0';
        detail.innerHTML = detailHtml(r);
        ledger.appendChild(detail);
        loadAttachmentsInto(r.id, detail.querySelector('.attach-list-inline'));
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
    document.getElementById('f-enteredDate').value = record ? (record.enteredDate||'') : new Date().toISOString().slice(0,10);
    document.getElementById('f-work').value = record ? (record.work||'') : '';
    document.getElementById('f-estimate').value = record && record.estimate !== null ? record.estimate : '';
    document.getElementById('f-emd').value = record && record.emd !== null ? record.emd : '';
    document.getElementById('f-emdDue').value = record ? (record.emdDue||'') : '';
    document.getElementById('f-emdPaid').value = record && record.emdPaid ? 'true' : 'false';
    document.getElementById('f-emdType').value = record ? (record.emdType||'') : '';
    document.getElementById('f-note').value = record ? (record.note||'') : '';
    document.getElementById('f-statusDetail').value = record ? (record.statusDetail||'') : '';

    const attachSection = document.getElementById('attachSection');
    const attachList = document.getElementById('attachList');
    const attachUploadBtn = document.getElementById('attachUploadBtn');
    const attachFileInput = document.getElementById('attachFileInput');
    attachFileInput.value = '';

    attachSection.style.display = '';
    if(record && record.id){
      attachList.innerHTML = '<span class="attach-empty">Loading…</span>';
      loadAttachmentsInto(record.id, attachList);
      attachUploadBtn.style.display = '';
      attachUploadBtn.textContent = 'Upload File';
      attachUploadBtn.onclick = async () => {
        if(!attachFileInput.files[0]){ alert('Choose a PDF or Excel file first.'); return; }
        const fd = new FormData();
        fd.append('file', attachFileInput.files[0]);
        try{
          const res = await fetch(`/api/tenders/${record.id}/attachments`, { method:'POST', body: fd });
          if(!res.ok){
            const err = await res.json().catch(()=>({}));
            throw new Error(err.error || 'Upload failed');
          }
          attachFileInput.value = '';
          const list = await fetchAttachments(record.id);
          renderAttachList(attachList, record.id, list, canWrite());
        }catch(err){
          alert(err.message || 'Could not upload file.');
        }
      };
    } else {
      attachList.innerHTML = '<span class="attach-empty">Choose a file below — it will be uploaded once you save this tender.</span>';
      attachUploadBtn.style.display = 'none';
    }

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
      enteredDate: document.getElementById('f-enteredDate').value || null,
      work: document.getElementById('f-work').value,
      estimate: document.getElementById('f-estimate').value ? Number(document.getElementById('f-estimate').value) : null,
      emd: document.getElementById('f-emd').value ? Number(document.getElementById('f-emd').value) : null,
      emdDue: document.getElementById('f-emdDue').value || null,
      emdPaid: document.getElementById('f-emdPaid').value === 'true',
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
      const saved = await res.json();

      // For a brand-new tender, upload the picked price bid file (if any) now that we have an id.
      if(!id){
        const attachFileInput = document.getElementById('attachFileInput');
        if(attachFileInput.files[0]){
          const fd = new FormData();
          fd.append('file', attachFileInput.files[0]);
          try{
            const upRes = await fetch(`/api/tenders/${saved.id}/attachments`, { method:'POST', body: fd });
            if(!upRes.ok){
              const err = await upRes.json().catch(()=>({}));
              throw new Error(err.error || 'Upload failed');
            }
          }catch(upErr){
            alert('Tender was saved, but the price bid file could not be uploaded: ' + (upErr.message || 'unknown error'));
          }
        }
      }

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
    renderEmdTable();
  }

  function emdDaysDiff(d){
    if(!d) return null;
    const dt = new Date(d+'T00:00:00');
    const today = new Date(); today.setHours(0,0,0,0);
    return Math.round((dt - today)/86400000);
  }

  async function toggleEmdPaid(id, newVal){
    try{
      const res = await fetch(`/api/tenders/${id}/emd-paid`, {
        method: 'PATCH',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ emdPaid: newVal })
      });
      if(!res.ok) throw new Error('failed');
      await loadTenders();
    }catch(err){
      alert('Could not update EMD status. Please try again.');
    }
  }

  function renderEmdTable(){
    const emdLedger = document.getElementById('emdLedger');
    if(!emdLedger) return;
    emdLedger.innerHTML = '';

    const rows = RAW.filter(r => r.emd !== null && r.emd !== undefined);

    if(rows.length === 0){
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = 'No tenders with an EMD amount recorded yet.';
      emdLedger.appendChild(e);
      return;
    }

    const sorted = rows.slice().sort((a,b) => (a.emdDue||'9999').localeCompare(b.emdDue||'9999'));

    if(isMobile()){
      renderEmdTableMobile(emdLedger, sorted);
      return;
    }

    const head = document.createElement('div');
    head.className = 'emd-row head';
    head.innerHTML = `
      <div>Organisation</div>
      <div>Tender Due</div>
      <div>EMD Due</div>
      <div>EMD Amount</div>
      <div>EMD Status</div>
      <div>Overdue</div>
    `;
    emdLedger.appendChild(head);

    sorted.forEach(r => {
      const dd = emdDaysDiff(r.emdDue);
      let odHtml = '<span class="emd-od ok">—</span>';
      if(!r.emdPaid && dd !== null){
        if(dd < 0) odHtml = `<span class="emd-od bad">${Math.abs(dd)} days</span>`;
        else odHtml = `<span class="emd-od ok">Due in ${dd}d</span>`;
      }

      const row = document.createElement('div');
      row.className = 'emd-row';
      row.innerHTML = `
        <div>
          <span class="org-name">${escapeHtml(r.org||'—')}</span>
          <span class="tender-id">${escapeHtml(r.tenderId||'—')}</span>
        </div>
        <div>${fmtDate(r.due)}</div>
        <div>${fmtDate(r.emdDue)}</div>
        <div class="amt">${fmtMoney(r.emd)}</div>
        <div>
          <button class="emd-pill ${r.emdPaid ? 'paid':'unpaid'}" data-id="${r.id}" data-paid="${r.emdPaid ? '1':'0'}" ${canWrite() ? '' : 'disabled'}>
            ${r.emdPaid ? 'Paid' : 'Unpaid'}
          </button>
        </div>
        <div>${odHtml}</div>
      `;
      emdLedger.appendChild(row);
    });

    if(canWrite()){
      emdLedger.querySelectorAll('.emd-pill').forEach(btn => {
        btn.addEventListener('click', () => {
          const current = btn.dataset.paid === '1';
          toggleEmdPaid(btn.dataset.id, !current);
        });
      });
    }
  }

  function renderEmdTableMobile(emdLedger, sorted){
    sorted.forEach(r => {
      const dd = emdDaysDiff(r.emdDue);
      let odHtml = '—';
      if(!r.emdPaid && dd !== null){
        odHtml = dd < 0 ? `<span class="emd-od bad">${Math.abs(dd)} days</span>` : `<span class="emd-od ok">Due in ${dd}d</span>`;
      }

      const card = document.createElement('div');
      card.className = 'tcard';
      card.innerHTML = `
        <div class="tcard-top">
          <div class="tcard-title">
            <span class="org-name">${escapeHtml(r.org||'—')}</span>
            <span class="tender-id">${escapeHtml(r.tenderId||'—')}</span>
          </div>
          <button class="emd-pill ${r.emdPaid ? 'paid':'unpaid'}" data-id="${r.id}" data-paid="${r.emdPaid ? '1':'0'}" ${canWrite() ? '' : 'disabled'}>
            ${r.emdPaid ? 'Paid' : 'Unpaid'}
          </button>
        </div>
        <div class="tcard-meta">
          <div><span class="m-lbl">Tender Due</span><span class="m-val">${fmtDate(r.due)}</span></div>
          <div><span class="m-lbl">EMD Due</span><span class="m-val">${fmtDate(r.emdDue)}</span></div>
          <div><span class="m-lbl">EMD Amount</span><span class="m-val">${fmtMoney(r.emd)}</span></div>
          <div><span class="m-lbl">Overdue</span><span class="m-val">${odHtml}</span></div>
        </div>
      `;
      emdLedger.appendChild(card);
    });

    if(canWrite()){
      emdLedger.querySelectorAll('.emd-pill').forEach(btn => {
        btn.addEventListener('click', () => {
          const current = btn.dataset.paid === '1';
          toggleEmdPaid(btn.dataset.id, !current);
        });
      });
    }
  }

  // ---------- Tabs ----------
  document.getElementById('tabDashboard').addEventListener('click', () => {
    document.getElementById('tabDashboard').classList.add('active');
    document.getElementById('tabEmd').classList.remove('active');
    document.getElementById('dashboardView').style.display = '';
    document.getElementById('emdView').style.display = 'none';
  });
  document.getElementById('tabEmd').addEventListener('click', () => {
    document.getElementById('tabEmd').classList.add('active');
    document.getElementById('tabDashboard').classList.remove('active');
    document.getElementById('dashboardView').style.display = 'none';
    document.getElementById('emdView').style.display = '';
  });

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

    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(render, 150);
    });
  }

  init();
})();
