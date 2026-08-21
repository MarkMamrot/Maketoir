'use client';

import { useState, type ChangeEvent } from 'react';
import { AlertCircle, ArrowLeft, Check, ClipboardList, Download, ListPlus, Upload, X } from 'lucide-react';
import {
  buildWholesaleQuickOrder,
  buildWholesaleQuickOrderTemplate,
  type WholesaleQuickOrderItem,
  type WholesaleQuickOrderProduct,
  type WholesaleQuickOrderResult,
} from '@/lib/wholesale/wholesaleQuickOrder';
import styles from './WholesaleQuickOrderPanel.module.css';

function currency(value: number) {
  return value.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
}

export function WholesaleQuickOrderPanel({
  products,
  existingQuantities,
  onAdd,
  onClose,
}: {
  products: WholesaleQuickOrderProduct[];
  existingQuantities: Record<string, number>;
  onAdd: (items: WholesaleQuickOrderItem[]) => void;
  onClose: () => void;
}) {
  const [input, setInput] = useState('');
  const [result, setResult] = useState<WholesaleQuickOrderResult | null>(null);
  const [fileName, setFileName] = useState('');
  const [fileError, setFileError] = useState('');

  const review = () => setResult(buildWholesaleQuickOrder(input, products, existingQuantities));
  const downloadTemplate = () => {
    const blob = new Blob([buildWholesaleQuickOrderTemplate(products)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'wholesale-quick-order-template.csv';
    link.click();
    URL.revokeObjectURL(url);
  };
  const uploadCsv = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setFileError('');
    if (file.size > 1024 * 1024) {
      setFileError('CSV files must be 1 MB or smaller.');
      return;
    }
    try {
      setInput(await file.text());
      setResult(null);
      setFileName(file.name);
    } catch {
      setFileError('The CSV file could not be read.');
    }
  };

  return (
    <div className={styles.layer} role="dialog" aria-modal="true" aria-labelledby="quick-order-title">
      <button className={styles.backdrop} onClick={onClose} aria-label="Close quick order" />
      <aside className={styles.panel}>
        <header className={styles.header}>
          <div><span>Catalogue tool</span><h2 id="quick-order-title">Quick order</h2></div>
          <button className={styles.iconButton} onClick={onClose} aria-label="Close quick order" title="Close"><X size={18} /></button>
        </header>

        <div className={styles.body}>
          {!result ? (
            <>
              <div className={styles.fileActions}>
                <label className={styles.uploadButton}>
                  <Upload size={15} /> Upload CSV
                  <input type="file" accept=".csv,text/csv" onChange={uploadCsv} />
                </label>
                <button className={styles.downloadButton} onClick={downloadTemplate} disabled={products.length === 0}><Download size={15} /> Download template</button>
                {fileName && <span title={fileName}>{fileName}</span>}
              </div>
              {fileError && <div className={styles.fileError} role="alert">{fileError}</div>}
              <label className={styles.inputGroup}>
                <span><ClipboardList size={16} /> SKU or barcode, quantity</span>
                <textarea
                  value={input}
                  onChange={event => { setInput(event.target.value); setFileName(''); }}
                  rows={12}
                  spellCheck={false}
                  autoFocus
                  placeholder={'RAIN-GRN-M, 12\n930000000001, 4'}
                />
              </label>
            </>
          ) : (
            <>
              <section className={styles.summary}>
                <div><span>Accepted</span><strong>{result.items.length}</strong></div>
                <div><span>Units to add</span><strong>{result.items.reduce((sum, item) => sum + item.qty, 0)}</strong></div>
                <div><span>Needs attention</span><strong>{result.issues.length}</strong></div>
              </section>

              {result.adjustedLines > 0 && (
                <div className={styles.adjusted}><AlertCircle size={15} /> {result.adjustedLines} line{result.adjustedLines === 1 ? '' : 's'} adjusted to current available stock.</div>
              )}

              {result.items.length > 0 && (
                <section className={styles.reviewSection}>
                  <h3>Ready to add</h3>
                  {result.items.map(item => (
                    <div className={styles.item} key={item.variant_id}>
                      <div><strong>{item.product_name}</strong><span>{[item.variant_label, item.sku].filter(Boolean).join(' | ')}</span></div>
                      <div><span>Add</span><strong>{item.qty}</strong></div>
                      <div><span>Unit price</span><strong>{currency(item.unit_price)}</strong></div>
                      {item.is_indent && <small>{item.indent_qty} total on indent</small>}
                    </div>
                  ))}
                </section>
              )}

              {result.issues.length > 0 && (
                <section className={styles.reviewSection}>
                  <h3>Needs attention</h3>
                  {result.issues.map(issue => (
                    <div className={styles.issue} key={`${issue.line}-${issue.identifier}`}>
                      <strong>Line {issue.line}: {issue.identifier}</strong><span>{issue.reason}</span>
                    </div>
                  ))}
                </section>
              )}
            </>
          )}
        </div>

        <footer className={styles.footer}>
          {!result ? (
            <button className={styles.primaryButton} onClick={review} disabled={!input.trim()}><Check size={15} /> Review lines</button>
          ) : (
            <>
              <button className={styles.secondaryButton} onClick={() => setResult(null)}><ArrowLeft size={15} /> Edit lines</button>
              <button className={styles.primaryButton} onClick={() => onAdd(result.items)} disabled={result.items.length === 0}><ListPlus size={15} /> Add to cart</button>
            </>
          )}
        </footer>
      </aside>
    </div>
  );
}