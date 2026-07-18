import { useEffect, useState } from 'react';
import {
  ArrowSquareOut,
  Clock,
  Package,
  ShieldCheck,
  Wallet,
  PlusCircle,
  Storefront,
} from '@phosphor-icons/react';
import api from '../../services/api';

const formatDate = (value) =>
  value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
    : '—';

export function OrdersView() {
  const [purchases, setPurchases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedOrder, setExpandedOrder] = useState(null);
  const [workflow, setWorkflow] = useState({});

  useEffect(() => {
    let live = true;
    const load = () =>
      api
        .get('/purchases')
        .then(({ data }) => live && setPurchases(data.purchases || []))
        .catch(() => live && setPurchases([]))
        .finally(() => live && setLoading(false));
    void load();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 12_000);
    const visible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      live = false;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);

  const toggleWorkflow = async (id) => {
    if (expandedOrder === id) return setExpandedOrder(null);
    setExpandedOrder(id);
    if (workflow[id]) return;
    try {
      const { data } = await api.get(`/purchases/${id}/workflow`);
      setWorkflow((current) => ({ ...current, [id]: data.events || [] }));
    } catch {
      setWorkflow((current) => ({ ...current, [id]: [] }));
    }
  };

  return (
    <WorkspaceShell
      icon={<Package size={22} weight="fill" />}
      title="Orders Ledger"
      subtitle="Complete ledger of merchant order settlements and guarded Stellar payments."
    >
      {loading ? (
        <div className="workspace-loading-state">
          <div className="spinner-lg" />
          <p>Loading purchase ledger...</p>
        </div>
      ) : purchases.length === 0 ? (
        <div className="workspace-empty">
          <Package size={34} />
          <h3>No purchases recorded</h3>
          <p>Initiate a transaction with the assistant when you are ready.</p>
        </div>
      ) : (
        <div className="workspace-list-container">
          <div className="workspace-list-header hide-mobile">
            <span>Product & Merchant</span>
            <span>Created At</span>
            <span>Stellar Tx</span>
            <span>Amount</span>
            <span>Status</span>
            <span style={{ textAlign: 'right' }}>Actions</span>
          </div>

          <div className="workspace-list-rows">
            {purchases.map((order) => (
              <div className="order-row-wrapper" key={order.id}>
                <article className="order-list-row">
                  {/* Product */}
                  <div className="order-row-product">
                    {order.product_image ? (
                      <img src={order.product_image} alt="" className="order-thumbnail" loading="lazy" />
                    ) : (
                      <div className="order-thumbnail-placeholder">
                        <Package size={18} />
                      </div>
                    )}
                    <div className="order-product-info">
                      <strong>{order.product_name}</strong>
                      <span>{order.site_name || 'Connected Merchant'}</span>
                    </div>
                  </div>

                  {/* Date */}
                  <div className="order-row-date">
                    <span>{formatDate(order.created_at)}</span>
                  </div>

                  {/* Stellar Hash */}
                  <div className="order-row-hash">
                    {order.stellar_tx_hash ? (
                      order.explorerUrl ? (
                        <a
                          href={order.explorerUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="explorer-hash-link"
                        >
                          <code>{order.stellar_tx_hash.slice(0, 10)}…</code>
                          <ArrowSquareOut size={12} />
                        </a>
                      ) : (
                        <code>{order.stellar_tx_hash.slice(0, 10)}…</code>
                      )
                    ) : (
                      <span className="hash-pending">Pending confirmation</span>
                    )}
                  </div>

                  {/* Price */}
                  <div className="order-row-price">
                    <span>{Number(order.price_xlm).toFixed(7)} XLM</span>
                  </div>

                  {/* Status */}
                  <div className="order-row-status">
                    <span className={`status-pill ${order.statusInfo?.stage || order.status}`}>
                      {order.statusInfo?.label || order.status.replaceAll('_', ' ')}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="order-row-actions">
                    <button className="details-toggle-btn" onClick={() => void toggleWorkflow(order.id)}>
                      {expandedOrder === order.id ? 'Hide Activity' : 'View Activity'}
                    </button>
                  </div>
                </article>

                {/* Workflow Drawer */}
                {expandedOrder === order.id && (
                  <div className="order-workflow-drawer animate-fade-in">
                    <div className="workflow-drawer-header">
                      <span>Order Fulfillment Flow</span>
                      {order.reconciliation_run_after && order.status !== 'confirmed' && order.status !== 'failed' && (
                        <span className="workflow-retry-tag">
                          Next sync attempt: {formatDate(order.reconciliation_run_after)}
                        </span>
                      )}
                    </div>
                    <ol className="order-workflow-steps">
                      {(workflow[order.id] || []).length ? (
                        workflow[order.id].map((event) => (
                          <li key={event.id} className="workflow-step-item">
                            <span className={`workflow-dot ${event.status}`} />
                            <div className="workflow-step-content">
                              <div className="workflow-step-title">
                                <b>{event.stage.replaceAll('_', ' ')}</b>
                                <time>{formatDate(event.created_at)}</time>
                              </div>
                              <p className="workflow-step-desc">{event.detail || event.status}</p>
                            </div>
                          </li>
                        ))
                      ) : (
                        <li className="workflow-empty-step">
                          <Clock size={16} />
                          <span>Preparing fulfillment steps...</span>
                        </li>
                      )}
                    </ol>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </WorkspaceShell>
  );
}

export function WalletActivityView() {
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    api
      .get('/wallet/activity')
      .then(({ data }) => live && setActivity(data.activity || []))
      .catch(() => live && setActivity([]))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  return (
    <WorkspaceShell
      icon={<Wallet size={22} weight="fill" />}
      title="Wallet Activity Log"
      subtitle="Complete historical audit trail of funding operations, limits, and smart contract policies."
    >
      {loading ? (
        <div className="workspace-loading-state">
          <div className="spinner-lg" />
          <p>Loading activity ledger...</p>
        </div>
      ) : activity.length === 0 ? (
        <div className="workspace-empty">
          <Clock size={34} />
          <h3>No wallet operations yet</h3>
          <p>Operations will be recorded as soon as you fund your wallet or execute purchases.</p>
        </div>
      ) : (
        <div className="workspace-list-container">
          <div className="workspace-list-header hide-mobile wallet-activity-header">
            <span>Operation Details</span>
            <span>Logged Time</span>
            <span>Stellar Tx</span>
            <span style={{ textAlign: 'right' }}>Value Impact</span>
          </div>

          <div className="workspace-list-rows">
            {activity.map((item) => (
              <article className="activity-list-row" key={item.id}>
                <div className="activity-row-main">
                  <div className="activity-type-icon">
                    {item.type === 'purchase' ? <Package size={16} /> : <ShieldCheck size={16} />}
                  </div>
                  <div className="activity-title-info">
                    <strong>{item.title}</strong>
                    <span>{item.type === 'purchase' ? 'Merchant Payment' : 'Safeguard Policy Update'}</span>
                  </div>
                </div>

                <div className="activity-row-date">
                  <span>{formatDate(item.createdAt)}</span>
                </div>

                <div className="activity-row-tx">
                  {item.explorerUrl ? (
                    <a href={item.explorerUrl} target="_blank" rel="noopener noreferrer" className="explorer-hash-link" aria-label="View transaction on Stellar Explorer">
                      <code>{item.txHash.slice(0, 10)}…</code>
                      <ArrowSquareOut size={12} />
                    </a>
                  ) : <span>—</span>}
                </div>

                <div className="activity-row-value">
                  {item.amountXlm ? (
                    <span className="negative-impact">
                      −{item.amountXlm.toFixed(7)} XLM
                    </span>
                  ) : (
                    <span className="status-badge-neutral">{item.status || 'Success'}</span>
                  )}
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </WorkspaceShell>
  );
}

export function StoresView({ onConnectStore, refreshKey }) {
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () =>
    api
      .get('/sites')
      .then(({ data }) => setSites(data.sites || []))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, [refreshKey]);

  return (
    <WorkspaceShell
      icon={<ShieldCheck size={22} weight="fill" />}
      title="Connected Stores & Safeguards"
      subtitle="Manage smart contract spending limits and API access permissions for authorized storefronts."
      action={
        <button className="btn btn-primary" onClick={onConnectStore} id="workspace-connect-store-btn">
          <PlusCircle size={15} weight="bold" />
          <span>Connect Store</span>
        </button>
      }
    >
      {loading ? (
        <div className="workspace-loading-state">
          <div className="spinner-lg" />
          <p>Loading store configurations...</p>
        </div>
      ) : sites.length === 0 ? (
        <div className="workspace-empty workspace-empty--stores">
          <ShieldCheck size={38} />
          <h3>Connect your first storefront</h3>
          <p>Integrate your e-commerce profile to restrict agent access and enforce spending limits.</p>
          <button className="btn btn-primary" onClick={onConnectStore}>
            <PlusCircle size={15} weight="bold" />
            <span>Connect store</span>
          </button>
        </div>
      ) : (
        <div className="workspace-list-container">
          <div className="workspace-list-header hide-mobile store-table-header">
            <span>Merchant Channels</span>
            <span>Channel Status</span>
            <span>Daily CAP Limit</span>
            <span>On-Chain Policy</span>
            <span style={{ textAlign: 'right' }}>Safeguard status</span>
          </div>

          <div className="workspace-list-rows">
            {sites.map((site) => (
              <article className="store-list-row" key={site.id}>
                {/* Brand & URL */}
                <div className="store-row-brand">
                  <div className="store-avatar">
                    <Storefront size={18} weight="fill" />
                  </div>
                  <div className="store-info">
                    <strong>{site.site_name}</strong>
                    <span>{site.site_url}</span>
                  </div>
                </div>

                {/* Channel Status */}
                <div className="store-row-status">
                  <span className={`status-pill ${site.status}`}>
                    {site.status.replaceAll('_', ' ')}
                  </span>
                </div>

                {/* Daily Cap & Order Limit */}
                <div className="store-row-limits">
                  <div className="limit-metric">
                    <strong>{Number(site.spending_cap).toFixed(2)} XLM</strong>
                    <span>Cap/order: {Number(site.per_transaction_cap).toFixed(0)} XLM</span>
                  </div>
                </div>

                {/* On-Chain policy */}
                <div className="store-row-policy">
                  <span className={`policy-sync-tag ${site.policy_synced_at ? 'synced' : 'pending'}`}>
                    {site.policy_synced_at ? 'Synced' : 'Sync Pending'}
                  </span>
                  {site.policy_sync_error && (
                    <span className="policy-sync-error" title={site.policy_sync_error}>
                      Error warning
                    </span>
                  )}
                </div>

                {/* Policies are synchronized automatically on authorization and changes. */}
                <div className="store-row-actions">
                  <span className="store-auto-policy">Automatic</span>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </WorkspaceShell>
  );
}

function WorkspaceShell({ icon, title, subtitle, action, children }) {
  return (
    <main className="workspace">
      <header className="workspace-header">
        <div className="workspace-title-icon">{icon}</div>
        <div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        {action && <div className="workspace-header-action">{action}</div>}
      </header>
      {children}
    </main>
  );
}
