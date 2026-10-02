import React, { useState, useEffect } from 'react';
import {
  Home, Calendar, Receipt, Wallet, ShieldCheck, Clock as ClockIcon,
  Wifi, WifiOff, CheckCircle2, AlertTriangle, DoorOpen, User, MapPin, Phone,
  TrendingUp, DollarSign, FileText, RefreshCw, LogOut, QrCode, Send,
  Smartphone, Banknote, ArrowRight, Zap, Check
} from 'lucide-react';

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const PAD2 = (n) => String(n).padStart(2, "0");

function isThisMonth(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}

function ordinal(n) {
  n = Number(n); const s = ["th","st","nd","rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function periodKey(y, m) { return `${y}-${PAD2(m)}`; }
function toISODate(d) { return `${d.getFullYear()}-${PAD2(d.getMonth() + 1)}-${PAD2(d.getDate())}`; }

function isSemiMonthly(tenant) { return tenant.paymentFrequency === "semimonthly"; }
function daysInMonth(year, month) { return new Date(year, month, 0).getDate(); }
function dueDateFor(tenant, year, month, half = null) {
  if (isSemiMonthly(tenant)) {
    const dim = daysInMonth(year, month);
    const day = half === "b" ? Math.min(30, dim) : Math.min(15, dim);
    return new Date(year, month - 1, day);
  }
  const day = Math.min(Number(tenant.dueDay) || 1, daysInMonth(year, month));
  return new Date(year, month - 1, day);
}
function periodKeyFor(tenant, year, month, half = null) {
  return isSemiMonthly(tenant) ? `${periodKey(year, month)}-${half}` : periodKey(year, month);
}
function getPeriodsForTenant(tenant) {
  if (!tenant.moveInDate) return [];
  const start = new Date(tenant.moveInDate + "T00:00:00");
  let y = start.getFullYear(), m = start.getMonth() + 1;
  const now = new Date(); const nowY = now.getFullYear(), nowM = now.getMonth() + 1;
  const periods = []; let guard = 0;
  const pushMonth = (yy, mm) => {
    if (isSemiMonthly(tenant)) {
      periods.push({ year: yy, month: mm, half: "a", key: periodKeyFor(tenant, yy, mm, "a") });
      periods.push({ year: yy, month: mm, half: "b", key: periodKeyFor(tenant, yy, mm, "b") });
    } else {
      periods.push({ year: yy, month: mm, half: null, key: periodKeyFor(tenant, yy, mm, null) });
    }
  };
  if (y > nowY || (y === nowY && m > nowM)) { pushMonth(y, m); return periods; }
  while ((y < nowY || (y === nowY && m <= nowM)) && guard < 600) {
    pushMonth(y, m); m++; if (m > 12) { m = 1; y++; } guard++;
  }
  return periods.reverse();
}
function recurringTotal(tenant) {
  return (tenant.additionalFees || []).reduce((s, f) => s + (Number(f.amount) || 0), 0);
}
function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return `${MONTHS[d.getMonth()]?.slice(0, 3) || "—"} ${d.getDate()}, ${d.getFullYear()}`;
}
function formatMoney(amount, currency) {
  const n = Number(amount) || 0;
  return `${currency}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function StatCard({ label, value, sub, tone, icon: Icon }) {
  const iconClass = tone === 'danger' ? 'rd-stat-icon--danger' : tone === 'ok' ? 'rd-stat-icon--ok' : tone === 'brass' ? 'rd-stat-icon--brass' : 'rd-stat-icon--default';
  return (
    <div className={`rd-stat-card ${tone === 'danger' ? 'rd-stat-card--danger' : ''} ${tone === 'ok' ? 'rd-stat-card--ok' : ''}`}>
      <div className={`rd-stat-icon ${iconClass}`}><Icon size={18} /></div>
      <div className="rd-stat-label">{label}</div>
      <div className="rd-stat-value rd-count">{value}</div>
      {sub && <div className="rd-stat-sub">{sub}</div>}
    </div>
  );
}

function StatusBadge({ status }) {
  const cfg = {
    paid: { label: 'Paid', Icon: CheckCircle2, cls: 'rd-badge--paid' },
    overdue: { label: 'Overdue', Icon: AlertTriangle, cls: 'rd-badge--overdue' },
    due: { label: 'Due', Icon: ClockIcon, cls: 'rd-badge--due' },
  };
  const { label, Icon, cls } = cfg[status] || { label: status, Icon: ClockIcon, cls: '' };
  return <span className={`rd-badge ${cls}`}><Icon size={12} /> {label}</span>;
}

function ProgressBar({ percent, tone }) {
  const fillCls = tone === 'ok' ? 'rd-progress-fill--ok' : tone === 'danger' ? 'rd-progress-fill--danger' : 'rd-progress-fill--warn';
  return (
    <div className="rd-progress-bar">
      <div className={`rd-progress-fill ${fillCls}`} style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
    </div>
  );
}

function getDuePeriod(tenant, payments) {
  if (!tenant) return null;
  const periods = getPeriodsForTenant(tenant);
  const now = new Date(); const nowY = now.getFullYear(), nowM = now.getMonth() + 1;
  for (const p of periods) {
    const rec = payments[p.key];
    if (!rec || rec.status !== 'paid') return p;
  }
  return null;
}

export default function RenterDashboard({ tenant, payments = [], settings = {}, onSignOut, isOnline, onPayOnline }) {
  const [showContract, setShowContract] = useState(false);
  const [showPayModal, setShowPayModal] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState('');
  const [paying, setPaying] = useState(false);
  const [paySuccess, setPaySuccess] = useState(false);
  const [payError, setPayError] = useState('');
  const [cloudSynced, setCloudSynced] = useState(isOnline);
  const [toast, setToast] = useState('');

  const gcashNum = settings.gcashNumber || "09123456789";
  const mayaNum = settings.mayaNumber || "09987654321";
  const currency = settings.currency || "₱";

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  useEffect(() => {
    setCloudSynced(isOnline);
  }, [isOnline]);

  if (!tenant) {
    return (
      <div className="rd-dashboard">
        <div className="rd-error">
          <User size={48} color="#c0392b" />
          <h2>No tenant record linked</h2>
          <p>Ask the owner to set your Contact number in Tenants → Edit to match your phone, then reload.</p>
          <button className="rd-action-btn rd-action-btn--primary" style={{ marginTop: 16 }} onClick={() => window.location.reload()}>
            <RefreshCw size={16} /> Reload
          </button>
        </div>
      </div>
    );
  }

  const overdue = payments.filter((p) => p.status === 'overdue');
  const duePayments = payments.filter((p) => p.status === 'due');
  const nextDue = payments.find((p) => p.status === 'due');
  const paidThisMonth = payments.filter((p) => p.status === 'paid' && isThisMonth(p.paidAt)).reduce((s, p) => s + Number(p.amount || 0), 0);
  const totalPaid = payments.filter((p) => p.status === 'paid').reduce((s, p) => s + Number(p.amount || 0), 0);
  const totalDue = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const paymentProgress = totalDue > 0 ? Math.round((totalPaid / totalDue) * 100) : 100;
  const overdueCount = overdue.length;

  const getDueDate = (p) => {
    if (!p.dueDate) return null;
    const d = new Date(p.dueDate);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatCurrency = (val) => {
    const n = Number(val) || 0;
    return `${currency}${n.toFixed(2)}`;
  };

  const duePeriod = getDuePeriod(tenant, payments);

  const handlePayOnline = (method) => {
    if (!duePeriod) { setPayError("No due period found"); return; }
    setSelectedMethod(method);
    setShowPayModal(true);
    setPayError('');
    setPaySuccess(false);
  };

  const confirmPay = () => {
    if (!duePeriod || !selectedMethod || !tenant) { setPayError("No due period or tenant data"); return; }
    setPaying(true);
    setPayError('');
    setTimeout(() => {
      const success = onPayOnline(tenant, duePeriod.key, selectedMethod.toUpperCase());
      if (success) {
        setPaySuccess(true);
        setPaying(false);
        showToast(`${selectedMethod} payment sent! ₱${duePeriod.amount.toFixed(2)} marked as paid.`);
        setTimeout(() => { setShowPayModal(false); setPaySuccess(false); setSelectedMethod(''); }, 2500);
      } else {
        setPayError("Payment failed. Try again.");
        setPaying(false);
        showToast("Payment failed. Please try again.");
      }
    }, 1500);
  };

  const getPaymentMethodIcon = (method) => {
    if (method === 'GCASH') return <Smartphone size={16} />;
    if (method === 'MAYA') return <Banknote size={16} />;
    return <Send size={16} />;
  };

  return (
    <div className="rd-dashboard">
      {!isOnline && (
        <div className="rd-offline-banner">
          <WifiOff size={14} /> You're offline — data saved locally, will sync when reconnect.
        </div>
      )}

      <header className="rd-header">
        <div>
          <h1>BeDa Rooms — My Rental</h1>
          <span className="rd-header-badge">{tenant.contact}</span>
        </div>
        <div className="rd-header-actions">
          {isOnline && <span className="rd-welcome-chip"><Wifi size={14} /> Online</span>}
          <button className="rd-signout-btn" onClick={onSignOut}>
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </header>

      <div className="rd-welcome-banner">
        <div>
          <div className="rd-welcome-greeting">Welcome back, {tenant.name || 'Renter'}!</div>
          <div className="rd-welcome-sub">
            {tenant.roomLabel || tenant.room ? `${tenant.roomLabel || tenant.room} • ` : ''}Move-in {tenant.moveInDate || '—'}
          </div>
        </div>
        <div className="rd-welcome-meta">
          <span className="rd-welcome-chip"><DoorOpen size={14} /> {tenant.roomLabel || tenant.room || 'Room TBD'}</span>
          <span className="rd-welcome-chip"><Calendar size={14} /> Rent</span>
          <span className="rd-welcome-chip"><DollarSign size={14} /> {formatCurrency(tenant.monthlyRent)}</span>
        </div>
      </div>

      <section className="rd-stats-grid">
        <StatCard label="Room" value={tenant.roomLabel || tenant.room || '—'} icon={Home} />
        <StatCard
          label="Rent Status"
          value={overdueCount > 0 ? 'Overdue' : 'Up to date'}
          sub={overdueCount > 0 ? `${overdueCount} payment${overdueCount > 1 ? 's' : ''} pending` : 'All caught up!'}
          tone={overdueCount > 0 ? 'danger' : 'ok'}
          icon={ShieldCheck}
        />
        <StatCard
          label="Paid This Month"
          value={formatCurrency(paidThisMonth)}
          sub="Current period"
          tone="ok"
          icon={TrendingUp}
        />
        <StatCard
          label="Next Due"
          value={nextDue ? formatCurrency(nextDue.amount) : '—'}
          sub={nextDue ? `on ${getDueDate(nextDue)}` : 'No upcoming'}
          tone={nextDue && nextDue.status === 'overdue' ? 'danger' : 'brass'}
          icon={Calendar}
        />
      </section>

      <section className="rd-card">
        <div className="rd-card-title"><Wallet size={18} /> Payment Progress</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 13, color: '#5b6663' }}>
            {totalPaid > 0 ? `${paymentProgress}% of total paid` : 'Start making payments to see progress'}
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 18 }}>{formatCurrency(totalPaid)}</span>
        </div>
        {totalPaid > 0 && <ProgressBar percent={paymentProgress} tone={paymentProgress >= 80 ? 'ok' : paymentProgress >= 40 ? 'warn' : 'danger'} />}
        <div style={{ display: 'flex', gap: 24, marginTop: 16, flexWrap: 'wrap' }}>
          <div><span style={{ fontSize: 12, color: '#888', fontFamily: 'var(--font-mono)' }}>Total Paid</span><br /><strong>{formatCurrency(totalPaid)}</strong></div>
          <div><span style={{ fontSize: 12, color: '#888', fontFamily: 'var(--font-mono)' }}>Overdue</span><br /><strong style={{ color: '#c0392b' }}>{formatCurrency(overdue.reduce((s, p) => s + Number(p.amount || 0), 0))}</strong></div>
          <div><span style={{ fontSize: 12, color: '#888', fontFamily: 'var(--font-mono)' }}>Total Tracked</span><br /><strong>{formatCurrency(totalDue)}</strong></div>
        </div>
      </section>

      {/* Online Payment Section */}
      <section className="rd-card" style={{ animation: 'rd-slideUp 0.5s ease-out' }}>
        <div className="rd-card-title"><Zap size={18} /> Pay Online</div>
        <p style={{ fontSize: 13, color: '#5b6663', marginBottom: 16 }}>Pay instantly through GCash or Maya. Once payment is sent, the due amount is automatically marked as paid.</p>
        <div className="rd-actions" style={{ marginBottom: 16 }}>
          <button className="rd-action-btn" onClick={() => handlePayOnline('GCASH')} disabled={!duePeriod}>
            <Smartphone size={18} /> GCash — {formatCurrency(duePeriod ? duePeriod.amount : 0)}
          </button>
          <button className="rd-action-btn" onClick={() => handlePayOnline('MAYA')} disabled={!duePeriod}>
            <Banknote size={18} /> Maya — {formatCurrency(duePeriod ? duePeriod.amount : 0)}
          </button>
        </div>
        {duePeriod && (
          <div style={{ background: '#fafaf8', border: '1px solid #e8e4dc', borderRadius: 8, padding: 16, fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div><strong>Period:</strong> {duePeriod.key}</div>
              <div><strong>Due Date:</strong> {formatDate(duePeriod.dueDate ? new Date(duePeriod.dueDate).toISOString() : '')}</div>
              <div><strong>Amount:</strong> <span style={{ fontWeight: 700, color: '#1a7f37' }}>{formatCurrency(duePeriod.amount)}</span></div>
            </div>
          </div>
        )}
        {!duePeriod && (
          <div className="rd-empty">
            <CheckCircle2 size={40} color="#1a7f37" />
            <p>All payments are up to date!</p>
          </div>
        )}
      </section>

      {/* Quick Actions */}
      <div className="rd-actions">
        <button className="rd-action-btn rd-action-btn--primary" onClick={() => setShowContract(!showContract)}>
          <FileText size={16} /> {showContract ? 'Hide' : 'View'} Contract
        </button>
        <button className="rd-action-btn">
          <Receipt size={16} /> Payment History
        </button>
      </div>

      {showContract && (
        <section className="rd-card" style={{ animation: 'rd-slideUp 0.4s ease-out' }}>
          <div className="rd-card-title"><FileText size={18} /> My Contract</div>
          <div style={{ border: '1px solid #e8e4dc', borderRadius: 8, padding: 20, background: '#fafaf8', fontSize: 14, lineHeight: 1.8 }}>
            <div style={{ textAlign: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, marginBottom: 16 }}>ROOM RENTAL AGREEMENT</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div><span style={{ fontSize: 11, color: '#888', fontFamily: 'var(--font-mono)' }}>LANDLORD</span><br /><strong>{tenant.name || '—'}</strong></div>
              <div><span style={{ fontSize: 11, color: '#888', fontFamily: 'var(--font-mono)' }}>TENANT</span><br /><strong>{tenant.name || '—'}</strong></div>
              <div><span style={{ fontSize: 11, color: '#888', fontFamily: 'var(--font-mono)' }}>ROOM</span><br />{tenant.roomLabel || tenant.room || '—'}</div>
              <div><span style={{ fontSize: 11, color: '#888', fontFamily: 'var(--font-mono)' }}>MONTHLY RENT</span><br />{formatCurrency(tenant.monthlyRent)}</div>
              <div><span style={{ fontSize: 11, color: '#888', fontFamily: 'var(--font-mono)' }}>MOVE-IN</span><br />{tenant.moveInDate || '—'}</div>
              <div><span style={{ fontSize: 11, color: '#888', fontFamily: 'var(--font-mono)' }}>CONTACT</span><br />{tenant.contact || '—'}</div>
            </div>
            <p style={{ marginTop: 16, fontSize: 12, color: '#888', textAlign: 'center' }}>Read-only view. Ask owner for signed Official Receipt each paid period.</p>
          </div>
        </section>
      )}

      <section className="rd-card">
        <div className="rd-card-title"><Receipt size={18} /> Payment History</div>
        {payments.length === 0 ? (
          <div className="rd-empty">
            <Calendar size={40} color="#ccc" />
            <p>No payment records yet.</p>
            <p style={{ fontSize: 12 }}>Once you send payment via GCash/Maya or owner marks rent as paid, it appears here.</p>
          </div>
        ) : (
          <div className="rd-timeline">
            {[...payments].reverse().map((p, i) => (
              <div key={p.id} className={`rd-timeline-item rd-timeline-item--${p.status}`} style={{ animationDelay: `${i * 0.1}s` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <span className="rd-timeline-date">{p.paidAt ? formatDate(p.paidAt) : getDueDate(p) || '—'}</span>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {p.paymentMethod && (
                      <span style={{ fontSize: 10, background: '#e0e0e0', padding: '2px 6px', borderRadius: 4, fontFamily: 'var(--font-mono)' }}>
                        {getPaymentMethodIcon(p.paymentMethod)} {p.paymentMethod}
                      </span>
                    )}
                    <StatusBadge status={p.status} />
                  </div>
                </div>
                <div className="rd-timeline-amount">{formatCurrency(p.amount)}</div>
                <div className="rd-timeline-meta">{p.period || '—'}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rd-card">
        <div className="rd-card-title"><User size={18} /> My Details</div>
        <div className="rd-details">
          <div className="rd-detail-item">
            <div className="rd-detail-label"><User size={12} /> Name</div>
            <div className="rd-detail-value">{tenant.name || '—'}</div>
          </div>
          <div className="rd-detail-item">
            <div className="rd-detail-label"><Phone size={12} /> Contact</div>
            <div className="rd-detail-value">{tenant.contact || '—'}</div>
          </div>
          <div className="rd-detail-item">
            <div className="rd-detail-label"><DoorOpen size={12} /> Room</div>
            <div className="rd-detail-value">{tenant.roomLabel || tenant.room || '—'}</div>
          </div>
          <div className="rd-detail-item">
            <div className="rd-detail-label"><MapPin size={12} /> Address</div>
            <div className="rd-detail-value">{tenant.address || '—'}</div>
          </div>
          <div className="rd-detail-item">
            <div className="rd-detail-label"><Calendar size={12} /> Move-in</div>
            <div className="rd-detail-value">{tenant.moveInDate || '—'}</div>
          </div>
          <div className="rd-detail-item">
            <div className="rd-detail-label"><DollarSign size={12} /> Monthly Rent</div>
            <div className="rd-detail-value">{formatCurrency(tenant.monthlyRent)}</div>
          </div>
        </div>
      </section>

      {/* Payment Method Info */}
      <section className="rd-card">
        <div className="rd-card-title"><QrCode size={18} /> Payment Details</div>
        <div className="rd-details">
          <div className="rd-detail-item">
            <div className="rd-detail-label"><Smartphone size={12} /> GCash Number</div>
            <div className="rd-detail-value" style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{gcashNum}</div>
          </div>
          <div className="rd-detail-item">
            <div className="rd-detail-label"><Banknote size={12} /> Maya Number</div>
            <div className="rd-detail-value" style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{mayaNum}</div>
          </div>
        </div>
        <p style={{ fontSize: 11, color: '#999', marginTop: 12, textAlign: 'center' }}>
          Send the exact due amount to the number above. Payment is automatically marked as paid once sent. Keep your transaction ID as proof.
        </p>
      </section>

      {/* GCash/Maya Payment Modal */}
      {showPayModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
        }}>
          <div className="rd-card" style={{ maxWidth: 400, width: '100%', margin: 0, animation: 'rd-fadeIn 0.3s ease-out' }}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#f0ede6', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                {getPaymentMethodIcon(selectedMethod)}
              </div>
              <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 20 }}>Pay via {selectedMethod}</h3>
              <p style={{ fontSize: 13, color: '#5b6663', marginTop: 4 }}>Send ₱{duePeriod ? duePeriod.amount.toFixed(2) : '0'} to confirm payment</p>
            </div>

            {paySuccess ? (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#c8e6c0', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                  <CheckCircle2 size={32} color="#1a7f37" />
                </div>
                <h3 style={{ color: '#1a7f37', marginBottom: 4 }}>Payment Sent!</h3>
                <p style={{ fontSize: 13, color: '#5b6663' }}>Your payment has been received and automatically marked as paid. ✓</p>
                <div style={{ marginTop: 16 }}>
                  <button className="rd-action-btn rd-action-btn--primary" onClick={() => { setShowPayModal(false); setPaySuccess(false); }}>Done</button>
                </div>
              </div>
            ) : (
              <>
                <div style={{ background: '#fafaf8', border: '1px solid #e8e4dc', borderRadius: 8, padding: 14, marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 14 }}>
                    <span style={{ color: '#5b6663' }}>Method:</span>
                    <strong>{selectedMethod}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 14 }}>
                    <span style={{ color: '#5b6663' }}>Account:</span>
                    <strong style={{ fontFamily: 'var(--font-mono)' }}>{selectedMethod === 'GCASH' ? gcashNum : mayaNum}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                    <span style={{ color: '#5b6663' }}>Amount:</span>
                    <strong style={{ color: '#1a7f37', fontFamily: 'var(--font-mono)' }}>{formatCurrency(duePeriod?.amount || 0)}</strong>
                  </div>
                </div>
                <div style={{ fontSize: 12, color: '#999', textAlign: 'center', marginBottom: 16 }}>
                  Tap below to simulate sending payment. In production, this would open the GCash/Maya app.
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="rd-action-btn" style={{ flex: 1, justifyContent: 'center' }} onClick={() => { setShowPayModal(false); setPaySuccess(false); setSelectedMethod(''); }}>
                    Cancel
                  </button>
                  <button className="rd-action-btn rd-action-btn--primary" style={{ flex: 1, justifyContent: 'center' }} disabled={paying} onClick={confirmPay}>
                    {paying ? (
                      <>
                        <div style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'rd-spin 0.8s linear infinite' }} />
                        Sending...
                      </>
                    ) : (
                      <>
                        <Send size={16} /> Send {selectedMethod}
                      </>
                    )}
                  </button>
                </div>
                {payError && <div style={{ color: '#c0392b', fontSize: 13, textAlign: 'center', marginTop: 8 }}>{payError}</div>}
              </>
            )}

            <style>{`@keyframes rd-spin{to{transform:rotate(360deg)}}`}</style>
          </div>
        </div>
      )}

      <footer className="rd-footer">
        BeDa Rooms · Renter Dashboard · {cloudSynced ? '☁️ Synced' : isOnline ? '🟢 Online' : '🔴 Offline'} · PWA Ready
      </footer>
      {toast && <div className="rd-toast"><CheckCircle2 size={16} /> {toast}</div>}
    </div>
  );
}
