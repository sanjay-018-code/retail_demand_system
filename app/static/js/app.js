/* ==========================================================================
   RetailPulse AI — Enhanced Frontend Architecture & Logic
   Enterprise Demand Forecasting, 7 Drivers, ML Diagnostics, Smart PO & What-If
   ========================================================================== */

let forecastChart, historyChart, simChart;
let currentProducts = [];
let currentStores = [];
let lastKnownVersion = null;
let currentTrendView = 'daily';
let currentUser = { authenticated: false, role: 'Viewer', username: 'Guest' };
let currentFactorsData = null;
const POLL_INTERVAL_MS = 8000;

// Simulation State
let simPromoDates = new Set();
let simFestDates = new Set();

// ---------------------------------------------------------------------------
// Toast Notification Helper
// ---------------------------------------------------------------------------
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast-notification';
  
  let icon = 'bi-info-circle-fill text-primary';
  if (type === 'success') icon = 'bi-check-circle-fill text-success';
  if (type === 'warning') icon = 'bi-exclamation-triangle-fill text-warning';
  if (type === 'danger') icon = 'bi-x-circle-fill text-danger';

  toast.innerHTML = `
    <i class="bi ${icon} fs-5"></i>
    <div class="small fw-medium flex-grow-1">${message}</div>
    <button type="button" class="btn-close btn-close-sm" style="font-size:0.7rem;"></button>
  `;

  const closeBtn = toast.querySelector('.btn-close');
  closeBtn.addEventListener('click', () => {
    toast.classList.add('hide');
    setTimeout(() => toast.remove(), 300);
  });

  container.appendChild(toast);
  setTimeout(() => {
    if (toast.parentElement) {
      toast.classList.add('hide');
      setTimeout(() => toast.remove(), 300);
    }
  }, 4000);
}

// ---------------------------------------------------------------------------
// Theme Management (Light / Dark Mode)
// ---------------------------------------------------------------------------
function initTheme() {
  const savedTheme = localStorage.getItem('retailpulse_theme') || 'light';
  applyTheme(savedTheme);

  const toggleBtn = document.getElementById('themeToggleBtn');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'light';
      const next = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      localStorage.setItem('retailpulse_theme', next);
      showToast(`Switched to ${next === 'dark' ? 'Dark' : 'Light'} Mode`, 'info');
    });
  }
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const icon = document.getElementById('themeToggleIcon');
  if (icon) {
    icon.className = theme === 'dark' ? 'bi bi-sun-fill text-warning' : 'bi bi-moon-stars-fill text-white';
  }
  // Re-render charts with updated theme palette if initialized
  if (forecastChart || historyChart || simChart) {
    refreshChartsTheme();
  }
}

function getChartColors() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  return {
    text: isDark ? '#94a3b8' : '#64748b',
    grid: isDark ? 'rgba(51, 65, 85, 0.4)' : 'rgba(226, 232, 240, 0.6)',
    cardBg: isDark ? '#111827' : '#ffffff',
  };
}

function refreshChartsTheme() {
  const c = getChartColors();
  [forecastChart, historyChart, simChart].forEach(chart => {
    if (!chart) return;
    if (chart.options.scales?.x) {
      chart.options.scales.x.ticks.color = c.text;
      chart.options.scales.x.grid.color = c.grid;
    }
    if (chart.options.scales?.y) {
      chart.options.scales.y.ticks.color = c.text;
      chart.options.scales.y.grid.color = c.grid;
    }
    chart.update('none');
  });
}

// ---------------------------------------------------------------------------
// Network Fetch Helper
// ---------------------------------------------------------------------------
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

    if (tabId === 'driversTab') loadDemandDriversTab();
    if (tabId === 'diagnosticsTab') loadDiagnosticsTab();
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
    showToast(`Signed in as ${res.user.username} (${res.user.role})`, 'success');
    await checkAuth();
    await pollForChanges(true);
  }
});

async function handleLogout() {
  await fetchJSON('/api/auth/logout', { method: 'POST' });
  showToast('Logged out successfully', 'info');
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
  const driverSkuSel = document.getElementById('driverSkuSelect');
  const sfSel = document.getElementById('sf_product');
  const poProdSel = document.getElementById('poModalProductSelect');

  const prev = sel.value;
  const options = currentProducts.map(p => `<option value="${p.product_id}">${p.name} (${p.product_id})</option>`).join('');

  if (sel) { sel.innerHTML = options; if (currentProducts.some(p => p.product_id === prev)) sel.value = prev; }
  if (simSel) simSel.innerHTML = options;
  if (driverSkuSel) driverSkuSel.innerHTML = options;
  if (sfSel) sfSel.innerHTML = currentProducts.map(p => `<option value="${p.product_id}">${p.name} (${p.product_id})</option>`).join('');
  if (poProdSel) poProdSel.innerHTML = options;
}

// ---------------------------------------------------------------------------
// Tab 1: Dashboard & Recommendations
// ---------------------------------------------------------------------------
async function renderOverview() {
  const storeId = getSelectedStoreId();
  const data = await fetchJSON(`/api/overview?store_id=${storeId}`);
  if (data.error) return;

  const kpiRow = document.getElementById('kpiRow');
  kpiRow.innerHTML = `
    <div class="col-xl-3 col-md-6">
      <div class="kpi-card-v2 kpi-emerald">
        <div class="d-flex justify-content-between align-items-start">
          <div>
            <div class="kpi-label-v2">Total Active SKUs</div>
            <div class="kpi-value-v2">${data.total_products}</div>
          </div>
          <span class="kpi-icon-pill" style="background: rgba(16, 185, 129, 0.15); color: #10b981;">
            <i class="bi bi-box-seam"></i>
          </span>
        </div>
        <div class="small text-muted mt-2">Active catalog entries</div>
      </div>
    </div>
    <div class="col-xl-3 col-md-6">
      <div class="kpi-card-v2">
        <div class="d-flex justify-content-between align-items-start">
          <div>
            <div class="kpi-label-v2">Sales Volume (Units)</div>
            <div class="kpi-value-v2">${Number(data.total_units_sold).toLocaleString('en-IN')}</div>
          </div>
          <span class="kpi-icon-pill" style="background: rgba(79, 70, 229, 0.15); color: #4f46e5;">
            <i class="bi bi-cart-check"></i>
          </span>
        </div>
        <div class="small text-muted mt-2">Historical units cleared</div>
      </div>
    </div>
    <div class="col-xl-3 col-md-6">
      <div class="kpi-card-v2 kpi-purple">
        <div class="d-flex justify-content-between align-items-start">
          <div>
            <div class="kpi-label-v2">Total Gross Revenue</div>
            <div class="kpi-value-v2">${fmtMoney(data.total_revenue)}</div>
          </div>
          <span class="kpi-icon-pill" style="background: rgba(139, 92, 246, 0.15); color: #8b5cf6;">
            <i class="bi bi-cash-coin"></i>
          </span>
        </div>
        <div class="small text-muted mt-2">Aggregate transaction value</div>
      </div>
    </div>
    <div class="col-xl-3 col-md-6">
      <div class="kpi-card-v2 kpi-amber">
        <div class="d-flex justify-content-between align-items-start">
          <div>
            <div class="kpi-label-v2">Cleaned Data Quality</div>
            <div class="kpi-value-v2">${data.data_quality ? data.data_quality.total_rows_after_cleaning : 0}</div>
          </div>
          <span class="kpi-icon-pill" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b;">
            <i class="bi bi-shield-check"></i>
          </span>
        </div>
        <div class="small text-muted mt-2">${data.data_quality ? data.data_quality.missing_records_filled : 0} calendar gaps resolved</div>
      </div>
    </div>
  `;

  const dRange = data.date_range;
  if (dRange && dRange[0] && dRange[1]) {
    document.getElementById('dateRangeLabel').textContent = `Data Horizon: ${dRange[0]} to ${dRange[1]}`;
  }
}

async function renderAlerts() {
  const horizon = document.getElementById('horizonSelect')?.value || 7;
  const storeId = getSelectedStoreId();
  const alerts = await fetchJSON(`/api/alerts?horizon=${horizon}&store_id=${storeId}`);
  const container = document.getElementById('alertsBody');
  if (!Array.isArray(alerts) || alerts.length === 0) {
    container.innerHTML = `<div class="text-center text-muted p-5">No active stock alerts found.</div>`;
    return;
  }

  container.innerHTML = alerts.map(a => {
    let cssClass = 'balanced';
    let badgeClass = 'badge-balanced';
    let icon = 'bi-check-circle text-success';
    if (a.status === 'Stock-Out Risk') {
      cssClass = 'stockout';
      badgeClass = 'badge-stockout';
      icon = 'bi-exclamation-octagon text-danger';
    } else if (a.status === 'Overstock Risk') {
      cssClass = 'overstock';
      badgeClass = 'badge-overstock';
      icon = 'bi-exclamation-triangle text-warning';
    }

    return `
      <div class="alert-item-v2 ${cssClass}">
        <div class="d-flex justify-content-between align-items-start mb-2">
          <div>
            <strong class="d-block" style="font-size: 0.92rem;">${a.product_name}</strong>
            <span class="text-muted small" style="font-size: 0.75rem;">SKU: ${a.product_id} &bull; Store: ${a.store_id || 'S001'}</span>
          </div>
          <span class="badge rounded-pill px-3 py-1 ${badgeClass}">${a.status}</span>
        </div>
        <div class="d-flex justify-content-between small text-muted my-2 p-2 rounded-3" style="background: var(--bg-subtle);">
          <div>Current Stock: <strong class="text-main">${a.current_stock}</strong></div>
          <div>${horizon}D Predicted Demand: <strong class="text-main">${a.predicted_demand_horizon}</strong></div>
        </div>
        ${a.alert ? `<div class="small fw-semibold text-danger mt-1"><i class="bi ${icon} me-1"></i> ${a.alert}</div>` : ''}
      </div>
    `;
  }).join('');
}

async function renderForecast() {
  const productSelect = document.getElementById('productSelect');
  if (!productSelect || !productSelect.value) return;

  const productId = productSelect.value;
  const festivalDate = document.getElementById('festivalDate')?.value;
  const storeId = getSelectedStoreId();
  const horizon = 7;

  let url = `/api/predict/${productId}?horizon=${horizon}&store_id=${storeId}`;
  if (festivalDate) url += `&festivals=${festivalDate}`;

  const data = await fetchJSON(url);
  if (data.error) return;

  const noteEl = document.getElementById('eventUpliftNote');
  const noteText = document.getElementById('eventUpliftText');
  const lowConfNote = document.getElementById('lowConfidenceNote');

  if (data.event_uplift_detected) {
    noteEl.classList.remove('d-none');
    noteText.innerHTML = `<strong>Special Event Uplift Active:</strong> Baseline demand of ${data.total_baseline_demand} units increased to <strong>${data.total_predicted_demand} units</strong> (+${data.event_uplift_pct}%) on declared event days.`;
  } else {
    noteEl.classList.add('d-none');
  }

  if (data.low_confidence) {
    lowConfNote.classList.remove('d-none');
  } else {
    lowConfNote.classList.add('d-none');
  }

  const labels = data.forecast.map(f => f.date);
  const baselineValues = data.forecast.map(f => f.baseline_demand);
  const predictedValues = data.forecast.map(f => f.predicted_demand);

  const colors = getChartColors();
  const ctx = document.getElementById('forecastChart').getContext('2d');
  if (forecastChart) forecastChart.destroy();

  forecastChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Baseline Demand (Normal)',
          data: baselineValues,
          borderColor: '#64748b',
          backgroundColor: 'transparent',
          borderDash: [5, 5],
          borderWidth: 2,
          pointRadius: 3,
          tension: 0.3
        },
        {
          label: 'Event/Promo Adjusted Demand',
          data: predictedValues,
          borderColor: '#4f46e5',
          backgroundColor: 'rgba(79, 70, 229, 0.08)',
          fill: true,
          borderWidth: 3,
          pointRadius: 4,
          pointBackgroundColor: '#4f46e5',
          tension: 0.3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { color: colors.text, boxWidth: 12, usePointStyle: true } },
        tooltip: { padding: 10, cornerRadius: 8 }
      },
      scales: {
        x: { ticks: { color: colors.text }, grid: { color: colors.grid } },
        y: { ticks: { color: colors.text }, grid: { color: colors.grid }, title: { display: true, text: 'Units / Day', color: colors.text } }
      }
    }
  });
}

async function renderHistory() {
  const productSelect = document.getElementById('productSelect');
  if (!productSelect || !productSelect.value) return;

  const productId = productSelect.value;
  const storeId = getSelectedStoreId();
  const endpoint = currentTrendView === 'daily' ?
    `/api/demand/daily?product_id=${productId}&store_id=${storeId}` :
    `/api/demand/weekly?product_id=${productId}&store_id=${storeId}`;

  const data = await fetchJSON(endpoint);
  if (!Array.isArray(data)) return;

  const labels = data.map(d => currentTrendView === 'daily' ? d.date : d.week);
  const values = data.map(d => d.total_quantity_sold);

  const colors = getChartColors();
  const ctx = document.getElementById('historyChart').getContext('2d');
  if (historyChart) historyChart.destroy();

  historyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: `${currentTrendView === 'daily' ? 'Daily' : 'Weekly'} Sales (Units)`,
        data: values,
        backgroundColor: 'rgba(6, 182, 212, 0.65)',
        borderColor: '#06b6d4',
        borderWidth: 1,
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { padding: 10, cornerRadius: 8 }
      },
      scales: {
        x: { ticks: { color: colors.text, maxTicksLimit: 14 }, grid: { display: false } },
        y: { ticks: { color: colors.text }, grid: { color: colors.grid } }
      }
    }
  });
}

async function renderMovers() {
  const storeId = getSelectedStoreId();
  const movers = await fetchJSON(`/api/movers?store_id=${storeId}`);
  const tbody = document.querySelector('#moversTable tbody');
  if (!Array.isArray(movers) || movers.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted py-3">No product data available.</td></tr>`;
    return;
  }

  tbody.innerHTML = movers.map(m => {
    let pillClass = 'bg-secondary';
    if (m.movement_class === 'Fast-Moving') pillClass = 'bg-success';
    if (m.movement_class === 'Slow-Moving') pillClass = 'bg-danger';

    return `
      <tr>
        <td class="fw-semibold">${m.product_name} <span class="text-muted small">(${m.product_id})</span></td>
        <td>${m.category}</td>
        <td><strong>${m.avg_daily_demand}</strong> u/day</td>
        <td><span class="badge rounded-pill ${pillClass}">${m.movement_class}</span></td>
      </tr>
    `;
  }).join('');
}

// ---------------------------------------------------------------------------
// TAB 2: 7 DEMAND DRIVERS & SEASONALITY (NEW!)
// ---------------------------------------------------------------------------
async function loadDemandDriversTab() {
  const storeId = getSelectedStoreId();
  const productSelect = document.getElementById('driverSkuSelect');
  const productId = productSelect?.value || '';

  let url = `/api/factors/analysis?store_id=${storeId}`;
  if (productId) url += `&product_id=${productId}`;

  const data = await fetchJSON(url);
  currentFactorsData = data;
  if (!data || data.error) return;

  // 1. Weekend Variation
  const wk = data.weekends || {};
  document.getElementById('weekendUpliftBadge').textContent = `${wk.uplift_pct >= 0 ? '+' : ''}${wk.uplift_pct}%`;
  document.getElementById('weekendAvgSales').textContent = `${wk.avg_weekend || 0} units`;
  document.getElementById('weekdayAvgSales').textContent = `${wk.avg_weekday || 0} units`;

  // 2. Festival & Events
  const fest = data.festivals || {};
  document.getElementById('festMultiplierBadge').textContent = `${fest.multiplier || 1.0}x Surge`;
  document.getElementById('festAvgSales').textContent = `${fest.avg_festival || 0} units`;
  document.getElementById('festNormalSales').textContent = `${fest.avg_normal || 0} units`;

  // 3. Salary Period
  const sal = data.salary_period || {};
  document.getElementById('salaryUpliftBadge').textContent = `${sal.uplift_pct >= 0 ? '+' : ''}${sal.uplift_pct}%`;
  document.getElementById('salaryAvgSales').textContent = `${sal.avg_salary_days || 0} units`;
  document.getElementById('salaryNormalSales').textContent = `${sal.avg_other_days || 0} units`;

  // 4. Holidays
  const hol = data.holidays || {};
  document.getElementById('holidayUpliftBadge').textContent = `${hol.uplift_pct >= 0 ? '+' : ''}${hol.uplift_pct}%`;
  document.getElementById('holidayAvgSales').textContent = `${hol.avg_holiday || 0} units`;
  document.getElementById('holidayNormalSales').textContent = `${hol.avg_normal || 0} units`;

  // 5. Weather Sensitivity Breakdown
  const weatherList = document.getElementById('weatherBreakdownList');
  const wData = data.weather || {};
  if (Object.keys(wData).length === 0) {
    weatherList.innerHTML = `<div class="text-muted small text-center py-2">No weather data recorded.</div>`;
  } else {
    weatherList.innerHTML = Object.entries(wData).map(([condition, avg]) => `
      <div class="d-flex justify-content-between align-items-center p-2 rounded-3" style="background: var(--bg-subtle);">
        <span class="small fw-semibold"><i class="bi bi-cloud me-2 text-info"></i>${condition}</span>
        <span class="fw-bold text-main">${avg} units</span>
      </div>
    `).join('');
  }

  // 6 & 7. Promos & Events
  const promo = data.promotions || {};
  document.getElementById('promoMultiplierBadge').textContent = `${promo.multiplier || 1.0}x Surge`;
  document.getElementById('promoAvgSales').textContent = `${promo.avg_promo || 0} units`;
  document.getElementById('promoNormalSales').textContent = `${promo.avg_normal || 0} units`;

  updateDriverCalculator();
}

function updateDriverCalculator() {
  if (!currentFactorsData) return;
  const cond = document.getElementById('driverConditionSelect')?.value || 'normal';
  const wk = currentFactorsData.weekends || {};
  const fest = currentFactorsData.festivals || {};
  const sal = currentFactorsData.salary_period || {};
  const promo = currentFactorsData.promotions || {};

  const base = wk.avg_weekday || 20.0;
  let mult = 1.0;

  if (cond === 'weekend') mult = (wk.avg_weekend / base) || 1.35;
  if (cond === 'salary') mult = (1 + (sal.uplift_pct || 25) / 100);
  if (cond === 'promo') mult = promo.multiplier || 1.45;
  if (cond === 'festival') mult = fest.multiplier || 1.85;
  if (cond === 'rainy') mult = 0.90;
  if (cond === 'combined') mult = (wk.avg_weekend / base || 1.35) * (promo.multiplier || 1.4) * (fest.multiplier || 1.7);

  const projected = (base * mult).toFixed(1);
  document.getElementById('driverProjectedVal').textContent = `${projected} units / day`;
  document.getElementById('driverMultiplierTag').textContent = `${mult.toFixed(2)}x Baseline Multiplier`;
}

document.getElementById('driverConditionSelect')?.addEventListener('change', updateDriverCalculator);
document.getElementById('driverSkuSelect')?.addEventListener('change', loadDemandDriversTab);

// ---------------------------------------------------------------------------
// TAB 3: ML DIAGNOSTICS & TEST CASE PROOFS (NEW!)
// ---------------------------------------------------------------------------
async function loadDiagnosticsTab() {
  const metricsData = await fetchJSON('/api/model/metrics');
  const testCasesData = await fetchJSON('/api/hidden-test-cases/verify');

  // Metrics
  if (metricsData && metricsData.current_metrics) {
    const m = metricsData.current_metrics;
    document.getElementById('diagMae').textContent = `${m.mae} units`;
    document.getElementById('diagRmse').textContent = `${m.rmse} units`;
    document.getElementById('diagVersionId').textContent = m.version_id;
    document.getElementById('diagTrainRows').textContent = `${m.training_rows} clean rows`;
    
    const gateBadge = document.getElementById('diagGateBadge');
    if (m.accepted) {
      gateBadge.className = 'badge bg-success rounded-pill px-3 py-1';
      gateBadge.textContent = 'VALIDATED & ACTIVE';
    } else {
      gateBadge.className = 'badge bg-danger rounded-pill px-3 py-1';
      gateBadge.textContent = 'GATE REJECTED (HIGH ERROR)';
    }
  }

  // Feature Importances
  const fiContainer = document.getElementById('featureImportanceContainer');
  if (metricsData && metricsData.feature_importances && metricsData.feature_importances.length > 0) {
    fiContainer.innerHTML = metricsData.feature_importances.map(f => `
      <div>
        <div class="d-flex justify-content-between small fw-semibold mb-1">
          <span class="text-main">${f.feature}</span>
          <span class="text-primary">${f.importance}%</span>
        </div>
        <div class="importance-bar-track">
          <div class="importance-bar-fill" style="width: ${Math.min(f.importance * 2.5, 100)}%;"></div>
        </div>
      </div>
    `).join('');
  } else {
    fiContainer.innerHTML = `<div class="text-muted small text-center py-3">No feature weights available yet.</div>`;
  }

  // 7 Hidden Test Cases Verification Cards
  const tcGrid = document.getElementById('testCasesGrid');
  if (testCasesData && !testCasesData.error) {
    tcGrid.innerHTML = Object.entries(testCasesData).map(([key, tc]) => `
      <div class="col-lg-6">
        <div class="test-case-card h-100">
          <div class="d-flex justify-content-between align-items-start mb-2">
            <h6 class="fw-bold mb-0 text-main" style="font-size:0.9rem;">${tc.name}</h6>
            <span class="badge rounded-pill bg-success px-2 py-1">${tc.status}</span>
          </div>
          <p class="small text-muted mb-2">${tc.solution}</p>
          ${tc.proof ? `<div class="small fw-semibold text-primary"><i class="bi bi-check2-circle me-1"></i>${tc.proof}</div>` : ''}
          ${tc.excluded_count !== undefined ? `<div class="small text-muted">Filtered Censored/Anomaly Rows: <strong>${tc.excluded_count}</strong></div>` : ''}
          ${tc.anomaly_count !== undefined ? `<div class="small text-muted">Outliers Cleared: <strong>${tc.anomaly_count}</strong></div>` : ''}
          ${tc.filled_count !== undefined ? `<div class="small text-muted">Calendar Gaps Auto-Filled: <strong>${tc.filled_count}</strong></div>` : ''}
        </div>
      </div>
    `).join('');
  }

  // Historical Versions Table
  const vBody = document.getElementById('diagVersionsTableBody');
  if (metricsData && Array.isArray(metricsData.historical_versions)) {
    vBody.innerHTML = metricsData.historical_versions.map(v => `
      <tr>
        <td class="fw-semibold text-primary">${v.version_id}</td>
        <td>${v.mae || '--'}</td>
        <td>${v.rmse || '--'}</td>
        <td>${v.sample_count || '--'}</td>
        <td>${v.trained_at || '--'}</td>
        <td>
          <span class="badge rounded-pill ${v.is_active ? 'bg-success' : 'bg-secondary'}">
            ${v.is_active ? 'Active Deployed' : 'Archived'}
          </span>
        </td>
        <td>
          ${v.is_active ? '<span class="text-muted small">Current</span>' : `
            <button class="btn btn-xs btn-outline-warning rounded-3 px-2 py-0" onclick="rollbackModel('${v.version_id}')">
              Rollback
            </button>
          `}
        </td>
      </tr>
    `).join('');
  }
}

async function rollbackModel(versionId) {
  if (currentUser.role !== 'Admin') {
    showToast('Admin privilege required for model rollback', 'danger');
    return;
  }
  const res = await fetchJSON(`/api/model/rollback/${versionId}`, { method: 'POST' });
  if (res.error) {
    showToast(`Rollback failed: ${res.error}`, 'danger');
  } else {
    showToast(`Successfully rolled back to version ${versionId}`, 'success');
    await loadDiagnosticsTab();
    await pollForChanges(true);
  }
}

// ---------------------------------------------------------------------------
// TAB 4: REORDER & SMART PURCHASE ORDERS
// ---------------------------------------------------------------------------
async function loadReorderData() {
  const storeId = getSelectedStoreId();
  const recommendations = await fetchJSON(`/api/reorder/recommendations?store_id=${storeId}`);
  const poList = await fetchJSON(`/api/po/list?store_id=${storeId}`);

  // Reorder Table
  const reorderBody = document.getElementById('reorderTableBody');
  if (!Array.isArray(recommendations) || recommendations.length === 0) {
    reorderBody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4">All SKU inventory levels are within safe operating thresholds.</td></tr>`;
  } else {
    reorderBody.innerHTML = recommendations.map(r => {
      let urgencyBadge = '<span class="badge bg-success">Optimal</span>';
      if (r.days_remaining <= 3) urgencyBadge = '<span class="badge bg-danger">Critical (&lt;3D)</span>';
      else if (r.days_remaining <= 7) urgencyBadge = '<span class="badge bg-warning text-dark">High (4-7D)</span>';

      return `
        <tr>
          <td class="fw-semibold">${r.product_name} <span class="text-muted small">(${r.product_id})</span></td>
          <td>${r.supplier_id || 'SUP01'} <span class="badge bg-light text-dark border ms-1">${r.lead_time_days}D Lead</span></td>
          <td><strong class="text-main">${r.current_stock}</strong> / ${r.reorder_point}</td>
          <td>${urgencyBadge}</td>
          <td>${r.days_remaining} days</td>
          <td><strong class="text-primary">${r.suggested_order_qty}</strong> units</td>
          <td>${fmtMoney(r.suggested_order_qty * (r.unit_price || 50))}</td>
          <td>
            <button class="btn btn-sm btn-primary rounded-3 px-3 py-1" onclick="quickCreatePo('${r.product_id}', '${r.suggested_order_qty}')">
              <i class="bi bi-cart-plus me-1"></i> Order
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  // Active POs
  const poBody = document.getElementById('poTableBody');
  const poBadge = document.getElementById('poBadgeCount');
  if (!Array.isArray(poList) || poList.length === 0) {
    poBody.innerHTML = `<tr><td colspan="9" class="text-center text-muted py-4">No purchase orders created yet.</td></tr>`;
    poBadge.classList.add('d-none');
  } else {
    const pendingCount = poList.filter(p => p.status === 'Pending').length;
    if (pendingCount > 0) {
      poBadge.textContent = pendingCount;
      poBadge.classList.remove('d-none');
    } else {
      poBadge.classList.add('d-none');
    }

    poBody.innerHTML = poList.map(po => {
      let statusBadge = 'bg-secondary';
      if (po.status === 'Approved') statusBadge = 'bg-info text-dark';
      if (po.status === 'Ordered') statusBadge = 'bg-primary';
      if (po.status === 'Received') statusBadge = 'bg-success';
      if (po.status === 'Cancelled') statusBadge = 'bg-danger';

      return `
        <tr>
          <td class="fw-semibold text-primary">${po.po_id}</td>
          <td>${po.store_name || po.store_id}</td>
          <td>${po.product_name}</td>
          <td>${po.supplier_name || po.supplier_id}</td>
          <td><strong>${po.order_qty}</strong></td>
          <td>${po.order_date}</td>
          <td>${po.expected_date || '--'}</td>
          <td><span class="badge rounded-pill ${statusBadge}">${po.status}</span></td>
          <td>
            <select class="form-select form-select-sm rounded-3 py-0" style="font-size:0.75rem;" onchange="updatePoStatus('${po.po_id}', this.value)">
              <option value="Pending" ${po.status === 'Pending' ? 'selected' : ''}>Pending</option>
              <option value="Approved" ${po.status === 'Approved' ? 'selected' : ''}>Approved</option>
              <option value="Ordered" ${po.status === 'Ordered' ? 'selected' : ''}>Ordered</option>
              <option value="Received" ${po.status === 'Received' ? 'selected' : ''}>Received</option>
              <option value="Cancelled" ${po.status === 'Cancelled' ? 'selected' : ''}>Cancelled</option>
            </select>
          </td>
        </tr>
      `;
    }).join('');
  }
}

async function quickCreatePo(productId, qty) {
  if (currentUser.role === 'Viewer') {
    showToast('Manager or Admin permissions required to generate POs.', 'warning');
    return;
  }
  const storeId = getSelectedStoreId();
  const res = await fetchJSON('/api/po/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      product_id: productId,
      order_qty: qty,
      store_id: storeId === 'all' ? 'S001' : storeId,
      notes: 'Automated ROP replenishment trigger'
    })
  });

  if (res.error) {
    showToast(`Failed creating PO: ${res.error}`, 'danger');
  } else {
    showToast(`Created Purchase Order #${res.po.po_id} for ${qty} units!`, 'success');
    await loadReorderData();
  }
}

async function updatePoStatus(poId, newStatus) {
  if (currentUser.role === 'Viewer') {
    showToast('Manager or Admin permissions required to update PO status.', 'warning');
    return;
  }
  const res = await fetchJSON('/api/po/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ po_id: poId, status: newStatus })
  });

  if (res.error) {
    showToast(`Status update failed: ${res.error}`, 'danger');
  } else {
    showToast(`PO #${poId} status updated to ${newStatus}`, 'success');
    await loadReorderData();
  }
}

document.getElementById('batchApprovePoBtn')?.addEventListener('click', async () => {
  if (currentUser.role === 'Viewer') {
    showToast('Manager or Admin permissions required for batch approval.', 'warning');
    return;
  }
  const res = await fetchJSON('/api/po/batch-approve', { method: 'POST' });
  if (res.error) {
    showToast(`Batch approval failed: ${res.error}`, 'danger');
  } else {
    showToast(`Successfully approved ${res.approved_count} pending purchase orders!`, 'success');
    await loadReorderData();
  }
});

// ---------------------------------------------------------------------------
// TAB 5: WHAT-IF SCENARIO SIMULATOR
// ---------------------------------------------------------------------------
function initSimulatorTab() {
  const discountRange = document.getElementById('simDiscountRange');
  const discountLabel = document.getElementById('discountValLabel');
  if (discountRange && discountLabel) {
    discountRange.oninput = () => {
      discountLabel.textContent = `${discountRange.value}%`;
    };
  }
}

document.getElementById('addSimPromoDateBtn')?.addEventListener('click', () => {
  const input = document.getElementById('simPromoDate');
  if (input && input.value) {
    simPromoDates.add(input.value);
    renderSimDateTags('simPromoDatesList', simPromoDates);
  }
});

document.getElementById('addSimFestDateBtn')?.addEventListener('click', () => {
  const input = document.getElementById('simFestDate');
  if (input && input.value) {
    simFestDates.add(input.value);
    renderSimDateTags('simFestDatesList', simFestDates);
  }
});

function renderSimDateTags(containerId, set) {
  const c = document.getElementById(containerId);
  if (!c) return;
  c.innerHTML = Array.from(set).map(d => `
    <span class="badge bg-primary-subtle text-primary rounded-pill px-2 py-1 d-inline-flex align-items-center gap-1">
      ${d} <i class="bi bi-x-circle cursor-pointer" onclick="removeSimDate('${containerId}', '${d}')"></i>
    </span>
  `).join('');
}

function removeSimDate(containerId, dateStr) {
  if (containerId === 'simPromoDatesList') simPromoDates.delete(dateStr);
  if (containerId === 'simFestDatesList') simFestDates.delete(dateStr);
  renderSimDateTags(containerId, containerId === 'simPromoDatesList' ? simPromoDates : simFestDates);
}

document.getElementById('runSimBtn')?.addEventListener('click', async () => {
  const productId = document.getElementById('simProductSelect')?.value;
  const horizon = parseInt(document.getElementById('simHorizonSelect')?.value || '14', 10);
  const discountPct = parseFloat(document.getElementById('simDiscountRange')?.value || '15');
  const storeId = getSelectedStoreId();

  const payload = {
    product_id: productId,
    horizon,
    discount_pct: discountPct,
    promo_dates: Array.from(simPromoDates),
    festival_dates: Array.from(simFestDates),
    store_id: storeId
  };

  const res = await fetchJSON('/api/simulate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (res.error) {
    showToast(`Simulation error: ${res.error}`, 'danger');
    return;
  }

  showToast('What-If Campaign Simulation completed successfully!', 'success');

  // Render Simulation KPIs
  const kpisRow = document.getElementById('simKpisRow');
  kpisRow.innerHTML = `
    <div class="col-md-3 col-6">
      <div class="kpi-card-v2">
        <div class="kpi-label-v2">Simulated Demand</div>
        <div class="kpi-value-v2 text-primary">${res.simulated_total_units} <span class="fs-6 text-muted">units</span></div>
        <div class="small text-success">+${res.uplift_percentage}% vs Baseline</div>
      </div>
    </div>
    <div class="col-md-3 col-6">
      <div class="kpi-card-v2 kpi-purple">
        <div class="kpi-label-v2">Projected Revenue</div>
        <div class="kpi-value-v2" style="color: #8b5cf6;">${fmtMoney(res.simulated_revenue)}</div>
        <div class="small text-muted">${fmtMoney(res.baseline_revenue)} baseline</div>
      </div>
    </div>
    <div class="col-md-3 col-6">
      <div class="kpi-card-v2 ${res.stockout_risk ? 'kpi-rose' : 'kpi-emerald'}">
        <div class="kpi-label-v2">Stock Shortfall Risk</div>
        <div class="kpi-value-v2 ${res.stockout_risk ? 'text-danger' : 'text-success'}">${res.stockout_risk ? `${res.stock_shortfall_units} units` : 'Safe'}</div>
        <div class="small text-muted">${res.stockout_risk ? `Depleted by ${res.stockout_date}` : 'Stock Sufficient'}</div>
      </div>
    </div>
    <div class="col-md-3 col-6">
      <div class="kpi-card-v2 kpi-amber d-flex flex-column justify-content-between">
        <div>
          <div class="kpi-label-v2">Safety Stock Buffer</div>
          <div class="kpi-value-v2 text-warning">${res.recommended_buffer_units || 30} u</div>
        </div>
        ${res.stockout_risk ? `
          <button class="btn btn-xs btn-danger rounded-3 mt-2 fw-medium" onclick="quickCreatePo('${productId}', '${res.stock_shortfall_units + 20}')">
            Order Shortfall
          </button>
        ` : ''}
      </div>
    </div>
  `;

  // Render Simulation Chart
  const labels = res.timeline.map(t => t.date);
  const baselineData = res.timeline.map(t => t.baseline_demand);
  const campaignData = res.timeline.map(t => t.simulated_demand);

  const colors = getChartColors();
  const ctx = document.getElementById('simChart').getContext('2d');
  if (simChart) simChart.destroy();

  simChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Baseline Organic Demand',
          data: baselineData,
          borderColor: '#94a3b8',
          borderDash: [4, 4],
          borderWidth: 2,
          fill: false,
          tension: 0.3
        },
        {
          label: `Campaign Demand (${discountPct}% Promo + Events)`,
          data: campaignData,
          borderColor: '#f59e0b',
          backgroundColor: 'rgba(245, 158, 11, 0.1)',
          fill: true,
          borderWidth: 3,
          pointRadius: 4,
          pointBackgroundColor: '#f59e0b',
          tension: 0.3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { color: colors.text, usePointStyle: true } },
        tooltip: { padding: 10, cornerRadius: 8 }
      },
      scales: {
        x: { ticks: { color: colors.text }, grid: { color: colors.grid } },
        y: { ticks: { color: colors.text }, grid: { color: colors.grid }, title: { display: true, text: 'Units / Day', color: colors.text } }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// TAB 6: DATA & CATALOG MANAGEMENT
// ---------------------------------------------------------------------------
async function loadManagementData() {
  const products = await fetchJSON('/api/manage/products');
  const logs = await fetchJSON('/api/audit?limit=50');

  // Products Table
  const pBody = document.getElementById('productsMgmtBody');
  if (Array.isArray(products)) {
    pBody.innerHTML = products.map(p => `
      <tr>
        <td class="fw-semibold">${p.product_id}</td>
        <td>${p.name}</td>
        <td>${p.category}</td>
        <td>₹${p.price}</td>
        <td>${p.supplier_id || 'SUP01'}</td>
        <td class="text-end">
          <button class="btn btn-xs btn-outline-danger rounded-3" onclick="deleteProduct('${p.product_id}')">
            <i class="bi bi-trash"></i>
          </button>
        </td>
      </tr>
    `).join('');
  }

  // Audit Logs Table
  const aBody = document.getElementById('auditLogsBody');
  if (Array.isArray(logs)) {
    aBody.innerHTML = logs.map(l => `
      <tr>
        <td class="text-muted" style="font-size:0.75rem;">${l.timestamp}</td>
        <td class="fw-semibold">${l.user}</td>
        <td><span class="badge bg-light text-dark border">${l.action}</span></td>
        <td>${l.target_type || '--'}</td>
        <td class="text-muted small">${l.details || '--'}</td>
      </tr>
    `).join('');
  }
}

async function deleteProduct(productId) {
  if (currentUser.role !== 'Admin') {
    showToast('Admin privilege required to delete SKUs.', 'danger');
    return;
  }
  if (!confirm(`Are you sure you want to delete product ${productId}?`)) return;
  const res = await fetchJSON(`/api/manage/products/${productId}`, { method: 'DELETE' });
  if (res.error) {
    showToast(`Delete failed: ${res.error}`, 'danger');
  } else {
    showToast(`Deleted product ${productId}`, 'success');
    await loadProducts();
    await loadManagementData();
    await pollForChanges(true);
  }
}

// Upload CSV Handler
document.getElementById('uploadBtn')?.addEventListener('click', async () => {
  const fileInput = document.getElementById('csvFile');
  const mode = document.getElementById('uploadMode').value;
  const resultDiv = document.getElementById('uploadResult');

  if (!fileInput.files || fileInput.files.length === 0) {
    resultDiv.innerHTML = '<span class="text-danger">Please select a CSV file first.</span>';
    return;
  }

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  formData.append('mode', mode);

  resultDiv.innerHTML = '<span class="text-primary"><div class="spinner-border spinner-border-sm me-1"></div> Uploading and triggering retrain pipeline...</span>';

  try {
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.error) {
      resultDiv.innerHTML = `<span class="text-danger">${data.error}</span>`;
      showToast(`Upload failed: ${data.error}`, 'danger');
    } else {
      resultDiv.innerHTML = `<span class="text-success">Ingested ${data.rows_ingested} records. Background model retraining started!</span>`;
      showToast(`CSV Uploaded successfully (${data.rows_ingested} rows)`, 'success');
      fileInput.value = '';
      await pollForChanges(true);
    }
  } catch (err) {
    resultDiv.innerHTML = `<span class="text-danger">Network error: ${err.message}</span>`;
  }
});

// Add Product Form Handler
document.getElementById('pf_submit')?.addEventListener('click', async () => {
  const payload = {
    product_id: document.getElementById('pf_id').value.trim(),
    name: document.getElementById('pf_name').value.trim(),
    category: document.getElementById('pf_category').value.trim(),
    price: parseFloat(document.getElementById('pf_price').value || 0),
    initial_stock: parseFloat(document.getElementById('pf_stock').value || 0),
    supplier_id: document.getElementById('pf_supplier').value
  };

  if (!payload.product_id || !payload.name) {
    showToast('Product ID and Name are required.', 'warning');
    return;
  }

  const res = await fetchJSON('/api/manage/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (res.error) {
    showToast(`Failed saving product: ${res.error}`, 'danger');
  } else {
    showToast(`Product ${payload.name} saved successfully!`, 'success');
    ['pf_id', 'pf_name', 'pf_category', 'pf_price', 'pf_stock'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    await loadProducts();
    await loadManagementData();
  }
});

// Single Sale Form Handler
document.getElementById('sf_submit')?.addEventListener('click', async () => {
  const payload = {
    store_id: document.getElementById('sf_store').value,
    product_id: document.getElementById('sf_product').value,
    date: document.getElementById('sf_date').value,
    quantity_sold: parseFloat(document.getElementById('sf_qty').value || 0),
    current_stock: parseFloat(document.getElementById('sf_stock').value || 0),
    festival_event: document.getElementById('sf_festival').value.trim(),
    promotion: document.getElementById('sf_promo').checked ? 1 : 0
  };

  if (!payload.product_id || !payload.date || payload.quantity_sold <= 0) {
    showToast('Valid Product, Date, and Quantity Sold are required.', 'warning');
    return;
  }

  const res = await fetchJSON('/api/manage/sales', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (res.error) {
    showToast(`Failed recording sale: ${res.error}`, 'danger');
  } else {
    showToast(`Recorded sale for ${payload.product_id}! Retraining in background.`, 'success');
    ['sf_qty', 'sf_stock', 'sf_festival'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    await pollForChanges(true);
  }
});

// Retrain Button
document.getElementById('retrainBtn')?.addEventListener('click', async () => {
  const res = await fetchJSON('/api/retrain', { method: 'POST' });
  if (res.error) {
    showToast(`Retrain trigger failed: ${res.error}`, 'danger');
  } else {
    showToast('Manual model retraining queued!', 'info');
    await pollForChanges(true);
  }
});

// Backup DB Button
document.getElementById('backupDbBtn')?.addEventListener('click', async () => {
  const res = await fetchJSON('/api/manage/backup', { method: 'POST' });
  if (res.error) {
    showToast(`Backup failed: ${res.error}`, 'danger');
  } else {
    showToast(`Snapshot created at ${res.backup_path}`, 'success');
  }
});

// Custom PO Modal Submit
document.getElementById('poModalSubmitBtn')?.addEventListener('click', async () => {
  const storeId = document.getElementById('poModalStoreSelect').value;
  const productId = document.getElementById('poModalProductSelect').value;
  const orderQty = parseFloat(document.getElementById('poModalQty').value || 0);
  const notes = document.getElementById('poModalNotes').value;

  if (!productId || orderQty <= 0) {
    showToast('Select product and enter a positive order quantity.', 'warning');
    return;
  }

  const res = await fetchJSON('/api/po/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ store_id: storeId, product_id: productId, order_qty: orderQty, notes })
  });

  if (res.error) {
    showToast(`PO creation error: ${res.error}`, 'danger');
  } else {
    showToast(`Created Custom PO #${res.po.po_id}!`, 'success');
    const modalEl = document.getElementById('customPoModal');
    const modal = bootstrap.Modal.getInstance(modalEl);
    if (modal) modal.hide();
    await loadReorderData();
  }
});

// ---------------------------------------------------------------------------
// Event Listeners & Trend Toggles
// ---------------------------------------------------------------------------
document.getElementById('globalStoreSelect')?.addEventListener('change', () => {
  pollForChanges(true);
  showToast(`Store filter updated`, 'info');
});

document.getElementById('horizonSelect')?.addEventListener('change', () => {
  renderAlerts();
});

document.getElementById('productSelect')?.addEventListener('change', () => {
  renderForecast();
  renderHistory();
});

document.getElementById('applyFestivalBtn')?.addEventListener('click', () => {
  renderForecast();
  showToast('Applied declared festival to forecast horizon', 'info');
});

document.getElementById('dailyTrendRadio')?.addEventListener('change', () => {
  currentTrendView = 'daily';
  renderHistory();
});

document.getElementById('weeklyTrendRadio')?.addEventListener('change', () => {
  currentTrendView = 'weekly';
  renderHistory();
});

// Export PDF Handlers
document.getElementById('exportPdfAlerts')?.addEventListener('click', (e) => {
  e.preventDefault();
  const storeId = getSelectedStoreId();
  window.open(`/api/export/pdf?type=alerts&store_id=${storeId}`, '_blank');
});

document.getElementById('exportPdfMovers')?.addEventListener('click', (e) => {
  e.preventDefault();
  const storeId = getSelectedStoreId();
  window.open(`/api/export/pdf?type=movers&store_id=${storeId}`, '_blank');
});

// Export CSV Handlers
document.getElementById('exportCsvRaw')?.addEventListener('click', (e) => {
  e.preventDefault();
  const storeId = getSelectedStoreId();
  window.location.href = `/api/export/csv?type=raw&store_id=${storeId}`;
});

document.getElementById('exportCsvOrders')?.addEventListener('click', (e) => {
  e.preventDefault();
  const storeId = getSelectedStoreId();
  window.location.href = `/api/export/csv?type=orders&store_id=${storeId}`;
});

// ---------------------------------------------------------------------------
// Polling & Reactive Live Updates
// ---------------------------------------------------------------------------
async function pollForChanges(force = false) {
  const status = await fetchJSON('/api/status');
  if (status.error) return;

  if (force || lastKnownVersion === null || status.version !== lastKnownVersion) {
    lastKnownVersion = status.version;
    await renderOverview();
    await renderAlerts();
    await renderForecast();
    await renderHistory();
    await renderMovers();
  }
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------
window.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  await checkAuth();
  await loadStores();
  await loadProducts();
  await pollForChanges(true);

  // Set default dates
  const today = new Date().toISOString().split('T')[0];
  const sfDate = document.getElementById('sf_date');
  if (sfDate) sfDate.value = today;

  // Background polling loop
  setInterval(() => pollForChanges(false), POLL_INTERVAL_MS);
});
