'use client';

import { useEffect, useState, useRef } from 'react';

const SUPABASE_URL = 'https://fzzpdojbuwgmylmadupm.supabase.co/functions/v1';
const NMI_TOKENIZATION_KEY = 'checkout_public_Ahqyu2pp5FfRv892dFjB7Yy6JS53CD4A';
// Theme tokens live in globals.css; these read through so the same names keep working.
const BLUE = 'var(--accent)';          // fills: header band, primary buttons
const BLUE_TEXT = 'var(--accent-text)'; // text links, outline buttons, selected borders
const GREEN = 'var(--green)';
const RED = 'var(--red)';

interface MonitoringContact { id: string; name: string; phone: string; dispatchType: string; }
interface PaymentMethod { id: string; last4: string; brand: string; payment_type: string; expiry: string; nickname: string; is_primary: boolean; created_at: string; }
interface Service { id: string; name: string; amount: number; frequency: string; autoPay: boolean; nextChargeDate: string | null; lastCharged: { amount: number; date: string } | null; }
interface Invoice { id: string; number: string; title: string; status: string; total: number; paid: number; balance: number; date: string; dueDate: string | null; url: string; }
interface Doc { id: string; title: string; category: string; uploaded_at: string; }
interface PortalData {
  customer: { id: string; name: string; email: string; phone: string; secondaryContactName: string; secondaryContactPhone: string; };
  monitoring: { active: boolean; accountId: string; verbalPassword: string; contacts: MonitoringContact[]; hasCertificate: boolean; };
  paymentMethods: PaymentMethod[];
  services: Service[];
  invoices: Invoice[];
  documents: Doc[];
}

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
// DATE columns ("2026-11-01") render at local noon so they never slip a day.
const fmtDate = (s: string | null | undefined) => {
  if (!s) return '';
  const d = new Date(s.length <= 10 ? s + 'T12:00:00' : s);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};
// Sign-in session (from customer-portal-auth). Tab-scoped on purpose: closing
// the tab or coming back later means a new emailed code (Kyle 2026-11-01).
const SESSION_KEY = 'shield-portal-session';
type StoredSession = { session: string; expiresAt: string };
function readSession(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    const s = raw ? (JSON.parse(raw) as StoredSession) : null;
    return s && new Date(s.expiresAt).getTime() > Date.now() + 30_000 ? s : null;
  } catch { return null; }
}
function writeSession(s: StoredSession | null) {
  try { s ? sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)) : sessionStorage.removeItem(SESSION_KEY); } catch { /* storage blocked: stay signed in for this page view only */ }
}

const perLabel = (f: string) => ({ Monthly: 'month', Quarterly: 'quarter', Yearly: 'year' } as Record<string, string>)[f] ?? f.toLowerCase();

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
  const [session, setSession] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [showVerbalPassword, setShowVerbalPassword] = useState(false);
  const [showAddCard, setShowAddCard] = useState(false);
  const [collectReady, setCollectReady] = useState(false);
  const [addingCard, setAddingCard] = useState(false);
  const [cardMsg, setCardMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [certLoading, setCertLoading] = useState(false);
  const [docLoading, setDocLoading] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const collectConfigured = useRef(false);

  // Read token from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('token');
    if (!t) { setError('No access link found. Please use the link sent by your security provider.'); setLoading(false); return; }
    setToken(t);
    const saved = readSession();
    if (saved) setSession(saved.session);
    else { setNeedsSignIn(true); setLoading(false); }
  }, []);

  /** A 401 with `signin` means the session ran out — back to the code screen. */
  function signedOut() {
    writeSession(null);
    setSession(null);
    setData(null);
    setNeedsSignIn(true);
    setLoading(false);
  }

  async function signOut() {
    const s = session;
    signedOut();
    if (s) fetch(`${SUPABASE_URL}/customer-portal-auth`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'sign_out', session: s }) }).catch(() => {});
  }

  // `#history` deep link (e.g. from a receipt email) opens Billing History.
  useEffect(() => {
    if (!data || window.location.hash !== '#history') return;
    setShowHistory(true);
    setTimeout(() => document.getElementById('history')?.scrollIntoView({ behavior: 'smooth' }), 50);
  }, [data]);

  // Fetch portal data once signed in
  useEffect(() => {
    if (!session) return;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`${SUPABASE_URL}/customer-portal-data`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session }),
        });
        const json = await res.json();
        if (res.status === 401 && json.signin) { signedOut(); return; }
        if (!res.ok || json.error) { setError(json.error ?? 'Failed to load your account.'); }
        else { setData(json); }
      } catch { setError('Network error. Please try again.'); }
      setLoading(false);
    })();
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    window.CollectJS.configure({
      variant: 'inline',
      styleSniffer: false,
      fields: {
        ccnumber: { selector: '#ccnumber', placeholder: 'Card number' },
        ccexp: { selector: '#ccexp', placeholder: 'MM/YY' },
        cvv: { selector: '#cvv', placeholder: 'CVV' },
      },
      // Hosted fields render inside NMI iframes, out of reach of the page's CSS
      // tokens — resolve the device scheme here so the card text stays readable.
      customCss: {
        'background-color': prefersDark ? '#26262f' : '#ffffff',
        'border': prefersDark ? '1px solid rgba(255,255,255,0.16)' : '1px solid #cbd5e1',
        'border-radius': '8px',
        'padding': '12px',
        'font-size': '15px',
        'color': prefersDark ? '#f4f5f7' : '#1a294d',
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
    if (!session || !data) return;
    setAddingCard(true);
    setCardMsg(null);
    try {
      const res = await fetch(`${SUPABASE_URL}/customer-portal-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session, action: 'add', payment_token: paymentToken, card_type: cardType }),
      });
      const json = await res.json();
      if (res.status === 401 && json.signin) { signedOut(); return; }
      if (!res.ok || json.error) { setCardMsg({ text: json.error ?? 'Failed to save card.', ok: false }); }
      else {
        setCardMsg({ text: 'Card saved. Future charges will use this card.', ok: true });
        setData(d => d ? { ...d, paymentMethods: [{ ...json.method, id: 'on-file', is_primary: true }] } : d);
        setTimeout(() => { setShowAddCard(false); setCardMsg(null); collectConfigured.current = false; }, 1500);
      }
    } catch { setCardMsg({ text: 'Network error.', ok: false }); }
    setAddingCard(false);
  }

  async function downloadDocument(documentId: string) {
    if (!session) return;
    setDocLoading(documentId);
    try {
      const res = await fetch(`${SUPABASE_URL}/customer-portal-document`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session, document_id: documentId }),
      });
      const json = await res.json();
      if (res.status === 401 && json.signin) { signedOut(); return; }
      if (json.url) { window.open(json.url, '_blank'); }
      else { alert('Could not generate download link. Please try again.'); }
    } catch { alert('Network error.'); }
    setDocLoading(null);
  }

  async function downloadCertificate() {
    if (!session) return;
    setCertLoading(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/customer-portal-certificate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session }),
      });
      const json = await res.json();
      if (res.status === 401 && json.signin) { signedOut(); return; }
      if (json.url) { window.open(json.url, '_blank'); }
      else { alert('Could not generate download link. Please try again.'); }
    } catch { alert('Network error.'); }
    setCertLoading(false);
  }

  if (error) return <ErrorPage message={error} />;
  if (needsSignIn && token) {
    return <SignIn token={token} onError={setError} onSignedIn={(s) => { writeSession(s); setNeedsSignIn(false); setSession(s.session); }} />;
  }
  if (loading) return <Loading />;
  if (!data) return null;

  const { customer, monitoring, paymentMethods, services = [], invoices = [], documents = [] } = data;
  const cardOnFile = paymentMethods[0];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', paddingBottom: 48 }}>
      {/* Header */}
      <div style={{ background: BLUE, padding: '20px 24px', color: '#fff' }}>
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
          <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 4 }}>Shield Low Voltage</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>My Account</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginTop: 4 }}>
            <div style={{ fontSize: 14, opacity: 0.85 }}>{customer.name}</div>
            <button onClick={signOut} style={{ background: 'none', border: 'none', color: '#fff', opacity: 0.85, fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 0 }}>Sign out</button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 640, margin: '0 auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Services — what the customer is charged (never our cost) */}
        {services.length > 0 && (
          <Card title="Your Services">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {services.map((s) => (
                <div key={s.id} style={{ background: 'var(--panel)', borderRadius: 12, padding: '14px 16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                    <span style={{ fontWeight: 600, fontSize: 15 }}>{s.name}</span>
                    <span style={{ fontWeight: 700, fontSize: 15, whiteSpace: 'nowrap' }}>{money(s.amount)}<span style={{ fontWeight: 500, fontSize: 12, color: 'var(--text-3)' }}> / {perLabel(s.frequency)}</span></span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 6 }}>
                    {s.autoPay
                      ? (s.nextChargeDate ? `Auto-pay · next charge ${fmtDate(s.nextChargeDate)}` : 'Auto-pay')
                      : 'Billed by invoice'}
                    {s.lastCharged && ` · last charged ${money(s.lastCharged.amount)} on ${fmtDate(s.lastCharged.date)}`}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 10 }}>Prices shown before applicable sales tax.</div>
          </Card>
        )}

        {/* Monitoring */}
        <Card title="Monitoring Plan">
          {monitoring.active ? (
            <>
              <Badge color={GREEN} text="Central Station Monitoring — Active" />
              {monitoring.accountId && <Row label="Account ID" value={monitoring.accountId} mono />}
              {monitoring.verbalPassword && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border-soft)' }}>
                  <span style={{ fontSize: 13, color: 'var(--text-3)' }}>Verbal Password</span>
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
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>Emergency Contacts</div>
                  {monitoring.contacts.map((c) => (
                    <div key={c.id} style={{ background: 'var(--panel)', borderRadius: 10, padding: '12px 14px', marginBottom: 8 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</div>
                      <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 2 }}>{c.phone}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>{c.dispatchType}</div>
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
            <div style={{ fontSize: 14, color: 'var(--text-3)' }}>No active monitoring plan on file.</div>
          )}
        </Card>

        {/* Payment Method — the card we charge */}
        <Card title="Payment Method">
          {!cardOnFile ? (
            <div style={{ fontSize: 14, color: 'var(--text-3)', marginBottom: 12 }}>No payment method on file.</div>
          ) : (
            <div style={{ background: 'var(--panel)', border: `1.5px solid ${BLUE_TEXT}`, borderRadius: 12, padding: '14px 16px', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <CardIcon brand={cardOnFile.brand} type={cardOnFile.payment_type} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>
                    {cardOnFile.last4 ? `${cardOnFile.brand || (cardOnFile.payment_type === 'ach' ? 'Bank' : 'Card')} •••• ${cardOnFile.last4}` : cardOnFile.brand || 'Payment method'}
                  </div>
                  {cardOnFile.expiry && <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Exp {cardOnFile.expiry}</div>}
                </div>
                <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: BLUE_TEXT, background: `color-mix(in srgb, ${BLUE_TEXT} 12%, transparent)`, padding: '3px 10px', borderRadius: 20 }}>ON FILE</span>
              </div>
            </div>
          )}

          {!showAddCard ? (
            <button onClick={() => { setShowAddCard(true); setCardMsg(null); }} style={primaryBtn}>
              {cardOnFile ? 'Replace Card' : '+ Add Payment Method'}
            </button>
          ) : (
            <div style={{ background: 'var(--panel)', border: '1.5px solid var(--border)', borderRadius: 12, padding: 16, marginTop: 4 }}>
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
                <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 12, background: cardMsg.ok ? 'var(--green-tint)' : 'var(--red-tint)', color: cardMsg.ok ? GREEN : RED, fontSize: 13, fontWeight: 500 }}>
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

        {/* Billing history — invoices + receipts, collapsed until opened */}
        {(invoices.length > 0 || documents.length > 0) && (
          <div id="history" style={{ background: 'var(--card)', borderRadius: 16, boxShadow: 'var(--shadow)' }}>
            <button
              onClick={() => setShowHistory(v => !v)}
              aria-expanded={showHistory}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, background: 'none', border: 'none', padding: '20px', cursor: 'pointer', color: 'var(--text)', textAlign: 'left' }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>Billing History</div>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
                  {(() => {
                    const n = (k: number, one: string, many: string) => k ? `${k} ${k === 1 ? one : many}` : '';
                    const receipts = documents.filter(d => d.category === 'Receipt').length;
                    return [n(invoices.length, 'invoice', 'invoices'), n(receipts, 'receipt', 'receipts'),
                            n(documents.length - receipts, 'signed estimate', 'signed estimates')].filter(Boolean).join(' · ');
                  })()}
                  {invoices.some(i => i.balance > 0.01) && <span style={{ color: RED, fontWeight: 600 }}> · balance due</span>}
                </div>
              </div>
              <span style={{ fontSize: 18, color: 'var(--text-3)', transform: showHistory ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>›</span>
            </button>

            {showHistory && (
              <div style={{ padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
                {invoices.length > 0 && (
                  <div>
                    <div style={sectionLabel}>Invoices</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {invoices.map((inv) => {
                          const owed = inv.balance > 0.01;
                          return (
                            <a key={inv.id} href={inv.url} target="_blank" rel="noopener noreferrer"
                               style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, background: 'var(--panel)', borderRadius: 10, padding: '12px 14px', textDecoration: 'none', color: 'inherit' }}>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontWeight: 600, fontSize: 14 }}>{inv.title || `Invoice ${inv.number}`}</div>
                                <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{inv.title ? `${inv.number} · ` : ''}{fmtDate(inv.date)}</div>
                              </div>
                              <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                                <div style={{ fontWeight: 600, fontSize: 14 }}>{money(inv.total)}</div>
                                <div style={{ fontSize: 12, fontWeight: 600, color: owed ? RED : GREEN, marginTop: 2 }}>{owed ? `${money(inv.balance)} due · Pay` : 'Paid'}</div>
                              </div>
                            </a>
                          );
                        })}
                      </div>
                  </div>
                )}
                {documents.length > 0 && (
                  <div>
                    <div style={sectionLabel}>Receipts &amp; Documents</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {documents.map((doc) => (
                        <div key={doc.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, background: 'var(--panel)', borderRadius: 10, padding: '12px 14px' }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 14 }}>{doc.title}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{doc.category} · {fmtDate(doc.uploaded_at)}</div>
                          </div>
                          <button onClick={() => downloadDocument(doc.id)} disabled={docLoading === doc.id} style={smallBtn(BLUE_TEXT)}>
                            {docLoading === doc.id ? '…' : 'Download'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Contact Info (read-only) */}
        <Card title="Contact Information">
          <Row label="Primary Phone" value={customer.phone || '—'} />
          <Row label="Email" value={customer.email || '—'} />
          {customer.secondaryContactName && (
            <>
              <div style={{ height: 1, background: 'var(--border-soft)', margin: '8px 0' }} />
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Secondary Contact</div>
              <Row label="Name" value={customer.secondaryContactName} />
              {customer.secondaryContactPhone && <Row label="Phone" value={customer.secondaryContactPhone} />}
            </>
          )}
          <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--panel)', borderRadius: 8, fontSize: 12, color: 'var(--text-3)' }}>
            To update your contact information, please call us at <strong>(928) 843-7767</strong>.
          </div>
        </Card>

        <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-dim)' }}>
          Shield Low Voltage · Your account is secure
        </div>
      </div>
    </div>
  );
}

// ─── Sign in ──────────────────────────────────────────────────────────────────

/** Every visit: email a 6-digit code to the address on file, then trade it for
 *  a session. Nothing is sent until the customer asks — mail scanners open
 *  links on their own. */
function SignIn({ token, onSignedIn, onError }: { token: string; onSignedIn: (s: StoredSession) => void; onError: (m: string) => void }) {
  const [info, setInfo] = useState<{ firstName: string; hasEmail: boolean; maskedEmail: string } | null>(null);
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  const call = async (body: object) => {
    const res = await fetch(`${SUPABASE_URL}/customer-portal-auth`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, ...body }) });
    return { status: res.status, json: await res.json().catch(() => ({ error: 'Something went wrong. Please try again.' })) };
  };

  useEffect(() => {
    (async () => {
      try {
        const { status, json } = await call({ action: 'start' });
        if (status === 401 || json.error) onError(json.error ?? 'This link has expired.');
        else setInfo(json);
      } catch { onError('Network error. Please try again.'); }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function sendCode() {
    setBusy(true); setMsg(null);
    try {
      const { json } = await call({ action: 'send_code' });
      if (json.error) setMsg({ text: json.error, ok: false });
      else { setSent(true); setCode(''); setMsg({ text: `Code sent to ${json.maskedEmail}. It expires in ${json.minutes} minutes.`, ok: true }); setTimeout(() => codeRef.current?.focus(), 50); }
    } catch { setMsg({ text: 'Network error. Please try again.', ok: false }); }
    setBusy(false);
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (code.replace(/\D/g, '').length !== 6) { setMsg({ text: 'Enter the 6-digit code from the email.', ok: false }); return; }
    setBusy(true); setMsg(null);
    try {
      const { json } = await call({ action: 'verify', code });
      if (json.session) onSignedIn({ session: json.session, expiresAt: json.expires_at });
      else { setMsg({ text: json.error ?? 'That code didn\'t work.', ok: false }); if (json.expired) setCode(''); }
    } catch { setMsg({ text: 'Network error. Please try again.', ok: false }); }
    setBusy(false);
  }

  if (!info) return <Loading />;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: 16 }}>
      <div style={{ background: 'var(--card)', borderRadius: 16, padding: '32px 24px', maxWidth: 420, width: '100%', boxShadow: 'var(--shadow)' }}>
        <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 6 }}>Shield Low Voltage</div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 10px', color: 'var(--text)' }}>Sign in to your account</h1>
        {!info.hasEmail ? (
          <p style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.6, margin: 0 }}>
            There&rsquo;s no email on your account yet, so we can&rsquo;t send you a sign-in code. Call or text Shield at (928) 843-7767 and we&rsquo;ll get you in.
          </p>
        ) : (
          <>
            <p style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.6, margin: '0 0 20px' }}>
              Hi {info.firstName}. To protect your account, we&rsquo;ll email a 6-digit code to <b style={{ color: 'var(--text)', whiteSpace: 'nowrap' }}>{info.maskedEmail}</b> each time you sign in.
            </p>
            {sent ? (
              <form onSubmit={verify} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <label htmlFor="code" style={fieldLabel}>Sign-in code</label>
                <input
                  id="code" ref={codeRef} value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} placeholder="••••••"
                  style={{ fontSize: 26, letterSpacing: '0.4em', textAlign: 'center', padding: '12px 10px', borderRadius: 10, border: '1px solid var(--border-strong)', background: 'var(--input-bg)', color: 'var(--text)', fontFamily: 'ui-monospace, Menlo, monospace', width: '100%', boxSizing: 'border-box' }}
                />
                <button type="submit" disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.7 : 1 }}>{busy ? 'Checking…' : 'Sign in'}</button>
                <button type="button" onClick={sendCode} disabled={busy} style={{ ...linkBtn, fontSize: 13, alignSelf: 'center', marginTop: 4 }}>Email me a new code</button>
              </form>
            ) : (
              <button onClick={sendCode} disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.7 : 1 }}>{busy ? 'Sending…' : 'Email me a code'}</button>
            )}
            {msg ? <div role="status" style={{ marginTop: 14, fontSize: 13, lineHeight: 1.5, color: msg.ok ? 'var(--text-3)' : RED }}>{msg.text}</div> : null}
          </>
        )}
        <div style={{ marginTop: 22, paddingTop: 16, borderTop: '1px solid var(--border-soft)', fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.6 }}>
          Shield will never ask for your card number or this code by phone, text or email.
        </div>
      </div>
    </div>
  );
}

// ─── Small components ──────────────────────────────────────────────────────────

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--card)', borderRadius: 16, padding: '20px 20px', boxShadow: 'var(--shadow)' }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, color: 'var(--text)' }}>{title}</div>
      {children}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border-soft)' }}>
      <span style={{ fontSize: 13, color: 'var(--text-3)' }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 500, fontFamily: mono ? 'monospace' : 'inherit' }}>{value}</span>
    </div>
  );
}

function Badge({ color, text }: { color: string; text: string }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: `color-mix(in srgb, ${color} 12%, transparent)`, color, padding: '5px 12px', borderRadius: 20, fontSize: 13, fontWeight: 600, marginBottom: 14 }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, display: 'inline-block' }} />
      {text}
    </div>
  );
}

function CardIcon({ brand, type }: { brand: string; type: string }) {
  if (type === 'ach') return <span style={{ fontSize: 20 }}>🏦</span>;
  if (brand === 'Visa') return <span style={{ fontSize: 20, fontWeight: 900, color: 'var(--visa)', fontStyle: 'italic' }}>VISA</span>;
  if (brand === 'Mastercard') return <span style={{ fontSize: 20 }}>💳</span>;
  if (brand === 'Amex') return <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--amex)' }}>AMEX</span>;
  return <span style={{ fontSize: 20 }}>💳</span>;
}

function Loading() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, background: 'var(--bg)' }}>
      <div style={{ width: 40, height: 40, border: `3px solid ${BLUE}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ color: 'var(--text-3)', fontSize: 14 }}>Loading your account…</div>
    </div>
  );
}

function ErrorPage({ message }: { message: string }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: 24 }}>
      <div style={{ background: 'var(--card)', borderRadius: 16, padding: '32px 28px', maxWidth: 420, width: '100%', textAlign: 'center', boxShadow: 'var(--shadow)' }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>🔒</div>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 10, color: 'var(--text)' }}>Link Unavailable</div>
        <div style={{ fontSize: 14, color: 'var(--text-3)', lineHeight: 1.6, marginBottom: 24 }}>{message}</div>
        <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>Please contact Shield Low Voltage for a new link.</div>
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
  background: 'transparent', color: BLUE_TEXT, border: `1.5px solid ${BLUE_TEXT}`, borderRadius: 10,
  padding: '13px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
};
const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: BLUE_TEXT, fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0,
};
const sectionLabel: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10,
};
const fieldLabel: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-3)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em',
};
const collectField: React.CSSProperties = {
  height: 44, borderRadius: 8, overflow: 'hidden',
};
// Tints via color-mix: the colors are CSS variables now, so hex-alpha suffixes can't apply.
const smallBtn = (color: string): React.CSSProperties => ({
  background: `color-mix(in srgb, ${color} 8%, transparent)`, color, border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`, borderRadius: 8,
  padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
});
