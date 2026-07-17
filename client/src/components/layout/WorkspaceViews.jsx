import { useEffect, useState } from 'react';
import { ArrowSquareOut, CheckCircle, Clock, Package, ShieldCheck, Wallet } from '@phosphor-icons/react';
import api from '../../services/api';

const formatDate = (value) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';

export function OrdersView() {
  const [purchases, setPurchases] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { let live = true; api.get('/purchases').then(({ data }) => live && setPurchases(data.purchases || [])).catch(() => live && setPurchases([])).finally(() => live && setLoading(false)); return () => { live = false; }; }, []);
  return <WorkspaceShell icon={<Package size={22} weight="duotone" />} title="Orders" subtitle="Every merchant order and guarded Stellar payment in one place.">
    {loading ? <div className="workspace-empty">Loading orders…</div> : purchases.length === 0 ? <div className="workspace-empty"><Package size={34} /><h3>No orders yet</h3><p>Search a connected store from a new chat when you are ready.</p></div> : <div className="orders-list">{purchases.map((order) => <article className="order-card" key={order.id}>
      {order.product_image ? <img src={order.product_image} alt="" /> : <div className="order-image"><Package size={22} /></div>}
      <div className="order-main"><strong>{order.product_name}</strong><span>{order.site_name || 'Connected merchant'} · {formatDate(order.created_at)}</span><code>{order.stellar_tx_hash ? `${order.stellar_tx_hash.slice(0, 12)}…` : 'Transaction pending'}</code></div>
      <div className="order-meta"><b>{Number(order.price_xlm).toFixed(7)} XLM</b><span className={`status-pill ${order.status}`}>{order.status.replaceAll('_', ' ')}</span>{order.explorerUrl && <a href={order.explorerUrl} target="_blank" rel="noreferrer">Explorer <ArrowSquareOut size={13} /></a>}</div>
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

export function StoresView() {
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(null);
  const load = () => api.get('/sites').then(({ data }) => setSites(data.sites || [])).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);
  const sync = async (id) => { setSyncing(id); try { await api.post(`/sites/${id}/policy/sync`); await load(); } finally { setSyncing(null); } };
  return <WorkspaceShell icon={<ShieldCheck size={22} weight="duotone" />} title="Stores & safeguards" subtitle="Only registered, authenticated merchant APIs can be used by the agent.">
    {loading ? <div className="workspace-empty">Loading stores…</div> : sites.length === 0 ? <div className="workspace-empty"><ShieldCheck size={34} /><h3>No stores connected</h3><p>Connect a registered merchant from the sidebar to begin.</p></div> : <div className="stores-grid">{sites.map((site) => <article className="store-card" key={site.id}><div><h3>{site.site_name}</h3><p>{site.site_url}</p></div><span className={`status-pill ${site.status}`}>{site.status.replaceAll('_', ' ')}</span><dl><div><dt>Daily limit</dt><dd>{Number(site.spending_cap).toFixed(2)} XLM</dd></div><div><dt>Per order</dt><dd>{Number(site.per_transaction_cap).toFixed(2)} XLM</dd></div><div><dt>On-chain policy</dt><dd>{site.policy_synced_at ? 'Synced' : 'Not synced'}</dd></div></dl>{site.policy_sync_error && <p className="workspace-error">Last sync: {site.policy_sync_error}</p>}<button className="btn btn-secondary" disabled={syncing === site.id} onClick={() => sync(site.id)}>{syncing === site.id ? 'Syncing…' : 'Sync safeguards'}</button></article>)}</div>}
  </WorkspaceShell>;
}

function WorkspaceShell({ icon, title, subtitle, children }) { return <main className="workspace"><header className="workspace-header"><div className="workspace-title-icon">{icon}</div><div><h1>{title}</h1><p>{subtitle}</p></div></header>{children}</main>; }
