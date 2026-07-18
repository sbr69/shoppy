import { useEffect, useState } from 'react';
import { ArrowSquareOut, CheckCircle, Clock, Package, ShieldCheck, Wallet } from '@phosphor-icons/react';
import api from '../../services/api';

const formatDate = (value) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';

export function OrdersView() {
  const [purchases, setPurchases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedOrder, setExpandedOrder] = useState(null);
  const [workflow, setWorkflow] = useState({});
  useEffect(() => {
    let live = true;
    const load = () => api.get('/purchases').then(({ data }) => live && setPurchases(data.purchases || [])).catch(() => live && setPurchases([])).finally(() => live && setLoading(false));
    void load();
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 12_000);
    const visible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', visible);
    return () => { live = false; window.clearInterval(interval); document.removeEventListener('visibilitychange', visible); };
  }, []);
  const toggleWorkflow = async (id) => {
    if (expandedOrder === id) return setExpandedOrder(null);
    setExpandedOrder(id);
    if (workflow[id]) return;
    try { const { data } = await api.get(`/purchases/${id}/workflow`); setWorkflow((current) => ({ ...current, [id]: data.events || [] })); } catch { setWorkflow((current) => ({ ...current, [id]: [] })); }
  };
  return <WorkspaceShell icon={<Package size={22} weight="duotone" />} title="Orders" subtitle="Every merchant order and guarded Stellar payment in one place.">
    {loading ? <div className="workspace-empty">Loading orders…</div> : purchases.length === 0 ? <div className="workspace-empty"><Package size={34} /><h3>No orders yet</h3><p>Search a connected store from a new chat when you are ready.</p></div> : <div className="orders-list">{purchases.map((order) => <article className="order-card" key={order.id}>
      {order.product_image ? <img src={order.product_image} alt="" /> : <div className="order-image"><Package size={22} /></div>}
      <div className="order-main"><strong>{order.product_name}</strong><span>{order.site_name || 'Connected merchant'} · {formatDate(order.created_at)}</span><span className="order-stage-copy">{order.statusInfo?.description}</span><code>{order.stellar_tx_hash ? `${order.stellar_tx_hash.slice(0, 12)}…` : 'Transaction pending'}</code>{expandedOrder === order.id && <ol className="order-workflow">{(workflow[order.id] || []).length ? workflow[order.id].map((event) => <li key={event.id}><span className={`workflow-dot ${event.status}`}></span><div><b>{event.stage.replaceAll('_', ' ')}</b><p>{event.detail || event.status}</p><time>{formatDate(event.created_at)}</time></div></li>) : <li className="workflow-empty">No workflow entries are available yet.</li>}</ol>}</div>
      <div className="order-meta"><b>{Number(order.price_xlm).toFixed(7)} XLM</b><span className={`status-pill ${order.statusInfo?.stage || order.status}`}>{order.statusInfo?.label || order.status.replaceAll('_', ' ')}</span>{order.reconciliation_run_after && order.status !== 'confirmed' && order.status !== 'failed' && <span className="retry-copy">Retry {formatDate(order.reconciliation_run_after)}</span>}<button className="order-details-button" onClick={() => void toggleWorkflow(order.id)}>{expandedOrder === order.id ? 'Hide activity' : 'View activity'}</button>{order.explorerUrl && <a href={order.explorerUrl} target="_blank" rel="noreferrer">Explorer <ArrowSquareOut size={13} /></a>}</div>
    </article>)}</div>}
  </WorkspaceShell>;
}

export function WalletActivityView() {
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { let live = true; api.get('/wallet/activity').then(({ data }) => live && setActivity(data.activity || [])).catch(() => live && setActivity([])).finally(() => live && setLoading(false)); return () => { live = false; }; }, []);
  return <WorkspaceShell icon={<Wallet size={22} weight="duotone" />} title="Wallet activity" subtitle="A read-only trail of funding, policy changes, and payments.">
    {loading ? <div className="workspace-empty">Loading activity…</div> : activity.length === 0 ? <div className="workspace-empty"><Clock size={34} /><h3>No activity yet</h3><p>Funding and purchases will appear here automatically.</p></div> : <div className="activity-list">{activity.map((item) => <div className="activity-row" key={item.id}><div className="activity-icon">{item.type === 'purchase' ? <Package /> : <ShieldCheck />}</div><div><strong>{item.title}</strong><span>{formatDate(item.createdAt)}</span></div><div className="activity-value">{item.amountXlm ? `−${item.amountXlm.toFixed(7)} XLM` : item.status || 'recorded'}</div></div>)}</div>}
  </WorkspaceShell>;
}

export function StoresView({ onConnectStore, refreshKey }) {
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(null);
  const load = () => api.get('/sites').then(({ data }) => setSites(data.sites || [])).finally(() => setLoading(false));
  useEffect(() => { load(); }, [refreshKey]);
  const sync = async (id) => { setSyncing(id); try { await api.post(`/sites/${id}/policy/sync`); await load(); } finally { setSyncing(null); } };
  return <WorkspaceShell icon={<ShieldCheck size={22} weight="duotone" />} title="Stores & safeguards" subtitle="Only registered, authenticated merchant APIs can be used by the agent." action={<button className="btn btn-primary" onClick={onConnectStore}><CheckCircle size={16} /> Connect store</button>}>
    {loading ? <div className="workspace-empty">Loading stores…</div> : sites.length === 0 ? <div className="workspace-empty workspace-empty--stores"><ShieldCheck size={38} /><h3>Connect your first store</h3><p>Sign in on your ecommerce site, approve the connection, and let your agent shop only in that account.</p><button className="btn btn-primary" onClick={onConnectStore}>Connect a store</button></div> : <div className="stores-grid">{sites.map((site) => <article className="store-card" key={site.id}><div><h3>{site.site_name}</h3><p>{site.site_url}</p></div><span className={`status-pill ${site.status}`}>{site.status.replaceAll('_', ' ')}</span><dl><div><dt>Daily limit</dt><dd>{Number(site.spending_cap).toFixed(2)} XLM</dd></div><div><dt>Per order</dt><dd>{Number(site.per_transaction_cap).toFixed(2)} XLM</dd></div><div><dt>On-chain policy</dt><dd>{site.policy_synced_at ? 'Synced' : 'Not synced'}</dd></div></dl>{site.policy_sync_error && <p className="workspace-error">Last sync: {site.policy_sync_error}</p>}<button className="btn btn-secondary" disabled={syncing === site.id} onClick={() => sync(site.id)}>{syncing === site.id ? 'Syncing…' : 'Sync safeguards'}</button></article>)}</div>}
  </WorkspaceShell>;
}

function WorkspaceShell({ icon, title, subtitle, action, children }) { return <main className="workspace"><header className="workspace-header"><div className="workspace-title-icon">{icon}</div><div><h1>{title}</h1><p>{subtitle}</p></div>{action && <div className="workspace-header-action">{action}</div>}</header>{children}</main>; }
