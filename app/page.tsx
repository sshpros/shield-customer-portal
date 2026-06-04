'use client';

import { useEffect, useState, useRef } from 'react';

const SUPABASE_URL = 'https://fzzpdojbuwgmylmadupm.supabase.co/functions/v1';
const NMI_TOKENIZATION_KEY = 'checkout_public_Ahqyu2pp5FfRv892dFjB7Yy6JS53CD4A';
const BLUE = '#1a5cbf';
const GREEN = '#16a34a';
const RED = '#dc2626';

interface MonitoringContact { id: string; name: string; phone: string; dispatchType: string; }
interface PaymentMethod { id: string; last4: string; brand: string; payment_type: string; expiry: string; nickname: string; is_primary: boolean; created_at: string; }
interface PortalData {
  customer: { id: string; name: string; email: string; phone: string; secondaryContactName: string; secondaryContactPhone: string; };
  monitoring: { active: boolean; cost: number; frequency: string; accountId: string; verbalPassword: string; contacts: MonitoringContact[]; hasCertificate: boolean; };
  paymentMethods: PaymentMethod[];
}

declare global {
  interface Window {
    CollectJS: {
      configure: (opts: object) => void;
      startPaymentRequest: () => void;
    };
  }
}

export default function PortalPage() {
  const [token, setToken] = useState<string | null>(null);
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [showVerbalPassword, setShowVerbalPassword] = useState(false);
  const [showAddCard, setShowAddCard] = useState(false);
  const [collectReady, setCollectReady] = useState(false);
  const [addingCard, setAddingCard] = useState(false);
  const [cardMsg, setCardMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [certLoading, setCertLoading] = useState(false);
  const collectConfigured = useRef(false);

  // Read token from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('token');
    if (!t) { setError('No access link found. Please use the link sent by your security provider.'); setLoading(false); return; }
    setToken(t);
  }, []);

  // Fetch portal data once token is set
  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await fetch(`${SUPABASE_URL}/customer-portal-data`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const json = await res.json();
        if (!res.ok || json.error) { setError(json.error ?? 'Failed to load your account.'); }
        else { setData(json); }
      } catch { setError('Network error. Please try again.'); }
      setLoading(false);
    })();
  }, [token]);

  // Load Collect.js when add card is shown
  useEffect(() => {
    if (!showAddCard) return;
    if (document.getElementById('collect-js-script')) {
      configureCollect();
      return;
    }
    const script = document.createElement('script');
    script.id = 'collect-js-script';
    script.src = 'https://secure.nmi.com/token/Collect.js';
    script.setAttribute('data-tokenization-key', NMI_TOKENIZATION_KEY);
    script.setAttribute('data-variant', 'inline');
    script.onload = () => configureCollect();
    document.head.appendChild(script);
  }, [showAddCard]); // eslint-disable-line react-hooks/exhaustive-deps

  function configureCollect() {
    if (collectConfigured.current) { setCollectReady(true); return; }
    if (!window.CollectJS) { setTimeout(configureCollect, 200); return; }
    collectConfigured.current = true;
    window.CollectJS.configure({
      variant: 'inline',
      styleSniffer: false,
      fields: {
        ccnumber: { selector: '#ccnumber', placeholder: 'Card number' },
        ccexp: { selector: '#ccexp', placeholder: 'MM/YY' },
        cvv: { selector: '#cvv', placeholder: 'CVV' },
      },
      customCss: {
        'background-color': '#f8fafc',
        'border': '1px solid #cbd5e1',
        'border-radius': '8px',
        'padding': '12px',
        'font-size': '15px',
        'color': '#1e293b',
        'height': '44px',
        'width': '100%',
        'box-sizing': 'border-box',
      },
      callback: (resp: { token: string; card?: { type: string } }) => {
        handleCardToken(resp.token, resp.card?.type ?? '');
      },
    });
    setCollectReady(true);
  }

  async function handleCardToken(paymentToken: string, cardType: string) {
    if (!token || !data) return;
    setAddingCard(true);
    setCardMsg(null);
    try {
      const res = await fetch(`${SUPABASE_URL}/customer-portal-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, action: 'add', payment_token: paymentToken, card_type: cardType, set_as_primary: data.paymentMethods.length === 0 }),
      });
      const json = await res.json();
      if (!res.ok || json.error) { setCardMsg({ text: json.error ?? 'Failed to save card.', ok: false }); }
      else {
        setCardMsg({ text: 'Card saved successfully.', ok: true });
        setData(d => d ? { ...d, paymentMethods: [...d.paymentMethods, json.method].sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0)) } : d);
        setTimeout(() => { setShowAddCard(false); setCardMsg(null); collectConfigured.current = false; }, 1500);
      }
    } catch { setCardMsg({ text: 'Network error.', ok: false }); }
    setAddingCard(false);
  }

  async function setPrimary(methodId: string) {
    if (!token) return;
    setActionLoading(methodId + '_primary');
    try {
      const res = await fetch(`${SUPABASE_URL}/customer-portal-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, action: 'set_primary', method_id: methodId }),
      });
      const json = await res.json();
      if (json.success) {
        setData(d => d ? { ...d, paymentMethods: d.paymentMethods.map(m => ({ ...m, is_primary: m.id === methodId })) } : d);
      }
    } catch { /* ignore */ }
    setActionLoading(null);
  }

  async function deleteMethod(methodId: string) {
    if (!token || !confirm('Remove this payment method?')) return;
    setActionLoading(methodId + '_delete');
    try {
      const res = await fetch(`${SUPABASE_URL}/customer-portal-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, action: 'delete', method_id: methodId }),
      });
      const json = await res.json();
      if (json.success) {
        setData(d => d ? { ...d, paymentMethods: d.paymentMethods.filter(m => m.id !== methodId) } : d);
      } else { alert(json.error ?? 'Could not remove method.'); }
    } catch { /* ignore */ }
    setActionLoading(null);
  }

  async function downloadCertificate() {
    if (!token) return;
    setCertLoading(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/customer-portal-certificate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const json = await res.json();
      if (json.url) { window.open(json.url, '_blank'); }
      else { alert('Could not generate download link. Please try again.'); }
    } catch { alert('Network error.'); }
    setCertLoading(false);
  }

  if (loading) return <Loading />;
  if (error) return <ErrorPage message={error} />;
  if (!data) return null;

  const { customer, monitoring, paymentMethods } = data;
  const sortedMethods = [...paymentMethods].sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0));

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', paddingBottom: 48 }}>
      {/* Header */}
      <div style={{ background: BLUE, padding: '20px 24px', color: '#fff' }}>
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
          <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 4 }}>Shield Low Voltage</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>My Account</div>
          <div style={{ fontSize: 14, opacity: 0.85, marginTop: 4 }}>{customer.name}</div>
        </div>
      </div>

      <div style={{ maxWidth: 640, margin: '0 auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Monitoring */}
        <Card title="Monitoring Plan">
          {monitoring.active ? (
            <>
              <Badge color={GREEN} text="Central Station Monitoring — Active" />
              <Row label="Monthly Cost" value={monitoring.cost > 0 ? `$${monitoring.cost.toFixed(2)} / ${monitoring.frequency}` : '—'} />
              {monitoring.accountId && <Row label="Account ID" value={monitoring.accountId} mono />}
              {monitoring.verbalPassword && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
                  <span style={{ fontSize: 13, color: '#64748b' }}>Verbal Password</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 500, fontFamily: showVerbalPassword ? 'monospace' : 'inherit' }}>
                      {showVerbalPassword ? monitoring.verbalPassword : '••••••••'}
                    </span>
                    <button onClick={() => setShowVerbalPassword(v => !v)} style={linkBtn}>
                      {showVerbalPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>
              )}

              {monitoring.contacts.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>Emergency Contacts</div>
                  {monitoring.contacts.map((c) => (
                    <div key={c.id} style={{ background: '#f8fafc', borderRadius: 10, padding: '12px 14px', marginBottom: 8 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</div>
                      <div style={{ fontSize: 13, color: '#475569', marginTop: 2 }}>{c.phone}</div>
                      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{c.dispatchType}</div>
                    </div>
                  ))}
                </div>
              )}

              {monitoring.hasCertificate && (
                <button onClick={downloadCertificate} disabled={certLoading} style={{ ...outlineBtn, marginTop: 12, width: '100%' }}>
                  {certLoading ? 'Generating link…' : '⬇ Download Monitoring Certificate'}
                </button>
              )}
            </>
          ) : (
            <div style={{ fontSize: 14, color: '#64748b' }}>No active monitoring plan on file.</div>
          )}
        </Card>

        {/* Payment Methods */}
        <Card title="Payment Methods">
          {sortedMethods.length === 0 ? (
            <div style={{ fontSize: 14, color: '#64748b', marginBottom: 12 }}>No payment methods on file.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
              {sortedMethods.map((m) => {
                const label = m.last4 ? `${m.brand || (m.payment_type === 'ach' ? 'Bank' : 'Card')} •••• ${m.last4}` : m.brand || 'Payment method';
                const isPrimaryLoading = actionLoading === m.id + '_primary';
                const isDeleteLoading = actionLoading === m.id + '_delete';
                return (
                  <div key={m.id} style={{ background: '#f8fafc', border: m.is_primary ? `1.5px solid ${BLUE}` : '1.5px solid #e2e8f0', borderRadius: 12, padding: '14px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                      <CardIcon brand={m.brand} type={m.payment_type} />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 15 }}>{label}</div>
                        {m.expiry && <div style={{ fontSize: 12, color: '#64748b' }}>Exp {m.expiry}</div>}
                      </div>
                      {m.is_primary && <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: BLUE, background: `${BLUE}18`, padding: '3px 10px', borderRadius: 20 }}>DEFAULT</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {!m.is_primary && (
                        <button onClick={() => setPrimary(m.id)} disabled={!!actionLoading} style={smallBtn(BLUE)}>
                          {isPrimaryLoading ? '…' : 'Set as Default'}
                        </button>
                      )}
                      <button onClick={() => deleteMethod(m.id)} disabled={!!actionLoading || paymentMethods.length <= 1} style={smallBtn(RED)}>
                        {isDeleteLoading ? '…' : 'Remove'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {!showAddCard ? (
            <button onClick={() => { setShowAddCard(true); setCardMsg(null); }} style={primaryBtn}>
              + Add Payment Method
            </button>
          ) : (
            <div style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: 12, padding: 16, marginTop: 4 }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 14 }}>New Card</div>

              <div style={{ marginBottom: 12 }}>
                <label style={fieldLabel}>Card Number</label>
                <div id="ccnumber" style={collectField} />
              </div>
              <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                <div style={{ flex: 1 }}>
                  <label style={fieldLabel}>Expiry</label>
                  <div id="ccexp" style={collectField} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={fieldLabel}>CVV</label>
                  <div id="cvv" style={collectField} />
                </div>
              </div>

              {cardMsg && (
                <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 12, background: cardMsg.ok ? '#f0fdf4' : '#fef2f2', color: cardMsg.ok ? GREEN : RED, fontSize: 13, fontWeight: 500 }}>
                  {cardMsg.text}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={() => { if (collectReady && !addingCard) window.CollectJS.startPaymentRequest(); }}
                  disabled={!collectReady || addingCard}
                  style={{ ...primaryBtn, flex: 1 }}
                >
                  {addingCard ? 'Saving…' : !collectReady ? 'Loading…' : 'Save Card'}
                </button>
                <button onClick={() => { setShowAddCard(false); setCardMsg(null); collectConfigured.current = false; }} style={{ ...outlineBtn, padding: '12px 18px' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </Card>

        {/* Contact Info (read-only) */}
        <Card title="Contact Information">
          <Row label="Primary Phone" value={customer.phone || '—'} />
          <Row label="Email" value={customer.email || '—'} />
          {customer.secondaryContactName && (
            <>
              <div style={{ height: 1, background: '#f1f5f9', margin: '8px 0' }} />
              <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Secondary Contact</div>
              <Row label="Name" value={customer.secondaryContactName} />
              {customer.secondaryContactPhone && <Row label="Phone" value={customer.secondaryContactPhone} />}
            </>
          )}
          <div style={{ marginTop: 12, padding: '10px 14px', background: '#f8fafc', borderRadius: 8, fontSize: 12, color: '#64748b' }}>
            To update your contact information, please call us at <strong>(928) 843-7767</strong>.
          </div>
        </Card>

        <div style={{ textAlign: 'center', fontSize: 12, color: '#94a3b8' }}>
          Shield Low Voltage · Your account is secure
        </div>
      </div>
    </div>
  );
}

// ─── Small components ──────────────────────────────────────────────────────────

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', borderRadius: 16, padding: '20px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, color: '#0f172a' }}>{title}</div>
      {children}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
      <span style={{ fontSize: 13, color: '#64748b' }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 500, fontFamily: mono ? 'monospace' : 'inherit' }}>{value}</span>
    </div>
  );
}

function Badge({ color, text }: { color: string; text: string }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: `${color}18`, color, padding: '5px 12px', borderRadius: 20, fontSize: 13, fontWeight: 600, marginBottom: 14 }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, display: 'inline-block' }} />
      {text}
    </div>
  );
}

function CardIcon({ brand, type }: { brand: string; type: string }) {
  if (type === 'ach') return <span style={{ fontSize: 20 }}>🏦</span>;
  if (brand === 'Visa') return <span style={{ fontSize: 20, fontWeight: 900, color: '#1a1f71', fontStyle: 'italic' }}>VISA</span>;
  if (brand === 'Mastercard') return <span style={{ fontSize: 20 }}>💳</span>;
  if (brand === 'Amex') return <span style={{ fontSize: 13, fontWeight: 800, color: '#007bc1' }}>AMEX</span>;
  return <span style={{ fontSize: 20 }}>💳</span>;
}

function Loading() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, background: '#f1f5f9' }}>
      <div style={{ width: 40, height: 40, border: `3px solid ${BLUE}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ color: '#64748b', fontSize: 14 }}>Loading your account…</div>
    </div>
  );
}

function ErrorPage({ message }: { message: string }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9', padding: 24 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: '32px 28px', maxWidth: 420, width: '100%', textAlign: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>🔒</div>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 10, color: '#0f172a' }}>Link Unavailable</div>
        <div style={{ fontSize: 14, color: '#64748b', lineHeight: 1.6, marginBottom: 24 }}>{message}</div>
        <div style={{ fontSize: 13, color: '#94a3b8' }}>Please contact Shield Low Voltage for a new link.</div>
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const primaryBtn: React.CSSProperties = {
  background: BLUE, color: '#fff', border: 'none', borderRadius: 10,
  padding: '13px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer', width: '100%',
};
const outlineBtn: React.CSSProperties = {
  background: 'transparent', color: BLUE, border: `1.5px solid ${BLUE}`, borderRadius: 10,
  padding: '13px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
};
const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: BLUE, fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0,
};
const fieldLabel: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em',
};
const collectField: React.CSSProperties = {
  height: 44, borderRadius: 8, overflow: 'hidden',
};
const smallBtn = (color: string): React.CSSProperties => ({
  background: `${color}12`, color, border: `1px solid ${color}30`, borderRadius: 8,
  padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
});
