import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, ArrowDown, ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUp,
  BarChart3, Check, ChevronDown, CircleHelp, FileSpreadsheet, Filter, FolderOpen,
  LayoutDashboard, Menu, Moon, MoreHorizontal, Search, ShieldCheck, Sun, Table2,
  Upload, X, Sparkles,
} from "lucide-react";
import {
  ArcElement, BarElement, CategoryScale, Chart as ChartJS, Filler, Legend,
  LinearScale, LineElement, PointElement, Tooltip,
} from "chart.js";
import { Bar, Doughnut, Line } from "react-chartjs-2";

ChartJS.register(ArcElement, BarElement, CategoryScale, Filler, Legend, LinearScale, LineElement, PointElement, Tooltip);

const API_BASE = window.BUDGET_API_BASE || import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8080/api";
const PALETTE = ["#286a52", "#df795d", "#678da0", "#d7a93c", "#87a477", "#9d7897", "#4d9890", "#bf8c58", "#52718c", "#bf6770"];
const FILTERS = [
  { key: "year", label: "Fiscal year", option: "All years" },
  { key: "department", label: "Department", option: "All departments" },
  { key: "sector", label: "Sector", option: "All sectors" },
  { key: "region", label: "Region", option: "All regions" },
];

const emptyAnalysis = {
  summary: null, department: [], sector: [], region: [], trends: [], allYearTrends: [],
  insights: [], anomalies: { underspent: [], overspent: [], spikes_drops: [] }, table: null,
};

function formatCurrency(amount, digits = 1) {
  if (amount == null) return "—";
  const value = Number(amount) || 0;
  if (value >= 10_000_000) return `₹${(value / 10_000_000).toLocaleString("en-IN", { maximumFractionDigits: digits })} Cr`;
  if (value >= 100_000) return `₹${(value / 100_000).toLocaleString("en-IN", { maximumFractionDigits: digits })} L`;
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function fullCurrency(amount) {
  return `₹${(Number(amount) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function dateLabel(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function filterParams(datasetId, filters, includeYear = true) {
  const params = new URLSearchParams();
  if (datasetId) params.set("dataset_id", datasetId);
  for (const { key } of FILTERS) {
    if ((!includeYear && key === "year") || !filters[key]) continue;
    params.set(key, filters[key]);
  }
  return params;
}

async function request(path, params = new URLSearchParams(), options = {}) {
  const query = params.toString();
  const response = await fetch(`${API_BASE}${path}${query ? `?${query}` : ""}`, options);
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try {
      const body = await response.json();
      if (body.detail) message = body.detail;
    } catch { /* Keep the HTTP status message. */ }
    throw new Error(message);
  }
  return response;
}

async function getJson(path, params) {
  return (await request(path, params)).json();
}

function useToast() {
  const [toast, setToast] = useState(null);
  const timeout = useRef(null);
  function showToast(message, isError = false) {
    setToast({ message, isError });
    clearTimeout(timeout.current);
    timeout.current = setTimeout(() => setToast(null), 3600);
  }
  useEffect(() => () => clearTimeout(timeout.current), []);
  return [toast, showToast];
}

function IconButton({ label, children, onClick, className = "", title }) {
  return <button className={`icon-button ${className}`} type="button" aria-label={label} title={title || label} onClick={onClick}>{children}</button>;
}

function Sidebar({ open, onNavigate }) {
  const links = [
    { href: "#overview", label: "Overview", icon: LayoutDashboard },
    { href: "#allocation", label: "Allocations", icon: BarChart3 },
    { href: "#insights", label: "Insights", icon: Sparkles },
    { href: "#records", label: "Data records", icon: Table2 },
  ];
  return (
    <aside className={`sidebar ${open ? "open" : ""}`} aria-label="Primary navigation">
      <a className="brand" href="#overview" aria-label="Government Budget Allocation Analyzer home">
        <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
        <span className="brand-copy"><strong>Government Budget<br />Allocation Analyzer</strong><small>PUBLIC FINANCE</small></span>
      </a>
      <div className="nav-label">WORKSPACE</div>
      <nav className="nav-list">{links.map(({ href, label, icon: Icon }) => <a className="nav-item" href={href} key={href} onClick={() => onNavigate(href)}><Icon className="nav-icon" aria-hidden="true" />{label}</a>)}</nav>
      <div className="sidebar-bottom">
        <div className="trust-note"><span className="live-dot" /><span>Local analysis<br /><small>Your files stay on this machine</small></span></div>
        <div className="sidebar-foot">GOVERNMENT BUDGET ANALYZER <span>·</span> 1.0</div>
      </div>
    </aside>
  );
}

function FilterBar({ options, filters, onChange }) {
  return (
    <section className="filterbar" aria-label="Global data filters">
      <div className="filter-title"><Filter className="filter-symbol" aria-hidden="true" /><span>FILTERS</span></div>
      {FILTERS.map(({ key, label, option }) => <label className="filter-control" key={key}>
        <span>{label}</span>
        <select aria-label={`Filter by ${label.toLowerCase()}`} value={filters[key]} onChange={(event) => onChange(key, event.target.value)}>
          <option value="">{option}</option>
          {(options[key] || []).map((value) => <option value={value} key={value}>{key === "year" ? options.yearLabels?.[String(value)] || value : value}</option>)}
        </select>
      </label>)}
      <button className="clear-filters" type="button" onClick={() => onChange("clear", "")}>Clear</button>
    </section>
  );
}

function KpiCard({ title, icon: Icon, iconClass = "", value, caption, primary = false }) {
  return <article className={`kpi-card ${primary ? "kpi-primary" : ""}`}>
    <div className="kpi-top"><span>{title}</span><span className={`kpi-mark ${iconClass}`}><Icon size={14} aria-hidden="true" /></span></div>
    <div className={`kpi-value ${value?.length > 16 ? "kpi-text" : ""} ${value === "—" ? "kpi-loading" : ""}`}>{value || "—"}</div>
    <div className="kpi-caption">{caption}</div>
  </article>;
}

function ChartPanel({ title, description, children, className = "", hint }) {
  return <article className={`panel chart-panel ${className}`}>
    <div className="panel-heading"><div><h3>{title}</h3><p>{description}</p></div><button className="chart-menu" type="button" aria-label={`${title} chart details`} title={hint}><MoreHorizontal size={18} /></button></div>
    {children}
  </article>;
}

function ChartEmpty({ children, isEmpty }) {
  return isEmpty ? <div className="chart-empty">{children}</div> : null;
}

function SourceDialog({ open, onClose, onDataset, showToast }) {
  const [tab, setTab] = useState("upload");
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");
  const [savedError, setSavedError] = useState("");
  const [files, setFiles] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busyFile, setBusyFile] = useState("");
  const [busyDelete, setBusyDelete] = useState("");
  const inputRef = useRef(null);
  const dragRef = useRef(false);

  useEffect(() => {
    if (!open || tab !== "saved") return;
    let active = true;
    setFiles(null);
    getJson("/files").then((data) => { if (active) setFiles(data.files); })
      .catch((loadError) => { if (active) setSavedError(loadError.message); });
    return () => { active = false; };
  }, [open, tab]);

  useEffect(() => {
    if (!open) return undefined;
    function handleEscape(event) { if (event.key === "Escape") onClose(); }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open, onClose]);

  function upload(file) {
    setError("");
    setPreview(null);
    if (!file) return;
    if (!/\.(csv|xlsx|xls|json)$/i.test(file.name)) { setError("Choose a CSV, XLSX, XLS, or JSON file."); return; }
    if (file.size > 20 * 1024 * 1024) { setError("Files must be 20 MB or smaller."); return; }
    if (file.name.toLowerCase().endsWith(".csv")) {
      const reader = new FileReader();
      reader.onload = () => {
        const lines = String(reader.result || "").split(/\r?\n/).filter(Boolean).slice(0, 11);
        const [headers, ...rows] = lines.map((line) => line.split(",").map((cell) => cell.replace(/^"|"$/g, "")));
        setPreview(headers?.length ? { headers, rows: rows.slice(0, 10) } : null);
      };
      reader.readAsText(file.slice(0, 256 * 1024));
    }
    const form = new FormData();
    form.append("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/upload`);
    setProgress({ name: file.name, value: 0 });
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) setProgress({ name: file.name, value: Math.round(event.loaded / event.total * 100) });
    };
    xhr.onload = async () => {
      setProgress(null);
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* Show a friendly fallback. */ }
      if (xhr.status < 200 || xhr.status >= 300) { setError(body.detail || "The upload could not be processed."); return; }
      if (body.preview?.length) {
        const headers = Object.keys(body.preview[0]);
        setPreview({ headers, rows: body.preview.map((record) => headers.map((header) => record[header])) });
      }
      showToast(`${file.name} is ready to explore.`);
      await onDataset(body.dataset);
    };
    xhr.onerror = () => { setProgress(null); setError("Could not reach the API. Start FastAPI and try again."); };
    xhr.send(form);
  }

  async function openSavedFile(name) {
    setBusyFile(name);
    setSavedError("");
    try {
      const response = await request("/load-file", new URLSearchParams(), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
      });
      const result = await response.json();
      await onDataset(result.dataset);
      showToast(`${name} loaded.`);
    } catch (loadError) {
      setSavedError(loadError.message);
      setBusyFile("");
    }
  }

  async function deleteSavedFile(name) {
    setBusyDelete(name);
    setSavedError("");
    try {
      await request("/files", new URLSearchParams({ name }), { method: "DELETE" });
      setFiles((current) => (current || []).filter((file) => file.name !== name));
      showToast(`${name} deleted.`);
    } catch (deleteError) {
      setSavedError(deleteError.message);
    } finally {
      setBusyDelete("");
    }
  }

  if (!open) return null;
  return <div className="source-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="source-dialog" role="dialog" aria-modal="true" aria-labelledby="sourceTitle">
      <button className="dialog-close" type="button" onClick={onClose} aria-label="Close data source panel"><X size={17} /></button>
      <p className="eyebrow">START WITH A DATASET</p><h2 id="sourceTitle">Bring your budget into view.</h2><p className="source-description">Upload a new file or reopen a dataset saved in this workspace.</p>
      <div className="source-tabs" role="tablist" aria-label="Dataset source">
        <button className={`source-tab ${tab === "upload" ? "active" : ""}`} type="button" role="tab" aria-selected={tab === "upload"} onClick={() => setTab("upload")}>Upload new file</button>
        <button className={`source-tab ${tab === "saved" ? "active" : ""}`} type="button" role="tab" aria-selected={tab === "saved"} onClick={() => setTab("saved")}>Choose from saved files</button>
      </div>
      {tab === "upload" ? <div className="source-pane" role="tabpanel">
        <label className={`drop-zone ${dragRef.current ? "dragging" : ""}`} htmlFor="fileInput" onDragOver={(event) => { event.preventDefault(); dragRef.current = true; event.currentTarget.classList.add("dragging"); }} onDragLeave={(event) => { dragRef.current = false; event.currentTarget.classList.remove("dragging"); }} onDrop={(event) => { event.preventDefault(); dragRef.current = false; event.currentTarget.classList.remove("dragging"); upload(event.dataTransfer.files[0]); }}>
          <span className="upload-symbol"><Upload size={17} /></span><strong>Drop your budget file here</strong><span>or <span className="choose-link">choose a file</span></span><small>CSV, XLSX, XLS, or JSON · Max 20 MB</small>
          <input ref={inputRef} id="fileInput" type="file" accept=".csv,.xlsx,.xls,.json" hidden onChange={(event) => { upload(event.target.files[0]); event.target.value = ""; }} />
        </label>
        {progress && <div className="upload-progress"><div className="progress-label"><span>{progress.name}</span><span>{progress.value}%</span></div><progress max="100" value={progress.value} /></div>}
        {error && <div className="upload-error" role="alert">{error}</div>}
        {preview && <div className="preview-wrap"><strong>File preview</strong><div className="preview-scroll"><table><thead><tr>{preview.headers.map((header, index) => <th key={`${header}-${index}`}>{header}</th>)}</tr></thead><tbody>{preview.rows.map((row, rowIndex) => <tr key={rowIndex}>{preview.headers.map((header, index) => <td key={`${header}-${index}`}>{row[index]}</td>)}</tr>)}</tbody></table></div></div>}
      </div> : <div className="source-pane" role="tabpanel">
        <div className="saved-list">{files === null ? <div className="saved-loading"><span className="spinner" />Looking for saved files</div> : files.length ? files.map((file) => <div className="saved-file" key={file.name}><div className="saved-file-name"><strong>{file.name}</strong><span>{file.size < 1024 * 1024 ? `${Math.round(file.size / 1024)} KB` : `${(file.size / (1024 * 1024)).toFixed(1)} MB`} · {dateLabel(file.modified_at)}</span></div><div className="saved-actions"><button className="button button-dark saved-open" type="button" disabled={Boolean(busyFile) || Boolean(busyDelete)} onClick={() => openSavedFile(file.name)}>{busyFile === file.name ? "Loading" : "Open"}</button><button className="button button-outline saved-delete" type="button" disabled={Boolean(busyFile) || Boolean(busyDelete)} onClick={() => deleteSavedFile(file.name)}>{busyDelete === file.name ? "Deleting" : "Delete"}</button></div></div>) : <div className="empty-saved">No saved budget files yet. Upload a file and it will be available here next time.</div>}</div>
        {savedError && <div className="upload-error" role="alert">{savedError}</div>}
      </div>}
      <p className="source-footnote"><span className="live-dot" />Files are processed and stored locally by this app.</p>
    </section>
  </div>;
}

function RecordsTable({ table, loading, page, search, onSearch, onSort, sortBy, sortOrder, onPage, onExport, exportFormat, setExportFormat }) {
  const rows = table?.items || [];
  const columns = table?.columns || [];
  const numeric = new Set(["Year", "Allocated_Amount", "Spent_Amount", "Revised_Estimate"]);
  return <section className="panel records-panel" id="records">
    <div className="records-heading"><div><p className="eyebrow">SOURCE DATA</p><h2>Budget records</h2><p className="records-subtitle">{loading ? "Updating filtered records" : `${Number(table?.total || 0).toLocaleString()} records in current selection`}</p></div>
      <div className="table-actions"><label className="search-box"><Search size={15} aria-hidden="true" /><input type="search" placeholder="Search records" aria-label="Search budget records" value={search} onChange={(event) => onSearch(event.target.value)} /></label><ExportControls onExport={onExport} format={exportFormat} setFormat={setExportFormat} /></div>
    </div>
    <div className="table-scroll"><table><thead><tr>{columns.map((column) => <th className={numeric.has(column) ? "numeric" : ""} key={column}><button type="button" onClick={() => onSort(column)} aria-sort={sortBy === column ? (sortOrder === "asc" ? "ascending" : "descending") : "none"}>{column.replaceAll("_", " ")}{sortBy === column && <span className="sort-indicator">{sortOrder === "asc" ? "↑" : "↓"}</span>}</button></th>)}</tr></thead>
      <tbody id="tableBody">{loading && !table ? <tr><td colSpan={8}><div className="table-loading"><span className="spinner" />Loading records</div></td></tr> : rows.length ? rows.map((record, index) => <tr key={`${record.Year}-${record.Department}-${record.Scheme}-${index}`}>{columns.map((column) => <td className={numeric.has(column) ? "numeric" : ""} key={column}>{["Allocated_Amount", "Spent_Amount", "Revised_Estimate"].includes(column) ? fullCurrency(record[column]) : record[column] ?? "—"}</td>)}</tr>) : <tr><td className="empty-cell" colSpan={Math.max(1, columns.length)}>No records match this search and filter selection.</td></tr>}</tbody>
    </table></div>
    <div className="pagination"><span>{table?.total ? `Page ${page} of ${Math.max(1, table.pages)} · ${Number(table.total).toLocaleString()} records` : "No matching records"}</span><div className="page-buttons"><button className="page-button" type="button" aria-label="Previous page" disabled={page <= 1 || loading} onClick={() => onPage(page - 1)}><ArrowLeft size={13} /></button><button className="page-button" type="button" aria-label="Next page" disabled={page >= (table?.pages || 1) || loading} onClick={() => onPage(page + 1)}><ArrowRight size={13} /></button></div></div>
  </section>;
}

function ExportControls({ onExport, format, setFormat }) {
  return <><label className="select-export"><span className="sr-only">Export format</span><select value={format} onChange={(event) => setFormat(event.target.value)} aria-label="Export format"><option value="csv">CSV</option><option value="xlsx">Excel</option></select></label><button className="button button-dark" type="button" onClick={onExport}><ArrowDownToLine size={14} />Export</button></>;
}

export default function App() {
  const [dataset, setDataset] = useState(null);
  const [options, setOptions] = useState({ year: [], yearLabels: {}, department: [], sector: [], region: [] });
  const [filters, setFilters] = useState({ year: "", department: "", sector: "", region: "" });
  const [analysis, setAnalysis] = useState(emptyAnalysis);
  const [loading, setLoading] = useState(false);
  const [startupError, setStartupError] = useState("");
  const [sourceOpen, setSourceOpen] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem("budget-atlas-theme") || "light");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [sortBy, setSortBy] = useState("Allocated_Amount");
  const [sortOrder, setSortOrder] = useState("desc");
  const [exportFormat, setExportFormat] = useState("csv");
  const [toast, showToast] = useToast();

  useEffect(() => {
    document.body.dataset.theme = theme;
    localStorage.setItem("budget-atlas-theme", theme);
  }, [theme]);

  useEffect(() => {
    let active = true;
    getJson("/summary").then((summary) => {
      if (!active) return;
      setDataset({ dataset_id: summary.dataset_id, name: summary.name, rows: summary.row_count, default_year: summary.default_year });
      if (summary.default_year) setFilters((current) => ({ ...current, year: String(summary.default_year) }));
      setStartupError("");
    }).catch((error) => {
      if (!active) return;
      setStartupError(error.message || "Could not reach the API. Start FastAPI and try again.");
      setSourceOpen(true);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!dataset?.dataset_id) return undefined;
    let active = true;
    const params = new URLSearchParams({ dataset_id: dataset.dataset_id });
    getJson("/options", params).then((data) => {
      if (!active) return;
      setOptions({ year: data.years, yearLabels: data.year_labels || {}, department: data.departments, sector: data.sectors, region: data.regions });
    }).catch((error) => showToast(error.message, true));
    return () => { active = false; };
  }, [dataset?.dataset_id]);

  useEffect(() => {
    if (!dataset?.dataset_id) return undefined;
    let active = true;
    setLoading(true);
    const params = filterParams(dataset.dataset_id, filters);
    const allYearParams = filterParams(dataset.dataset_id, filters, false);
    const tableParams = new URLSearchParams(params);
    tableParams.set("page", String(page));
    tableParams.set("page_size", "10");
    tableParams.set("sort_by", sortBy);
    tableParams.set("sort_order", sortOrder);
    if (deferredSearch.trim()) tableParams.set("search", deferredSearch.trim());

    Promise.all([
      getJson("/summary", params), getJson("/by-department", params), getJson("/by-sector", params),
      getJson("/by-region", params), getJson("/trends", params), getJson("/trends", allYearParams),
      getJson("/insights", params), getJson("/anomalies", params), getJson("/table", tableParams),
    ]).then(([summary, department, sector, region, trends, allYearTrends, insights, anomalies, table]) => {
      if (!active) return;
      setAnalysis({ summary, department: department.items, sector: sector.items, region: region.items, trends: trends.items, allYearTrends: allYearTrends.items, insights: insights.items, anomalies, table });
      setDataset((current) => current ? { ...current, rows: summary.row_count } : current);
      setStartupError("");
    }).catch((error) => {
      if (!active) return;
      showToast(error.message || "Could not load the budget analysis.", true);
      setAnalysis((current) => ({ ...current, table: { items: [], columns: [], total: 0, pages: 0 } }));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [dataset?.dataset_id, filters.year, filters.department, filters.sector, filters.region, page, deferredSearch, sortBy, sortOrder]);

  const selectedYear = filters.year;
  const topDepartment = analysis.department[0];
  const growthRow = selectedYear ? analysis.allYearTrends.find((item) => String(item.Year) === selectedYear) : analysis.allYearTrends.at(-1);
  const growth = growthRow?.growth_pct;
  const totalSignals = analysis.anomalies.underspent.length + analysis.anomalies.overspent.length + analysis.anomalies.spikes_drops.length;
  const years = analysis.summary?.year_range || [];
  const selectedYearLabel = selectedYear
    ? analysis.summary?.period_labels?.[selectedYear] || options.yearLabels[selectedYear] || selectedYear
    : years.length ? `${options.yearLabels[String(years[0])] || years[0]} — ${options.yearLabels[String(years.at(-1))] || years.at(-1)}` : "ALL AVAILABLE YEARS";
  const periodText = selectedYearLabel;

  const textColor = getComputedStyle(document.body).getPropertyValue("--muted").trim();
  const lineColor = getComputedStyle(document.body).getPropertyValue("--line").trim();
  const surfaceColor = getComputedStyle(document.body).getPropertyValue("--surface").trim();
  const chartLegend = useMemo(() => ({ labels: { color: textColor, padding: 16, usePointStyle: true, pointStyle: "circle", boxWidth: 7, boxHeight: 7, font: { family: "DM Sans", size: 9 } } }), [textColor]);

  function chooseDataset(nextDataset) {
    setDataset(nextDataset);
    setFilters({ year: nextDataset.default_year ? String(nextDataset.default_year) : "", department: "", sector: "", region: "" });
    setPage(1);
    setSearch("");
    setAnalysis(emptyAnalysis);
    setStartupError("");
    setSourceOpen(false);
  }

  function changeFilter(key, value) {
    if (key === "clear") setFilters({ year: "", department: "", sector: "", region: "" });
    else setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  async function exportData() {
    try {
      const params = filterParams(dataset?.dataset_id, filters);
      params.set("format", exportFormat);
      const response = await request("/export", params);
      const blob = await response.blob();
      const filename = response.headers.get("Content-Disposition")?.match(/filename="?([^";]+)"?/)?.[1] || `budget_export.${exportFormat}`;
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (error) { showToast(error.message || "Could not export this selection.", true); }
  }

  const departmentData = {
    labels: analysis.department.slice(0, 9).map((item) => item.Department),
    datasets: [
      { label: "Allocated", data: analysis.department.slice(0, 9).map((item) => item.Allocated_Amount / 10_000_000), backgroundColor: "#286a52", borderRadius: 3, barPercentage: .72, categoryPercentage: .72 },
      { label: "Spent", data: analysis.department.slice(0, 9).map((item) => Number.isFinite(item.Spent_Amount) ? item.Spent_Amount / 10_000_000 : null), backgroundColor: "#df795d", borderRadius: 3, barPercentage: .72, categoryPercentage: .72 },
    ],
  };
  const sectorItems = analysis.sector.slice(0, 8);
  const sectorData = { labels: sectorItems.map((item) => item.Sector), datasets: [{ data: sectorItems.map((item) => item.Allocated_Amount), backgroundColor: PALETTE, borderWidth: 2, borderColor: surfaceColor, hoverOffset: 5 }] };
  const trendData = { labels: analysis.trends.map((item) => item.Year), datasets: [
    { label: "Allocated", data: analysis.trends.map((item) => item.Allocated_Amount / 10_000_000), borderColor: "#286a52", backgroundColor: "rgba(40,106,82,.1)", fill: true, tension: .34, pointRadius: 3, pointHoverRadius: 5 },
    { label: "Spent", data: analysis.trends.map((item) => Number.isFinite(item.Spent_Amount) ? item.Spent_Amount / 10_000_000 : null), borderColor: "#df795d", backgroundColor: "transparent", tension: .34, pointRadius: 3, pointHoverRadius: 5 },
  ] };
  const regionItems = analysis.region.slice(0, 8);
  const regionData = { labels: regionItems.map((item) => item["State/Region"]), datasets: [{ label: "Allocated", data: regionItems.map((item) => item.Allocated_Amount / 10_000_000), backgroundColor: regionItems.map((_, index) => index === 0 ? "#286a52" : "#8db29b"), borderRadius: 3, barPercentage: .66, categoryPercentage: .7 }] };
  const amountAxis = { grid: { color: lineColor }, ticks: { color: textColor, font: { size: 8 }, callback: (value) => `₹${value} Cr` }, border: { display: false } };
  const nameAxis = { grid: { display: false }, ticks: { color: textColor, font: { size: 9 } }, border: { display: false } };
  const horizontalBarOptions = (legend) => ({ indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins: { legend, tooltip: { callbacks: { label: (context) => `${context.dataset.label}: ₹${Number(context.raw).toLocaleString("en-IN", { maximumFractionDigits: 1 })} Cr` } } }, scales: { x: amountAxis, y: nameAxis } });
  const trendOptions = { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, plugins: { legend: chartLegend, tooltip: { callbacks: { label: (context) => `${context.dataset.label}: ₹${Number(context.raw).toLocaleString("en-IN", { maximumFractionDigits: 1 })} Cr` } } }, scales: { x: nameAxis, y: amountAxis } };
  const donutOptions = { responsive: true, maintainAspectRatio: false, cutout: "69%", plugins: { legend: { display: false }, tooltip: { callbacks: { label: (context) => `${context.label}: ${formatCurrency(context.raw)} · ${sectorItems[context.dataIndex]?.share_pct}%` } } } };

  return <div className="app-shell">
    <Sidebar open={sidebarOpen} onNavigate={() => setSidebarOpen(false)} />
    <main className="main-area" id="overview">
      <header className="topbar">
        <IconButton className="menu-button" label="Toggle navigation" onClick={() => setSidebarOpen((current) => !current)}><Menu size={16} /></IconButton>
        <div className="breadcrumbs"><span>Workspace</span><b>/</b><strong>Overview</strong></div>
        <div className="topbar-actions"><span className="dataset-indicator"><span className="live-dot" /><span>{dataset?.name || "Loading dataset…"}</span></span>
          <IconButton className="theme-button" label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}</IconButton>
          <button className="button button-outline change-dataset" type="button" onClick={() => setSourceOpen(true)}>Change dataset</button>
        </div>
      </header>
      <div className="page-content">
        <section className="page-heading"><div><p className="eyebrow">PUBLIC MONEY, MADE LEGIBLE</p><h1>Government Budget Allocation Analyzer<span className="heading-period">.</span></h1><p className="subheading">Monitoring allocations, revised estimates, and budget trends across ministries and sectors.</p>{selectedYearLabel && <div className="period-chip page-period-chip">{selectedYearLabel}</div>}</div><div className="updated-label"><span className="status-ring" />{dataset ? `${Number(dataset.rows || 0).toLocaleString()} cleaned records` : "Preparing your workspace"}</div></section>
        <FilterBar options={options} filters={filters} onChange={changeFilter} />
        <section className="kpi-grid" aria-label="Budget key performance indicators">
          <KpiCard primary title="Total budget" icon={FileSpreadsheet} value={formatCurrency(analysis.summary?.total_budget)} caption={`${Number(analysis.summary?.row_count || 0).toLocaleString()} matching records`} />
          <KpiCard title="Total spent" icon={ArrowDownToLine} iconClass="mark-coral" value={analysis.summary?.spending_available ? formatCurrency(analysis.summary.total_spent) : analysis.summary ? "Not reported" : "—"} caption={analysis.summary?.spending_available ? "Recorded expenditure" : "Not provided for this estimate"} />
          <KpiCard title="Utilization" icon={Activity} iconClass="mark-green" value={analysis.summary?.utilization_pct == null ? analysis.summary ? "N/A" : "—" : `${Number(analysis.summary.utilization_pct).toFixed(1)}%`} caption={analysis.summary?.utilization_pct > 100 ? "Above total allocation" : analysis.summary?.utilization_pct == null ? "Expenditure not reported" : "Spent against allocation"} />
          <KpiCard title="Top department" icon={FolderOpen} iconClass="mark-blue" value={topDepartment?.Department || (analysis.summary ? "No data" : "—")} caption={topDepartment ? `${formatCurrency(topDepartment.Allocated_Amount)} allocated` : "By allocated amount"} />
          <KpiCard title="YoY growth" icon={growth < 0 ? ArrowDown : ArrowUp} iconClass={growth < 0 ? "mark-coral" : "mark-yellow"} value={growth == null ? "—" : `${growth > 0 ? "+" : ""}${Number(growth).toFixed(1)}%`} caption={growthRow ? `${growthRow.Year} vs prior year` : "Allocation vs prior year"} />
        </section>
        <section className="section-heading" id="allocation"><div><h2>Allocation landscape</h2><p>How funding is distributed across the public sector.</p></div><span className="period-chip">{periodText}</span></section>
        <section className="chart-grid" aria-label="Budget charts">
          <ChartPanel className="department-panel" title="Department allocation" description="Allocated compared with spent" hint="Amounts shown in crore rupees"><div className="chart-wrap chart-tall"><Bar data={departmentData} options={horizontalBarOptions(chartLegend)} aria-label="Allocated and spent by department" /><ChartEmpty isEmpty={!analysis.department.length}>No department data for these filters.</ChartEmpty></div></ChartPanel>
          <ChartPanel title="Sector share" description="Share of total allocated budget" hint="Share of filtered allocation"><div className="chart-wrap donut-wrap"><Doughnut data={sectorData} options={donutOptions} aria-label="Budget share by sector" /><ChartEmpty isEmpty={!sectorItems.length}>No sector data for these filters.</ChartEmpty></div><div className="chart-legend">{sectorItems.map((item, index) => <span className="legend-item" key={item.Sector}><i className="legend-swatch" style={{ backgroundColor: PALETTE[index % PALETTE.length] }} />{item.Sector} {item.share_pct}%</span>)}</div></ChartPanel>
          <ChartPanel title="Yearly trajectory" description="Budget and expenditure over time" hint="Annual amounts in crore rupees"><div className="chart-wrap"><Line data={trendData} options={trendOptions} aria-label="Allocation and spending by year" /><ChartEmpty isEmpty={!analysis.trends.length}>No year data for these filters.</ChartEmpty></div></ChartPanel>
          <ChartPanel title="Regional allocation" description="Where funds are distributed" hint="Top regions by allocation"><div className="chart-wrap"><Bar data={regionData} options={horizontalBarOptions({ display: false })} aria-label="Allocation by region" /><ChartEmpty isEmpty={!regionItems.length}>No region data for these filters.</ChartEmpty></div></ChartPanel>
        </section>
        <section className="lower-grid" id="insights">
          <article className="panel insights-panel"><div className="panel-heading"><div><p className="eyebrow">ANALYST BRIEF</p><h2>What stands out</h2></div><Sparkles className="spark-icon" size={18} /></div><ul className="insight-list">{analysis.insights.length ? analysis.insights.map((insight, index) => <li key={`${insight}-${index}`}>{insight}</li>) : <><li className="skeleton-line" /><li className="skeleton-line short" /></>}</ul></article>
          <article className="panel anomaly-panel"><div className="panel-heading"><div><p className="eyebrow">SPENDING CHECK</p><h2>Signals to review</h2></div><span className="signal-count">{totalSignals}</span></div><div className="signal-list">{!analysis.anomalies.spending_available && <span className="signal-badge">Utilization alerts unavailable: expenditure not reported</span>}{totalSignals ? <>{analysis.anomalies.underspent.length > 0 && <span className="signal-badge">{analysis.anomalies.underspent.length} departments below 60% utilization</span>}{analysis.anomalies.overspent.length > 0 && <span className="signal-badge danger">{analysis.anomalies.overspent.length} departments over allocation</span>}{analysis.anomalies.spikes_drops.length > 0 && <span className="signal-badge">{analysis.anomalies.spikes_drops.length} allocation outliers</span>}</> : analysis.anomalies.spending_available && <span className="signal-badge good">No review signals in this selection</span>}</div><p className="method-note">Outliers use the IQR method. Utilization signals compare spending with allocation.</p></article>
        </section>
        <RecordsTable table={analysis.table} loading={loading} page={page} search={search} onSearch={(value) => { setSearch(value); setPage(1); }} onSort={(column) => { setSortOrder((current) => sortBy === column && current === "asc" ? "desc" : "asc"); setSortBy(column); setPage(1); }} sortBy={sortBy} sortOrder={sortOrder} onPage={setPage} onExport={exportData} exportFormat={exportFormat} setExportFormat={setExportFormat} />
        <footer className="page-footer"><span>Government Budget Allocation Analyzer <span className="footer-dot">·</span> Public finance analysis</span><span>{dataset ? `Dataset: ${dataset.name}` : "Data stays in your local workspace"}</span></footer>
      </div>
    </main>
    <SourceDialog open={sourceOpen} onClose={() => { setSourceOpen(false); setStartupError(""); }} onDataset={chooseDataset} showToast={showToast} />
    {startupError && sourceOpen && <div className="startup-alert" role="alert"><CircleHelp size={14} />{startupError}</div>}
    {toast && <div className={`toast visible ${toast.isError ? "error" : ""}`} role="status" aria-live="polite">{toast.message}</div>}
  </div>;
}