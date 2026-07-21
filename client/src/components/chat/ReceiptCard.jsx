import { useEffect, useState } from 'react';
import { CheckCircle, ShoppingBag, ArrowSquareOut, MapPin, Package, ShieldCheck } from '@phosphor-icons/react';
import api from '../../services/api';
import TransactionHash from '../common/TransactionHash';

const formatXlm = (value) => Number.isFinite(Number(value))
  ? `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 7 })} XLM`
  : 'Not provided by merchant';

const truncateHash = (hash) => hash ? `${hash.slice(0, 8)}...${hash.slice(-8)}` : '';

export default function ReceiptCard({ product, purchase }) {
  const [invoiceResult, setInvoiceResult] = useState(null);
  const [invoiceLoading, setInvoiceLoading] = useState(Boolean(purchase?.purchaseId));

  useEffect(() => {
    let active = true;
    if (!purchase?.purchaseId) {
      setInvoiceLoading(false);
      return () => { active = false; };
    }
    api.get(`/purchases/${purchase.purchaseId}/invoice`)
      .then(({ data }) => { if (active) setInvoiceResult(data); })
      .catch(() => { if (active) setInvoiceResult(null); })
      .finally(() => { if (active) setInvoiceLoading(false); });
    return () => { active = false; };
  }, [purchase?.purchaseId]);

  const invoice = invoiceResult?.invoice;
  const invoicePurchase = invoiceResult?.purchase;
  const transactionHash = invoicePurchase?.transactionHash || purchase?.txHash;
  const explorerUrl = invoicePurchase?.explorerUrl || purchase?.explorerUrl || (transactionHash ? `https://stellar.expert/explorer/testnet/tx/${transactionHash}` : null);
  const timestamp = invoicePurchase?.confirmedAt || invoicePurchase?.createdAt || purchase?.timestamp || purchase?.receiptData?.timestamp;
  const date = timestamp ? new Date(timestamp) : null;
  const displayTime = date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : 'Confirmed on Stellar';
  const items = invoice?.items?.length
    ? invoice.items
    : [{ name: product.name, image: product.image, quantity: 1, unitPriceXlm: product.price }];
  const delivery = invoice?.delivery;

  return (
    <article className="receipt-card receipt-card--success" aria-label="Purchase invoice">
      <div className="receipt-card-header">
        <CheckCircle size={16} weight="fill" />
        Payment confirmed
        {invoice?.merchant?.orderId && <span className="receipt-card-order">Order {invoice.merchant.orderId}</span>}
      </div>

      <div className="receipt-card-product">
        <div className="receipt-card-product-image">
          {product.image ? <img src={product.image} alt={product.name} loading="lazy" /> : <ShoppingBag size={20} weight="duotone" />}
        </div>
        <div className="receipt-card-product-info">
          <span className="receipt-card-product-name">{items[0]?.name || product.name}</span>
          <span className="receipt-card-product-site">{invoice?.merchant?.url || product.siteName || 'Store'}</span>
        </div>
      </div>

      <div className="receipt-card-divider" />

      <section className="receipt-card-section">
        <div className="receipt-card-section-title"><Package size={14} weight="bold" /> Items</div>
        {items.map((item, index) => (
          <div className="receipt-card-item" key={`${item.productId || item.name}-${index}`}>
            <span>{item.quantity || 1}× {item.name}<small>{formatXlm(item.unitPriceXlm)} each</small></span>
            <strong>{formatXlm(item.lineTotalXlm ?? item.unitPriceXlm)}</strong>
          </div>
        ))}
      </section>

      <section className="receipt-card-section receipt-card-totals">
        {invoice ? <>
          <div className="receipt-card-row"><span className="receipt-card-label">Items subtotal</span><span className="receipt-card-value">{formatXlm(invoice.totals.subtotalXlm)}</span></div>
          <div className="receipt-card-row"><span className="receipt-card-label">Delivery</span><span className="receipt-card-value">{formatXlm(invoice.totals.shippingXlm)}</span></div>
          {invoice.totals.taxXlm != null && <div className="receipt-card-row"><span className="receipt-card-label">Tax</span><span className="receipt-card-value">{formatXlm(invoice.totals.taxXlm)}</span></div>}
          {invoice.totals.discountXlm > 0 && <div className="receipt-card-row"><span className="receipt-card-label">Discount</span><span className="receipt-card-value">−{formatXlm(invoice.totals.discountXlm)}</span></div>}
        </> : <div className="receipt-card-row"><span className="receipt-card-label">Verified merchant total</span><span className="receipt-card-value">{invoiceLoading ? 'Loading invoice…' : formatXlm(purchase?.priceXlm)}</span></div>}
        <div className="receipt-card-total"><span>Total paid</span><strong>{formatXlm(invoice?.totals?.totalXlm ?? purchase?.priceXlm)}</strong></div>
      </section>

      {delivery?.fullName && <section className="receipt-card-section receipt-card-delivery">
        <div className="receipt-card-section-title"><MapPin size={14} weight="bold" /> Delivery details</div>
        <address>{delivery.fullName}<br />{delivery.line1}<br />{[delivery.city, delivery.state, delivery.postalCode].filter(Boolean).join(', ')}<br />{delivery.country}</address>
      </section>}

      <section className="receipt-card-section receipt-card-payment">
        <div className="receipt-card-section-title"><ShieldCheck size={14} weight="bold" /> Stellar payment</div>
        <div className="receipt-card-row"><span className="receipt-card-label">Network</span><span className="receipt-card-value">Testnet</span></div>
        <div className="receipt-card-row"><span className="receipt-card-label">Receipt memo</span><span className="receipt-card-value receipt-card-mono">{truncateHash(invoicePurchase?.receiptMemoHash || purchase?.memoHash) || 'Not provided'}</span></div>
      </section>

      <div className="receipt-card-row receipt-card-transaction">
        <span className="receipt-card-label">Transaction</span>
        <span className="receipt-card-value">
          {transactionHash ? <TransactionHash hash={transactionHash} explorerUrl={explorerUrl} className="receipt-transaction-hash" /> : 'Transaction unavailable'}
        </span>
      </div>
      <div className="receipt-card-row"><span className="receipt-card-label">Confirmed</span><span className="receipt-card-value">{displayTime}</span></div>

      {explorerUrl && <div className="receipt-card-footer">
        <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="receipt-card-explorer-btn">
          View on Stellar Explorer <ArrowSquareOut size={14} />
        </a>
      </div>}
    </article>
  );
}
