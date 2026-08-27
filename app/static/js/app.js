/* ==========================================================================
   Retail Demand Prediction System — Hackathon Problem 8 Logic
   ========================================================================== */

let forecastChart, historyChart, simChart;
let currentProducts = [];
let currentStores = [];
let lastKnownVersion = null;
let currentTrendView = 'daily'; // 'daily' or 'weekly'
let currentUser = { authenticated: false, role: 'Viewer', username: 'Guest' };
const POLL_INTERVAL_MS = 8000;

// Simulation State
let simPromoDates = new Set();
let simFestDates = new Set();

async function fetchJSON(url, opts = {}) {
  try {
    const res = await fetch(url, opts);
    const data = await res.json();
    return data;
  } catch (err) {
    console.error('Fetch error:', url, err);
    return { error: err.message };
  }
}

function fmtMoney(n) {
  return '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function getSelectedStoreId() {
  const sel = document.getElementById('globalStoreSelect');
  return sel ? sel.value : 'all';
}

// ---------------------------------------------------------------------------
// Tabs Navigation
// ---------------------------------------------------------------------------
document.querySelectorAll('#mainTabs .nav-link').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#mainTabs .nav-link').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('d-none'));
    const tabId = btn.dataset.tab;
    const tabEl = document.getElementById(tabId);
    if (tabEl) tabEl.classList.remove('d-none');

    if (tabId === 'factorsTab') loadFactorsAndHiddenCases();
    if (tabId === 'reorderTab') loadReorderData();
    if (tabId === 'simulatorTab') initSimulatorTab();
    if (tabId === 'manageTab') loadManagementData();
  });
});

// ---------------------------------------------------------------------------
// Authentication & User Context
// ---------------------------------------------------------------------------
async function checkAuth() {
  const data = await fetchJSON('/api/auth/me');
  currentUser = data;
  document.getElementById('navUsername').textContent = data.username;
  document.getElementById('navRoleBadge').textContent = data.role;
  document.getElementById('navRoleBadge').className =
    data.role === 'Admin' ? 'badge bg-danger text-light px-1' :
    data.role === 'Manager' ? 'badge bg-primary text-light px-1' : 'badge bg-secondary text-light px-1';

  const authBtn = document.getElementById('authBtn');
  if (data.authenticated) {
    authBtn.innerHTML = '<i class="bi bi-box-arrow-right me-1"></i> Log Out';
    authBtn.onclick = handleLogout;
    authBtn.removeAttribute('data-bs-toggle');
    authBtn.removeAttribute('data-bs-target');
  } else {
    authBtn.innerHTML = '<i class="bi bi-box-arrow-in-right me-1"></i> Log In';
    authBtn.onclick = null;
    authBtn.setAttribute('data-bs-toggle', 'modal');
    authBtn.setAttribute('data-bs-target', '#loginModal');
  }
}

document.getElementById('loginSubmitBtn')?.addEventListener('click', async () => {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value.trim();
  const errDiv = document.getElementById('loginError');

  errDiv.classList.add('d-none');
  const res = await fetchJSON('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });

  if (res.error) {
    errDiv.textContent = res.error;
    errDiv.classList.remove('d-none');
  } else {
    const modalEl = document.getElementById('loginModal');
    const modal = bootstrap.Modal.getInstance(modalEl);
    if (modal) modal.hide();
    await checkAuth();
    await pollForChanges(true);
  }
});

async function handleLogout() {
  await fetchJSON('/api/auth/logout', { method: 'POST' });
  await checkAuth();
  await pollForChanges(true);
}

// ---------------------------------------------------------------------------
// Store & Product Selectors
// ---------------------------------------------------------------------------
async function loadStores() {
  currentStores = await fetchJSON('/api/stores');
  const sel = document.getElementById('globalStoreSelect');
  const modalSel = document.getElementById('poModalStoreSelect');
  if (!Array.isArray(currentStores)) return;

  const currentVal = sel.value;
  sel.innerHTML = '<option value="all">All Stores (Consolidated)</option>' +
    currentStores.map(s => `<option value="${s.store_id}">${s.name} (${s.store_id})</option>`).join('');
  if (currentVal) sel.value = currentVal;

  if (modalSel) {
    modalSel.innerHTML = currentStores.map(s => `<option value="${s.store_id}">${s.name}</option>`).join('');
  }
}

async function loadProducts() {
  currentProducts = await fetchJSON('/api/products');
  if (!Array.isArray(currentProducts)) return;

  const sel = document.getElementById('productSelect');
  const simSel = document.getElementById('simProductSelect');
  const sfSel = document.getElementById('sf_product');
  const poProdSel = document.getElementById('poModalProductSelect');

  const prev = sel.value;
  const options = currentProducts.map(p => `<option value="${p.product_id}">${p.name}</option>`).join('');

  if (sel) { sel.innerHTML = options; if (currentProducts.some(p => p.product_id === prev)) sel.value = prev; }
  if (simSel) simSel.innerHTML = options;
  if (sfSel) sfSel.innerHTML = currentProducts.map(p => `<option value="${p.product_id}">${p.name} (${p.product_id})</option>`).join('');
  if (poProdSel) poProdSel.innerHTML = options;
}

// ---------------------------------------------------------------------------
// Tab 1: Dashboard & Recommendations (Section 10 & 11)
// ---------------------------------------------------------------------------
async function loadOverview() {
  const storeId = getSelectedStoreId();
  const data = await fetchJSON(`/api/overview?store_id=${storeId}`);
  if (data.error) return;

  document.getElementById('dateRangeLabel').textContent = data.date_range && data.date_range[0]
    ? `Data Window: ${data.date_range[0]} → ${data.date_range[1]}` : 'No records yet';

  const kpis = [
    { label: 'Products Tracked', value: data.total_products, icon: 'bi-box-seam text-primary' },
    { label: 'Sales Records (Step 1)', value: data.total_records.toLocaleString(), icon: 'bi-database-check text-info' },
    { label: 'Total Units Sold', value: data.total_units_sold.toLocaleString(), icon: 'bi-bar-chart-fill text-success' },
    { label: 'Total Revenue', value: fmtMoney(data.total_revenue), icon: 'bi-currency-rupee text-warning' },
    { label: 'Cleaned Gaps (Step 2)', value: `${data.data_quality.missing_records_filled} records`, icon: 'bi-shield-check text-secondary' },
  ];

  document.getElementById('kpiRow').innerHTML = kpis.map(k => `
    <div class="col-6 col-md-4 col-xl">
      <div class="kpi-card">
        <div class="d-flex justify-content-between align-items-center">
          <div class="kpi-value">${k.value}</div>
          <i class="bi ${k.icon} fs-4"></i>
        </div>
        <div class="kpi-label">${k.label}</div>
      </div>
    </div>`).join('');

  return data.version;
}

async function loadAlerts() {
  const storeId = getSelectedStoreId();
  const horizon = document.getElementById('horizonSelect').value;
  const alerts = await fetchJSON(`/api/alerts?horizon=${horizon}&store_id=${storeId}`);
  const body = document.getElementById('alertsBody');

  if (!Array.isArray(alerts) || !alerts.length) {
    body.innerHTML = '<div class="text-center text-muted p-4">No inventory alerts found.</div>';
    return;
  }

  // Render cards exactly following Section 11 Example Recommendation Format
  body.innerHTML = alerts.map(a => {
    const cls = a.status === 'Stock-Out Risk' ? 'stockout' : a.status === 'Overstock Risk' ? 'overstock' : 'balanced';
    const badgeCls = a.status === 'Stock-Out Risk' ? 'stockout-badge' : a.status === 'Overstock Risk' ? 'overstock-badge' : 'balanced-badge';
    const lowConf = a.low_confidence ? '<span class="low-confidence-pill">category baseline</span>' : '';

    return `
      <div class="alert-item ${cls} mb-3">
        <div class="d-flex justify-content-between align-items-start mb-2">
          <div>
            <div class="small text-muted text-uppercase fw-bold" style="font-size:0.7rem;">Product</div>
            <h6 class="fw-bold mb-0 text-slate-900">${a.product_name} ${lowConf}</h6>
          </div>
          <span class="status-badge ${badgeCls}">${a.status}</span>
        </div>

        <div class="row g-2 mb-2 py-2 px-1 bg-light rounded-3 small">
          <div class="col-6">
            <span class="text-muted">Predicted demand:</span> <strong>${a.predicted_demand_horizon} units</strong> (next ${a.lead_time_days || horizon}D)
          </div>
          <div class="col-6">
            <span class="text-muted">Current stock:</span> <strong>${a.current_stock} units</strong>
          </div>
        </div>

        <div class="mb-1 small">
          <span class="fw-bold text-slate-800">Recommendation:</span> <span class="text-slate-700">${a.recommendation || a.alert || 'Monitor inventory'}</span>
        </div>

        <div class="small text-muted">
          <span class="fw-bold text-slate-700">Reason:</span> ${a.reason}
        </div>

        ${a.status === 'Stock-Out Risk' ? `
          <div class="mt-2 pt-2 border-top d-flex justify-content-end">
            <button class="btn btn-xs btn-outline-danger py-1 px-3 small rounded-3 fw-medium" onclick="openPoModalForProduct('${a.product_id}')">
              <i class="bi bi-cart-plus me-1"></i> Replenish Stock
            </button>
          </div>` : ''}
      </div>`;
  }).join('');
}

async function loadForecast(productId, festivalDates = []) {
  if (!productId) return;
  const storeId = getSelectedStoreId();
  const festParam = festivalDates.length ? `&festivals=${festivalDates.join(',')}` : '';
  const data = await fetchJSON(`/api/predict/${productId}?horizon=14&store_id=${storeId}${festParam}`);
  if (!data || data.error) return;

  const ctx = document.getElementById('forecastChart');
  if (forecastChart) forecastChart.destroy();
  forecastChart = new Chart(ctx, {
    data: {
      labels: data.forecast.map(f => f.date),
      datasets: [
        {
          type: 'line',
          label: 'Baseline (Normal Daily Demand)',
          data: data.forecast.map(f => f.baseline_demand),
          borderColor: '#94a3b8',
          borderWidth: 2,
          borderDash: [5, 5],
          pointRadius: 3,
          fill: false,
        },
        {
          type: 'bar',
          label: 'Predicted Demand (with Event Spikes)',
          data: data.forecast.map(f => f.predicted_demand),
          backgroundColor: data.forecast.map(f => (f.is_festival || f.is_promotion) ? '#f59e0b' : '#2563eb'),
          borderRadius: 6,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, font: { family: 'Inter' } } },
        tooltip: {
          callbacks: {
            footer: (items) => {
              const idx = items[0].dataIndex;
              const f = data.forecast[idx];
              return f.event_uplift > 0 ? `⚡ Special-Event Demand Uplift: +${f.event_uplift} units` : '';
            }
          }
        }
      },
      scales: {
        y: { beginAtZero: true, grid: { color: '#f1f5f9' } },
        x: { grid: { display: false } }
      }
    }
  });

  const totalUplift = data.forecast.reduce((s, f) => s + f.event_uplift, 0);
  const upliftNote = document.getElementById('eventUpliftNote');
  if (totalUplift > 0.5) {
    upliftNote.classList.remove('d-none');
    document.getElementById('eventUpliftText').innerHTML =
      `<strong>Section 7 Handled:</strong> Special event detected! Predicted demand is <strong>+${totalUplift.toFixed(1)} units</strong> above baseline. The model isolates the spike and does NOT treat it as new normal daily demand.`;
  } else {
    upliftNote.classList.add('d-none');
  }

  const lowConfNote = document.getElementById('lowConfidenceNote');
  if (data.low_confidence) {
    lowConfNote.classList.remove('d-none');
  } else {
    lowConfNote.classList.add('d-none');
  }
}

async function loadHistory(productId) {
  if (!productId) return;
  const storeId = getSelectedStoreId();
  let dataUrl = currentTrendView === 'weekly'
    ? `/api/demand/weekly?product_id=${productId}&store_id=${storeId}`
    : `/api/demand/daily?product_id=${productId}&store_id=${storeId}`;

  const data = await fetchJSON(dataUrl);
  if (!Array.isArray(data)) return;

  const recent = data.slice(-50);
  const labels = recent.map(d => (currentTrendView === 'weekly' ? `Wk of ${d.week.slice(0,10)}` : d.date));
  const values = recent.map(d => (currentTrendView === 'weekly' ? d.weekly_demand : d.daily_demand));

  const ctx = document.getElementById('historyChart');
  if (historyChart) historyChart.destroy();
  historyChart = new Chart(ctx, {
    type: currentTrendView === 'weekly' ? 'bar' : 'line',
    data: {
      labels: labels,
      datasets: [{
        label: currentTrendView === 'weekly' ? 'Weekly Units Sold' : 'Daily Units Sold',
        data: values,
        borderColor: '#0284c7',
        backgroundColor: currentTrendView === 'weekly' ? 'rgba(2, 132, 199, 0.6)' : 'rgba(2, 132, 199, 0.08)',
        fill: true,
        tension: 0.3,
        pointRadius: 2,
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { maxTicksLimit: 8 }, grid: { display: false } },
        y: { beginAtZero: true, grid: { color: '#f1f5f9' } }
      }
    }
  });
}

async function loadMovers() {
  const storeId = getSelectedStoreId();
  const movers = await fetchJSON(`/api/movers?store_id=${storeId}`);
  const tbody = document.querySelector('#moversTable tbody');
  if (!Array.isArray(movers) || !movers.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-3">No mover data available.</td></tr>';
    return;
  }

  tbody.innerHTML = movers.map(m => {
    const badgeClass = m.movement_class === 'Fast-Moving' ? 'bg-success-subtle text-success fw-bold' :
                        m.movement_class === 'Slow-Moving' ? 'bg-danger-subtle text-danger fw-bold' : 'bg-warning-subtle text-warning';
    return `
      <tr>
        <td class="fw-semibold text-slate-800">${m.product_name}</td>
        <td><span class="badge bg-slate-100 text-slate-700">${m.category}</span></td>
        <td><strong>${m.avg_daily_demand}</strong> units/day</td>
        <td><span class="badge ${badgeClass} rounded-pill">${m.movement_class}</span></td>
      </tr>`;
  }).join('');
}

function refreshProductViews() {
  const productId = document.getElementById('productSelect').value;
  loadHistory(productId);
  loadForecast(productId);
}

async function refreshDashboard() {
  await loadOverview();
  await loadAlerts();
  await loadMovers();
  refreshProductViews();
}

// ---------------------------------------------------------------------------
// Tab 3: 7 Factors & Hidden Test Cases Inspector (Section 3 & 8)
// ---------------------------------------------------------------------------
async function loadFactorsAndHiddenCases() {
  const storeId = getSelectedStoreId();
  const factors = await fetchJSON(`/api/factors/analysis?store_id=${storeId}`);
  const hiddenCases = await fetchJSON('/api/hidden-test-cases/verify');

  // Render 7 Factors
  const container = document.getElementById('factorsAnalysisContainer');
  if (factors.weekends) {
    container.innerHTML = `
      <div class="row g-3">
        <div class="col-md-4">
          <div class="p-3 bg-light rounded-4 border">
            <h6 class="fw-bold text-primary mb-1"><i class="bi bi-calendar-week me-1"></i> 1. Weekends</h6>
            <div class="small text-muted mb-2">Weekend demand vs Weekday demand</div>
            <div class="d-flex justify-content-between align-items-center">
              <span>Weekend Avg: <strong>${factors.weekends.avg_weekend}</strong></span>
              <span class="badge bg-primary">+${factors.weekends.uplift_pct}% Surge</span>
            </div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="p-3 bg-light rounded-4 border">
            <h6 class="fw-bold text-warning mb-1"><i class="bi bi-calendar-event me-1"></i> 2. Festivals</h6>
            <div class="small text-muted mb-2">Spike multiplier on festival dates</div>
            <div class="d-flex justify-content-between align-items-center">
              <span>Festival Avg: <strong>${factors.festivals.avg_festival}</strong></span>
              <span class="badge bg-warning text-dark">${factors.festivals.multiplier}x Demand</span>
            </div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="p-3 bg-light rounded-4 border">
            <h6 class="fw-bold text-success mb-1"><i class="bi bi-cash-coin me-1"></i> 3. Salary Periods</h6>
            <div class="small text-muted mb-2">1st-5th of month purchasing power</div>
            <div class="d-flex justify-content-between align-items-center">
              <span>Salary Days Avg: <strong>${factors.salary_period.avg_salary_days}</strong></span>
              <span class="badge bg-success">+${factors.salary_period.uplift_pct}% Uplift</span>
            </div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="p-3 bg-light rounded-4 border">
            <h6 class="fw-bold text-info mb-1"><i class="bi bi-tag-fill me-1"></i> 4. Promotions</h6>
            <div class="small text-muted mb-2">Active promotional campaigns</div>
            <div class="d-flex justify-content-between align-items-center">
              <span>Promo Avg: <strong>${factors.promotions.avg_promo}</strong></span>
              <span class="badge bg-info text-white">${factors.promotions.multiplier}x Surge</span>
            </div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="p-3 bg-light rounded-4 border">
            <h6 class="fw-bold text-secondary mb-1"><i class="bi bi-cloud-sun me-1"></i> 5. Weather Conditions</h6>
            <div class="small text-muted mb-2">Demand distribution by weather</div>
            <div class="small">
              ${Object.entries(factors.weather || {}).map(([w, v]) => `<strong>${w}:</strong> ${v} units`).join(' &bull; ')}
            </div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="p-3 bg-light rounded-4 border">
            <h6 class="fw-bold text-purple mb-1"><i class="bi bi-geo-alt-fill me-1"></i> 6 & 7. Holidays & Local Events</h6>
            <div class="small text-muted mb-2">Special declared holiday impact</div>
            <div class="d-flex justify-content-between align-items-center">
              <span>Holiday Avg: <strong>${factors.holidays.avg_holiday}</strong></span>
              <span class="badge bg-dark">+${factors.holidays.uplift_pct}%</span>
            </div>
          </div>
        </div>
      </div>`;
  }

  // Render 7 Hidden Test Cases Table
  const tbody = document.getElementById('hiddenCasesBody');
  if (hiddenCases) {
    tbody.innerHTML = Object.values(hiddenCases).map(c => `
      <tr>
        <td class="fw-bold text-slate-900">${c.name}</td>
        <td>
          <div class="text-slate-800">${c.solution}</div>
          ${c.proof ? `<div class="text-muted small mt-1"><em>${c.proof}</em></div>` : ''}
          ${c.excluded_count !== undefined ? `<span class="badge bg-slate-100 text-slate-700 mt-1">${c.excluded_count} censored rows excluded from training</span>` : ''}
          ${c.filled_count !== undefined ? `<span class="badge bg-slate-100 text-slate-700 mt-1">${c.filled_count} missing date gaps filled</span>` : ''}
          ${c.anomaly_count !== undefined ? `<span class="badge bg-slate-100 text-slate-700 mt-1">${c.anomaly_count} statistical anomalies excluded</span>` : ''}
        </td>
        <td><span class="badge bg-success-subtle text-success border border-success-subtle px-2 py-1"><i class="bi bi-check-circle-fill me-1"></i> ${c.status}</span></td>
      </tr>`).join('');
  }
}

// ---------------------------------------------------------------------------
// Tab 4: Reorder & Purchase Orders (Req #24, #26)
// ---------------------------------------------------------------------------
async function loadReorderData() {
  const storeId = getSelectedStoreId();
  const recommendations = await fetchJSON(`/api/reorder/recommendations?store_id=${storeId}`);
  const tbody = document.getElementById('reorderTableBody');

  if (!Array.isArray(recommendations) || !recommendations.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">No replenishment recommendations available.</td></tr>';
    return;
  }

  tbody.innerHTML = recommendations.map(r => {
    const urgencyBadge = r.urgency === 'High' ? 'bg-danger text-white' :
                          r.urgency === 'Medium' ? 'bg-warning text-dark' : 'bg-success-subtle text-success';
    return `
      <tr>
        <td>
          <div class="fw-bold text-slate-900">${r.product_name}</div>
          <span class="badge ${urgencyBadge}" style="font-size:0.65rem;">${r.urgency} Urgency</span>
        </td>
        <td>
          <div class="text-slate-800 small">${r.supplier_name}</div>
          <div class="text-muted" style="font-size:0.75rem;">Lead Time: <strong>${r.lead_time_days} days</strong> | MOQ: ${r.moq}</div>
        </td>
        <td>
          <div>Stock: <strong>${r.current_stock}</strong> / ROP: <strong>${r.reorder_point}</strong></div>
          <div class="text-muted" style="font-size:0.75rem;">Safety Buffer: ${r.safety_stock} units</div>
        </td>
        <td>
          <span class="badge bg-slate-100 text-slate-800">${r.days_stock_remaining} days</span>
        </td>
        <td>
          <strong class="${r.reorder_needed ? 'text-danger' : 'text-slate-700'}">${r.suggested_order_qty} units</strong>
        </td>
        <td>${fmtMoney(r.estimated_order_cost)}</td>
        <td>
          <div>${r.reorder_by_date}</div>
          <div class="text-muted" style="font-size:0.72rem;">Arrival: ${r.expected_arrival_date}</div>
        </td>
        <td>
          <button class="btn btn-sm ${r.reorder_needed ? 'btn-primary' : 'btn-outline-secondary'} rounded-3 py-1 px-3"
                  onclick="triggerDirectPo('${r.product_id}', ${r.suggested_order_qty || r.moq})">
            <i class="bi bi-cart-plus me-1"></i> Order
          </button>
        </td>
      </tr>`;
  }).join('');

  await loadPurchaseOrdersList();
}

async function loadPurchaseOrdersList() {
  const storeId = getSelectedStoreId();
  const orders = await fetchJSON(`/api/po/list?store_id=${storeId}`);
  const tbody = document.getElementById('poTableBody');

  if (!Array.isArray(orders) || !orders.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-4">No purchase orders found.</td></tr>';
    return;
  }

  document.getElementById('poBadgeCount').textContent = orders.length;
  document.getElementById('poBadgeCount').classList.remove('d-none');

  tbody.innerHTML = orders.map(po => {
    const statusCls = po.status === 'Pending' ? 'bg-warning text-dark' :
                      po.status === 'Approved' ? 'bg-info text-white' :
                      po.status === 'Ordered' ? 'bg-primary text-white' :
                      po.status === 'Received' ? 'bg-success text-white' : 'bg-secondary text-white';

    return `
      <tr>
        <td class="fw-bold">${po.po_id}</td>
        <td>${po.store_name}</td>
        <td>${po.product_name}</td>
        <td>${po.supplier_name}</td>
        <td><strong>${po.order_qty}</strong></td>
        <td>${po.order_date}</td>
        <td>${po.expected_date || 'N/A'}</td>
        <td><span class="badge ${statusCls}">${po.status}</span></td>
        <td>
          <select class="form-select form-select-sm py-0 ps-1" onchange="updatePoStatus('${po.po_id}', this.value)">
            <option value="">Update...</option>
            <option value="Pending">Pending</option>
            <option value="Approved">Approved</option>
            <option value="Ordered">Ordered</option>
            <option value="Received">Received</option>
            <option value="Cancelled">Cancelled</option>
          </select>
        </td>
      </tr>`;
  }).join('');
}

async function triggerDirectPo(productId, qty) {
  const storeId = getSelectedStoreId() === 'all' ? 'S001' : getSelectedStoreId();
  const res = await fetchJSON('/api/po/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ product_id: productId, store_id: storeId, order_qty: qty, notes: 'Automated ROP recommendation trigger' })
  });

  if (res.error) {
    alert(res.error);
  } else {
    alert(`Purchase Order ${res.po.po_id} created successfully!`);
    await loadPurchaseOrdersList();
  }
}

function openPoModalForProduct(productId) {
  document.querySelector('[data-tab=reorderTab]').click();
  const prodSel = document.getElementById('poModalProductSelect');
  if (prodSel) prodSel.value = productId;
  const modal = new bootstrap.Modal(document.getElementById('customPoModal'));
  modal.show();
}

document.getElementById('poModalSubmitBtn')?.addEventListener('click', async () => {
  const store_id = document.getElementById('poModalStoreSelect').value;
  const product_id = document.getElementById('poModalProductSelect').value;
  const order_qty = parseFloat(document.getElementById('poModalQty').value || 0);
  const notes = document.getElementById('poModalNotes').value;

  if (!product_id || order_qty <= 0) {
    alert('Please choose a product and enter a valid quantity.');
    return;
  }

  const res = await fetchJSON('/api/po/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ store_id, product_id, order_qty, notes })
  });

  if (res.error) {
    alert(res.error);
  } else {
    const modal = bootstrap.Modal.getInstance(document.getElementById('customPoModal'));
    if (modal) modal.hide();
    alert(`Purchase Order created successfully!`);
    await loadPurchaseOrdersList();
  }
});

async function updatePoStatus(poId, newStatus) {
  if (!newStatus) return;
  const res = await fetchJSON('/api/po/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ po_id: poId, status: newStatus })
  });
  if (res.error) {
    if (res.status_code === 401 || res.status_code === 403 || res.error.includes('Unauthorized') || res.error.includes('Forbidden')) {
      alert('Updating Purchase Order status requires Manager or Admin privileges. Please click Log In (top-right) and sign in as manager or admin.');
      const modalEl = document.getElementById('loginModal');
      if (modalEl) {
        const modal = new bootstrap.Modal(modalEl);
        modal.show();
      }
    } else {
      alert(res.error);
    }
  } else {
    alert(`Purchase Order ${poId} status updated to ${newStatus}`);
  }
  await loadPurchaseOrdersList();
}

// ---------------------------------------------------------------------------
// Tab 5: What-If Simulator (Req #28)
// ---------------------------------------------------------------------------
function initSimulatorTab() {
  const discRange = document.getElementById('simDiscountRange');
  discRange.addEventListener('input', () => {
    document.getElementById('discountValLabel').textContent = `${discRange.value}%`;
  });

  document.getElementById('addSimPromoDateBtn').onclick = () => {
    const d = document.getElementById('simPromoDate').value;
    if (d) {
      simPromoDates.add(d);
      renderSimTags();
    }
  };

  document.getElementById('addSimFestDateBtn').onclick = () => {
    const d = document.getElementById('simFestDate').value;
    if (d) {
      simFestDates.add(d);
      renderSimTags();
    }
  };

  document.getElementById('runSimBtn').onclick = executeSimulation;
}

function renderSimTags() {
  document.getElementById('simPromoDatesList').innerHTML = Array.from(simPromoDates).map(d =>
    `<span class="badge bg-primary text-white py-1 px-2">${d} <span style="cursor:pointer;" onclick="simPromoDates.delete('${d}');renderSimTags();">&times;</span></span>`
  ).join('');

  document.getElementById('simFestDatesList').innerHTML = Array.from(simFestDates).map(d =>
    `<span class="badge bg-warning text-dark py-1 px-2">${d} <span style="cursor:pointer;" onclick="simFestDates.delete('${d}');renderSimTags();">&times;</span></span>`
  ).join('');
}

async function executeSimulation() {
  const product_id = document.getElementById('simProductSelect').value;
  const horizon = parseInt(document.getElementById('simHorizonSelect').value);
  const discount_pct = parseFloat(document.getElementById('simDiscountRange').value);
  const store_id = getSelectedStoreId();

  const payload = {
    product_id,
    horizon,
    discount_pct,
    promo_dates: Array.from(simPromoDates),
    festival_dates: Array.from(simFestDates),
    store_id: store_id === 'all' ? null : store_id,
  };

  const res = await fetchJSON('/api/simulate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (res.error) { alert(res.error); return; }

  const kpisHtml = `
    <div class="col-md-3">
      <div class="kpi-card text-center">
        <div class="kpi-value text-primary">${res.total_simulated_demand}</div>
        <div class="kpi-label">Projected Demand (${horizon}D)</div>
        <div class="small text-muted mt-1">vs ${res.total_baseline_demand} baseline</div>
      </div>
    </div>
    <div class="col-md-3">
      <div class="kpi-card text-center">
        <div class="kpi-value text-success">+${res.net_demand_uplift}</div>
        <div class="kpi-label">Simulated Demand Uplift</div>
        <div class="small text-muted mt-1">+${((res.net_demand_uplift / (res.total_baseline_demand || 1))*100).toFixed(0)}% campaign surge</div>
      </div>
    </div>
    <div class="col-md-3">
      <div class="kpi-card text-center">
        <div class="kpi-value ${res.revenue_delta >= 0 ? 'text-success' : 'text-danger'}">${fmtMoney(res.revenue_delta)}</div>
        <div class="kpi-label">Revenue Impact (Delta)</div>
        <div class="small text-muted mt-1">Total: ${fmtMoney(res.simulated_revenue)}</div>
      </div>
    </div>
    <div class="col-md-3">
      <div class="kpi-card text-center">
        <div class="kpi-value ${res.stock_shortfall > 0 ? 'text-danger' : 'text-success'}">${res.stock_shortfall}</div>
        <div class="kpi-label">Projected Shortfall Units</div>
        <div class="small text-muted mt-1">${res.risk_assessment}</div>
      </div>
    </div>`;
  document.getElementById('simKpisRow').innerHTML = kpisHtml;

  const ctx = document.getElementById('simChart');
  if (simChart) simChart.destroy();
  simChart = new Chart(ctx, {
    data: {
      labels: res.timeline.map(t => t.date),
      datasets: [
        {
          type: 'line',
          label: 'Normal Baseline Demand',
          data: res.timeline.map(t => t.baseline_demand),
          borderColor: '#94a3b8',
          borderDash: [5, 5],
          pointRadius: 2,
          fill: false,
        },
        {
          type: 'bar',
          label: 'Simulated Campaign Demand',
          data: res.timeline.map(t => t.simulated_demand),
          backgroundColor: res.timeline.map(t => (t.is_promotion || t.is_festival) ? '#f59e0b' : '#2563eb'),
          borderRadius: 6,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom' } },
      scales: { y: { beginAtZero: true } }
    }
  });
}

// ---------------------------------------------------------------------------
// Tab 6: Management, CRUD & Admin
// ---------------------------------------------------------------------------
async function loadManagementData() {
  await loadProductsMgmt();
  await loadAuditLogs();
}

async function loadProductsMgmt() {
  const products = await fetchJSON('/api/manage/products');
  const tbody = document.getElementById('productsMgmtBody');
  if (!Array.isArray(products)) return;

  tbody.innerHTML = products.map(p => `
    <tr>
      <td class="fw-bold">${p.product_id}</td>
      <td>${p.name}</td>
      <td><span class="badge bg-slate-100 text-slate-700">${p.category}</span></td>
      <td>${fmtMoney(p.price)}</td>
      <td>${p.supplier_name || 'SUP01'}</td>
      <td><button class="btn btn-xs btn-outline-danger py-0 px-2" onclick="deleteProduct('${p.product_id}')">✕</button></td>
    </tr>`).join('');
}

async function deleteProduct(id) {
  if (!confirm(`Delete product ${id} and all associated sales records?`)) return;
  const res = await fetchJSON(`/api/manage/products/${id}`, { method: 'DELETE' });
  if (res.error) { alert(res.error); return; }
  await loadProductsMgmt();
  await loadProducts();
  await pollForChanges(true);
}

document.getElementById('pf_submit')?.addEventListener('click', async () => {
  const payload = {
    product_id: document.getElementById('pf_id').value.trim(),
    name: document.getElementById('pf_name').value.trim(),
    category: document.getElementById('pf_category').value.trim(),
    price: parseFloat(document.getElementById('pf_price').value || 0),
    initial_stock: parseFloat(document.getElementById('pf_stock').value || 0),
    supplier_id: document.getElementById('pf_supplier').value,
  };
  if (!payload.product_id || !payload.name || !payload.category) {
    alert('Product ID, name, and category are required.');
    return;
  }
  const res = await fetchJSON('/api/manage/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (res.error) { alert(res.error); return; }
  ['pf_id', 'pf_name', 'pf_category', 'pf_price', 'pf_stock'].forEach(id => document.getElementById(id).value = '');
  await loadProductsMgmt();
  await loadProducts();
  await pollForChanges(true);
});

document.getElementById('sf_submit')?.addEventListener('click', async () => {
  const payload = {
    store_id: document.getElementById('sf_store').value,
    product_id: document.getElementById('sf_product').value,
    date: document.getElementById('sf_date').value,
    quantity_sold: parseFloat(document.getElementById('sf_qty').value || 0),
    current_stock: parseFloat(document.getElementById('sf_stock').value || 0),
    festival_event: document.getElementById('sf_festival').value.trim(),
    promotion: document.getElementById('sf_promo').checked ? 1 : 0,
  };
  if (!payload.product_id || !payload.date) {
    alert('Product and date are required.');
    return;
  }
  const res = await fetchJSON('/api/manage/sales', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (res.error) { alert(res.error); return; }
  ['sf_date', 'sf_qty', 'sf_stock', 'sf_festival'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('sf_promo').checked = false;
  alert('Sale record added.');
  await pollForChanges(true);
});

async function loadAuditLogs() {
  const logs = await fetchJSON('/api/audit?limit=50');
  const tbody = document.getElementById('auditLogsBody');
  if (!Array.isArray(logs) || !logs.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-3">No audit trail records found.</td></tr>';
    return;
  }

  tbody.innerHTML = logs.map(l => `
    <tr>
      <td class="text-muted" style="font-size:0.75rem;">${l.timestamp}</td>
      <td class="fw-semibold">${l.username}</td>
      <td><span class="badge bg-slate-100 text-slate-800">${l.action}</span></td>
      <td>${l.entity_type} ${l.entity_id ? `(${l.entity_id})` : ''}</td>
      <td class="text-muted small">${l.details || ''}</td>
    </tr>`).join('');
}

// CSV Upload
document.getElementById('uploadBtn')?.addEventListener('click', async () => {
  const fileInput = document.getElementById('csvFile');
  const mode = document.getElementById('uploadMode').value;
  const resultDiv = document.getElementById('uploadResult');
  if (!fileInput.files.length) { alert('Select a CSV file first.'); return; }

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  formData.append('mode', mode);

  resultDiv.innerHTML = '<span class="text-primary"><i class="bi bi-arrow-repeat spin me-1"></i> Ingesting and retraining pipeline...</span>';
  const res = await fetchJSON('/api/upload', { method: 'POST', body: formData });

  if (res.error) {
    resultDiv.innerHTML = `<span class="text-danger">${res.error}</span>`;
  } else {
    resultDiv.innerHTML = `<span class="text-success">Ingested ${res.rows_ingested} rows (${res.mode}). Pipeline refreshed!</span>`;
    fileInput.value = '';
    await pollForChanges(true);
  }
});

document.getElementById('retrainBtn')?.addEventListener('click', async () => {
  const res = await fetchJSON('/api/retrain', { method: 'POST' });
  if (res.error) { alert(res.error); }
  else { alert('Forced retrain triggered in background worker.'); await pollForChanges(true); }
});

document.getElementById('backupDbBtn')?.addEventListener('click', async () => {
  const res = await fetchJSON('/api/manage/backup', { method: 'POST' });
  if (res.error) alert(res.error);
  else alert(`Database snapshot backup created successfully at: ${res.backup_path}`);
});

// Export Handlers
document.getElementById('exportPdfAlerts')?.addEventListener('click', (e) => {
  e.preventDefault();
  window.open(`/api/export/pdf?type=alerts&store_id=${getSelectedStoreId()}`, '_blank');
});

document.getElementById('exportPdfMovers')?.addEventListener('click', (e) => {
  e.preventDefault();
  window.open(`/api/export/pdf?type=movers&store_id=${getSelectedStoreId()}`, '_blank');
});

document.getElementById('exportCsvRaw')?.addEventListener('click', (e) => {
  e.preventDefault();
  window.open(`/api/export/csv?type=sales&store_id=${getSelectedStoreId()}`, '_blank');
});

document.getElementById('exportCsvOrders')?.addEventListener('click', (e) => {
  e.preventDefault();
  window.open(`/api/export/csv?type=orders&store_id=${getSelectedStoreId()}`, '_blank');
});

// ---------------------------------------------------------------------------
// Live Polling & Init
// ---------------------------------------------------------------------------
async function pollForChanges(force = false) {
  try {
    const status = await fetchJSON('/api/status');
    const badge = document.getElementById('liveBadge');
    if (force || lastKnownVersion === null || status.version !== lastKnownVersion) {
      lastKnownVersion = status.version;
      badge.textContent = 'LIVE';
      badge.className = 'status-indicator-badge live';
      await refreshDashboard();
    }
  } catch (e) {
    const badge = document.getElementById('liveBadge');
    if (badge) {
      badge.textContent = 'OFFLINE';
      badge.className = 'status-indicator-badge offline';
    }
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await checkAuth();
  await loadStores();
  await loadProducts();
  await refreshDashboard();

  try {
    const status = await fetchJSON('/api/status');
    if (status && status.version !== undefined) {
      lastKnownVersion = status.version;
    }
  } catch (e) {}

  document.getElementById('globalStoreSelect')?.addEventListener('change', () => {
    refreshDashboard();
    if (!document.getElementById('reorderTab')?.classList.contains('d-none')) {
      loadReorderData();
    }
    if (!document.getElementById('factorsTab')?.classList.contains('d-none')) {
      loadFactorsAndHiddenCases();
    }
  });

  document.getElementById('productSelect')?.addEventListener('change', refreshProductViews);
  document.getElementById('horizonSelect')?.addEventListener('change', loadAlerts);
  document.getElementById('applyFestivalBtn')?.addEventListener('click', () => {
    const date = document.getElementById('festivalDate')?.value;
    const productId = document.getElementById('productSelect')?.value;
    if (date && productId) loadForecast(productId, [date]);
  });

  // Daily / Weekly radio toggle
  document.getElementById('dailyTrendRadio')?.addEventListener('change', () => {
    currentTrendView = 'daily';
    const pid = document.getElementById('productSelect')?.value;
    if (pid) loadHistory(pid);
  });
  document.getElementById('weeklyTrendRadio')?.addEventListener('change', () => {
    currentTrendView = 'weekly';
    const pid = document.getElementById('productSelect')?.value;
    if (pid) loadHistory(pid);
  });

  setInterval(() => pollForChanges(false), POLL_INTERVAL_MS);
});
