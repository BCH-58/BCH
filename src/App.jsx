import React, { useState, useEffect, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Cell, LabelList
} from 'recharts';
import {
  Sparkles, Droplets, Users, ClipboardList, TrendingUp, TrendingDown, AlertTriangle,
  CheckCircle2, Settings, Plus, Trash2, X, ChevronRight, Building2, CalendarDays,
  ArrowRight, Activity, LayoutGrid, Lock, LockOpen, ShieldCheck, Link as LinkIcon, Download, Pencil, QrCode
} from 'lucide-react';
import { subscribe, writeData } from './lib/storage';
import { sha256Hex, isValidHash } from './lib/hash';
import { exportMonthlyReport } from './lib/export';
import QRCode from 'qrcode';
import logoStar from './logo-star.png';
import smzLogo from './smz-logo.png';

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------
const C = {
  bg: '#F3F8FB',
  surface: '#FFFFFF',
  ink: '#122A3D',
  inkMuted: '#5D7893',
  border: '#DCE9F2',
  primary: '#1C92D0',
  primarySoft: '#E4F1F9',
  primaryDeep: '#155088',
  amber: '#DE9A34',
  amberSoft: '#FBEEDA',
  red: '#C64B4B',
  redSoft: '#FBE7E7',
  green: '#3E8F72',
};

const CRITERIA = [
  { id: 'room', label: 'نظافة غرفة المريض بشكل عام', short: 'غرفة المريض', icon: LayoutGrid },
  { id: 'bathroom', label: 'نظافة دورات المياه', short: 'دورات المياه', icon: Droplets },
  { id: 'floor', label: 'نظافة الأرضيات في القسم', short: 'الأرضيات', icon: Sparkles },
  { id: 'supplies', label: 'توفر أدوات النظافة (المناديل والصابون)', short: 'الأدوات والمستلزمات', icon: ClipboardList },
  { id: 'response', label: 'استجابة العامل/ة عند الطلب', short: 'سرعة الاستجابة', icon: Activity },
];

const SCALE = [
  { value: 4, label: 'ممتاز', color: C.primary },
  { value: 3, label: 'جيد جدا', color: '#4E9C8F' },
  { value: 2, label: 'مقبول', color: C.amber },
  { value: 1, label: 'سيء', color: C.red },
];

// Custom weight per rating, out of 100 for a single rating (not evenly
// spaced) — a criterion's or supervisor's overall score is the average of
// these weights across every rating counted.
const RATING_WEIGHT = { 4: 100, 3: 85, 2: 45, 1: 0 };

function pctFromValues(vals) {
  if (!vals.length) return 0;
  const sum = vals.reduce((a, b) => a + RATING_WEIGHT[b], 0);
  return sum / vals.length;
}

// Shown only when a criterion is rated "مقبول" أو "سيء" — turns a bare
// low score into an actionable reason. "سبب آخر" opens a free-text field.
const OTHER_REASON = 'سبب آخر';
const REASONS = {
  room: ['الأرضية متسخة', 'روائح كريهة', 'المهملات لم تُفرغ', OTHER_REASON],
  bathroom: ['رائحة كريهة', 'الأرضية مبللة أو متسخة', 'المرحاض غير نظيف', 'لا يوجد مناديل', OTHER_REASON],
  floor: ['بقع واضحة', 'غبار متراكم', 'أثر انسكاب لم يُنظّف', OTHER_REASON],
  supplies: ['لا يوجد صابون', 'لا يوجد مناديل', 'حاويات المهملات ممتلئة', OTHER_REASON],
  response: ['تأخر في الاستجابة', 'لم يتم الرد على الطلب', 'سلوك غير مناسب', OTHER_REASON],
};

const uid = () => Math.random().toString(36).slice(2, 10);
const todayStr = () => new Date().toISOString().slice(0, 10);

// A short, human-readable device/browser label parsed from the user agent —
// no permissions or network calls needed, works fully offline.
function getDeviceLabel() {
  const ua = navigator.userAgent || '';
  let os = 'جهاز غير معروف';
  if (/iPhone/i.test(ua)) os = 'iPhone';
  else if (/iPad/i.test(ua)) os = 'iPad';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Macintosh|Mac OS/i.test(ua)) os = 'Mac';
  else if (/Linux/i.test(ua)) os = 'Linux';

  let browser = '';
  if (/SamsungBrowser/i.test(ua)) browser = 'Samsung Browser';
  else if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/CriOS|Chrome/i.test(ua)) browser = 'Chrome';
  else if (/FxiOS|Firefox/i.test(ua)) browser = 'Firefox';
  else if (/Safari/i.test(ua)) browser = 'Safari';

  return browser ? `${os} · ${browser}` : os;
}

// Best-effort public IP lookup; resolves to null (never throws) if the
// request fails or is blocked, so it never holds up saving a survey.
async function getClientIp() {
  try {
    const res = await fetch('https://api.ipify.org?format=json');
    const data = await res.json();
    return data.ip || null;
  } catch {
    return null;
  }
}


function scoreColor(pct) {
  if (pct >= 85) return C.primary;
  if (pct >= 70) return C.green;
  if (pct >= 55) return C.amber;
  return C.red;
}
function scoreLabel(pct) {
  if (pct >= 85) return 'ممتاز';
  if (pct >= 70) return 'جيد';
  if (pct >= 55) return 'مقبول';
  return 'يحتاج متابعة';
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------
function GaugePulse({ pct, count }) {
  const color = scoreColor(pct);
  const r = 74;
  const circumference = 2 * Math.PI * r;
  const dash = (pct / 100) * circumference;

  // ECG-style waveform whose peak height reflects the score
  const amp = 6 + (pct / 100) * 22;
  const path = `M0,40 L30,40 L40,${40 - amp * 0.3} L50,${40 + amp} L62,${40 - amp * 1.3} L74,40 L104,40 L114,${40 - amp * 0.3} L124,${40 + amp} L136,${40 - amp * 1.3} L148,40 L200,40`;

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: 190, height: 190 }}>
        <svg width="190" height="190" viewBox="0 0 190 190">
          <circle cx="95" cy="95" r={r} fill="none" stroke={C.border} strokeWidth="14" />
          <circle
            cx="95" cy="95" r={r} fill="none" stroke={color} strokeWidth="14"
            strokeDasharray={`${dash} ${circumference}`}
            strokeLinecap="round"
            transform="rotate(-90 95 95)"
            style={{ transition: 'stroke-dasharray 0.8s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span style={{ fontFamily: 'Cairo', fontWeight: 800, fontSize: 40, color: C.ink, lineHeight: 1 }}>
            {Math.round(pct)}%
          </span>
          <span style={{ color, fontWeight: 700, fontSize: 13, marginTop: 4 }}>{scoreLabel(pct)}</span>
        </div>
      </div>
      <div className="w-full mt-1" style={{ maxWidth: 200 }}>
        <svg viewBox="0 0 200 80" width="100%" height="46">
          <path d={path} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round">
            <animate attributeName="stroke-dasharray" from="0,600" to="600,0" dur="2.4s" repeatCount="indefinite" />
          </path>
        </svg>
      </div>
      <p style={{ color: C.inkMuted, fontSize: 12 }}>{count} استبيان مسجّل</p>
    </div>
  );
}

function StatPill({ icon: Icon, label, value, sub }) {
  return (
    <div className="rounded-2xl px-4 py-3 flex items-center gap-3" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
      <div className="rounded-xl p-2" style={{ background: C.primarySoft }}>
        <Icon size={18} color={C.primary} />
      </div>
      <div>
        <p style={{ fontSize: 12, color: C.inkMuted }}>{label}</p>
        <p style={{ fontSize: 18, fontWeight: 800, color: C.ink, fontFamily: 'Cairo' }}>{value}</p>
        {sub && <p style={{ fontSize: 11, color: C.inkMuted }}>{sub}</p>}
      </div>
    </div>
  );
}

function RatingPicker({ value, onChange }) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {SCALE.map(s => {
        const active = value === s.value;
        return (
          <button
            type="button"
            key={s.value}
            onClick={() => onChange(s.value)}
            className="rounded-xl py-2 text-sm font-semibold transition-all"
            style={{
              background: active ? s.color : C.bg,
              color: active ? '#fff' : C.inkMuted,
              border: `1px solid ${active ? s.color : C.border}`,
            }}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

function CustomBarTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="rounded-lg px-3 py-2 text-xs" style={{ background: C.primaryDeep, color: '#fff' }}>
      <p className="font-semibold mb-1">{label}</p>
      <p>{payload[0].value}%</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main App
// ---------------------------------------------------------------------------
export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [supervisors, setSupervisors] = useState([]);
  const [responses, setResponses] = useState([]);
  const [tab, setTab] = useState('round'); // round | overview | supervisors | manage
  const [selectedSupId, setSelectedSupId] = useState(null);

  // A supervisor's personal link looks like ?s=<their id> — read once on
  // load so their round view skips straight to their own PIN screen.
  const [presetSupId] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get('s');
    } catch {
      return null;
    }
  });

  // A supervisor's "my score" link looks like ?mine=<their id> — a
  // separate, read-only link (kept private, never handed to patients)
  // that shows only their own overall score.
  const [myScoreId] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get('mine');
    } catch {
      return null;
    }
  });

  // Manager-only access: overview / supervisors / manage stay hidden and
  // locked behind a manager PIN. Unlock lasts for this session only.
  const [managerPin, setManagerPin] = useState(null);
  const [managerUnlocked, setManagerUnlocked] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);
  const [pendingTab, setPendingTab] = useState(null);

  // Live subscriptions: every device (manager or any supervisor) reads and
  // writes the same Firebase Realtime Database paths, so a submission from
  // a supervisor's phone appears on the manager's screen automatically —
  // no manual refresh needed.
  useEffect(() => {
    let sReady = false, rReady = false, mReady = false;
    const checkLoaded = () => { if (sReady && rReady && mReady) setLoaded(true); };

    const unsubSup = subscribe('supervisors', (v) => { setSupervisors(v); sReady = true; checkLoaded(); }, []);
    const unsubResp = subscribe('responses', (v) => { setResponses(v); rReady = true; checkLoaded(); }, []);
    const unsubPin = subscribe('managerPin', (v) => { setManagerPin(v); mReady = true; checkLoaded(); }, null);

    return () => { unsubSup(); unsubResp(); unsubPin(); };
  }, []);

  const persistSupervisors = async (next) => {
    setSupervisors(next);
    await writeData('supervisors', next);
  };
  const persistResponses = async (next) => {
    setResponses(next);
    await writeData('responses', next);
  };
  const persistManagerPin = async (pin) => {
    setManagerPin(pin);
    await writeData('managerPin', pin);
  };

  const requestManagerTab = (targetTab) => {
    if (managerUnlocked) {
      setTab(targetTab);
    } else {
      setPendingTab(targetTab);
      setGateOpen(true);
    }
  };

  const lockManager = () => {
    setManagerUnlocked(false);
    setTab('round');
    setSelectedSupId(null);
  };

  // --------------------------- derived metrics ---------------------------
  // All live indicators reset every calendar month — only this month's
  // submissions count toward a supervisor's current score. Older months
  // stay fully intact in the database and remain pullable anytime via the
  // Excel export (which lets you pick any month).
  const currentMonth = todayStr().slice(0, 7); // YYYY-MM
  const monthResponses = useMemo(
    () => responses.filter(r => r.date.startsWith(currentMonth)),
    [responses, currentMonth]
  );

  const allRatingsFlat = useMemo(() => {
    const out = [];
    monthResponses.forEach(r => CRITERIA.forEach(c => out.push(r.ratings[c.id])));
    return out;
  }, [monthResponses]);

  const overallPct = pctFromValues(allRatingsFlat);

  const positivePct = allRatingsFlat.length
    ? (allRatingsFlat.filter(v => v >= 3).length / allRatingsFlat.length) * 100
    : 0;

  const criteriaAverages = useMemo(() => {
    return CRITERIA.map(c => {
      const vals = monthResponses.map(r => r.ratings[c.id]);
      const pct = pctFromValues(vals);
      return { ...c, pct: Math.round(pct) };
    });
  }, [monthResponses]);

  const supervisorStats = useMemo(() => {
    return supervisors.map(s => {
      const rs = monthResponses.filter(r => r.supervisorId === s.id);
      const vals = [];
      rs.forEach(r => CRITERIA.forEach(c => vals.push(r.ratings[c.id])));
      const pct = vals.length ? pctFromValues(vals) : null;
      return { ...s, count: rs.length, pct };
    }).sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));
  }, [supervisors, monthResponses]);

  const trendData = useMemo(() => {
    const byDate = {};
    monthResponses.forEach(r => {
      const vals = CRITERIA.map(c => r.ratings[c.id]);
      const avgPct = pctFromValues(vals);
      if (!byDate[r.date]) byDate[r.date] = [];
      byDate[r.date].push(avgPct);
    });
    return Object.entries(byDate)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, vals]) => ({
        date: date.slice(5),
        score: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length),
      }));
  }, [monthResponses]);

  const lowPerformer = supervisorStats.filter(s => s.pct !== null).slice(-1)[0];

  if (!loaded) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ background: C.bg }}>
        <p style={{ color: C.inkMuted, fontFamily: 'Cairo' }}>...جارِ التحميل</p>
      </div>
    );
  }

  // A "my score" link (?mine=<id>) shows a small standalone read-only
  // screen — nothing else in the app is reachable from it.
  if (myScoreId) {
    return <MyScoreView supId={myScoreId} supervisors={supervisors} responses={monthResponses} logoStar={logoStar} />;
  }

  return (
    <div dir="rtl" className="min-h-screen w-full relative" style={{ background: C.bg, fontFamily: 'IBM Plex Sans Arabic, sans-serif', color: C.ink }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@500;600;700;800;900&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { height: 6px; width: 6px; }
        ::-webkit-scrollbar-thumb { background: #C7D9D6; border-radius: 10px; }
      `}</style>

      {/* Small repeated logo watermark tiled across the whole page, with controllable spacing */}
      <LogoWatermark logo={logoStar} logoSize={44} gap={40} opacity={0.06} />

      <div className="relative" style={{ zIndex: 1 }}>

      {/* Header */}
      <header className="sticky top-0 z-20 px-4 pt-4 pb-3" style={{ background: C.primaryDeep }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src={logoStar} alt="تجمع القصيم الصحي" style={{ width: 60, height: 60, objectFit: 'contain' }} />
            <div>
              <h1 style={{ fontFamily: 'Cairo', fontWeight: 800, fontSize: 17, color: '#fff' }}>لوحة متابعة النظافة</h1>
              <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)' }}>تجمع القصيم الصحي - مستشفى بريدة المركزي</p>
            </div>
          </div>

          {managerUnlocked ? (
            <button
              onClick={lockManager}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-semibold"
              style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}
              title="قفل لوحة المدير"
            >
              <LockOpen size={13} /> قفل
            </button>
          ) : (
            <button
              onClick={() => requestManagerTab('overview')}
              className="p-2 rounded-full"
              style={{ background: 'rgba(255,255,255,0.1)' }}
              title="دخول المدير"
            >
              <Lock size={15} color="rgba(255,255,255,0.75)" />
            </button>
          )}
        </div>

        {/* Tabs — manager tabs only appear once unlocked with the PIN */}
        <div className="flex gap-1 mt-4 overflow-x-auto pb-1">
          {[
            { id: 'round', label: 'جولة الميدان', icon: Plus, protected: false },
            ...(managerUnlocked ? [
              { id: 'overview', label: 'نظرة عامة', icon: TrendingUp, protected: true },
              { id: 'supervisors', label: 'المشرفون', icon: Users, protected: true },
              { id: 'manage', label: 'الإعدادات', icon: Settings, protected: true },
            ] : []),
          ].map(t => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => { t.protected ? requestManagerTab(t.id) : setTab(t.id); setSelectedSupId(null); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all"
                style={{
                  background: active ? '#fff' : 'rgba(255,255,255,0.08)',
                  color: active ? C.primaryDeep : 'rgba(255,255,255,0.8)',
                }}
              >
                <Icon size={13} />
                {t.label}
              </button>
            );
          })}
        </div>
      </header>

      {gateOpen && (
        <ManagerGate
          hasPin={isValidHash(managerPin)}
          managerPin={managerPin}
          onCreate={async (pinHash) => {
            await persistManagerPin(pinHash);
            setManagerUnlocked(true);
            setGateOpen(false);
            setTab(pendingTab || 'overview');
          }}
          onSuccess={() => {
            setManagerUnlocked(true);
            setGateOpen(false);
            setTab(pendingTab || 'overview');
          }}
          onCancel={() => setGateOpen(false)}
        />
      )}

      <main className="px-4 py-4 pb-10 max-w-2xl mx-auto">
        {tab === 'overview' && managerUnlocked && (
          <OverviewTab
            overallPct={overallPct}
            positivePct={positivePct}
            responses={monthResponses}
            allResponses={responses}
            supervisors={supervisors}
            criteriaAverages={criteriaAverages}
            supervisorStats={supervisorStats}
            trendData={trendData}
            lowPerformer={lowPerformer}
            goEntry={() => setTab('round')}
          />
        )}

        {tab === 'supervisors' && managerUnlocked && !selectedSupId && (
          <SupervisorsTab
            supervisorStats={supervisorStats}
            onSelect={setSelectedSupId}
            goManage={() => requestManagerTab('manage')}
          />
        )}

        {tab === 'supervisors' && managerUnlocked && selectedSupId && (
          <SupervisorDetail
            supId={selectedSupId}
            supervisors={supervisors}
            responses={monthResponses}
            onBack={() => setSelectedSupId(null)}
            onClearResponses={async (supervisorId) => {
              const idsToRemove = new Set(
                monthResponses.filter(r => r.supervisorId === supervisorId).map(r => r.id)
              );
              await persistResponses(responses.filter(r => !idsToRemove.has(r.id)));
            }}
          />
        )}

        {tab === 'round' && (
          <RoundTab
            supervisors={supervisors}
            responses={responses}
            presetSupId={presetSupId}
            onSubmit={async (entry) => {
              await persistResponses([...responses, entry]);
            }}
            goManage={() => requestManagerTab('manage')}
            goOverview={() => requestManagerTab('overview')}
          />
        )}

        {tab === 'manage' && managerUnlocked && (
          <ManageTab
            supervisors={supervisors}
            responses={responses}
            onAdd={async (s) => await persistSupervisors([...supervisors, s])}
            onRemove={async (id) => {
              await persistSupervisors(supervisors.filter(s => s.id !== id));
              await persistResponses(responses.filter(r => r.supervisorId !== id));
            }}
            onUpdate={async (id, updates) => {
              await persistSupervisors(supervisors.map(s => s.id === id ? { ...s, ...updates } : s));
            }}
          />
        )}
      </main>

      <div dir="ltr" className="flex items-center justify-center gap-1.5 pb-4" style={{ opacity: 0.35 }}>
        <span style={{ fontSize: 10.5, color: C.inkMuted, letterSpacing: 0.5 }}>Developed by</span>
        <img src={smzLogo} alt="SMZ" style={{ height: 13, objectFit: 'contain' }} />
      </div>
      </div>
    </div>
  );
}

// A supervisor's private, read-only score check — reachable only via their
// own "?mine=<id>" link, never the one handed to patients. Shows just their
// own numbers; no access to any other supervisor's data or the manager view.
function MyScoreView({ supId, supervisors, responses, logoStar }) {
  const sup = supervisors.find(s => s.id === supId);
  const rs = responses.filter(r => r.supervisorId === supId);

  const criteriaAverages = CRITERIA.map(c => {
    const vals = rs.map(r => r.ratings[c.id]);
    const pct = pctFromValues(vals);
    return { ...c, pct: Math.round(pct) };
  });
  const overall = rs.length
    ? criteriaAverages.reduce((a, b) => a + b.pct, 0) / criteriaAverages.length
    : 0;

  return (
    <div dir="rtl" className="min-h-screen w-full flex flex-col items-center" style={{ background: C.bg, fontFamily: 'IBM Plex Sans Arabic, sans-serif', color: C.ink, padding: '24px 16px' }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Cairo:wght@500;700;800;900&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap');`}</style>

      <img src={logoStar} alt="" style={{ width: 44, height: 44, objectFit: 'contain', marginBottom: 10 }} />

      {!sup ? (
        <p style={{ fontSize: 13, color: C.inkMuted, marginTop: 40 }}>هذا الرابط غير صالح.</p>
      ) : (
        <div className="w-full max-w-sm flex flex-col gap-4">
          <div className="text-center">
            <p style={{ fontFamily: 'Cairo', fontWeight: 800, fontSize: 18 }}>{sup.name}</p>
            <p style={{ fontSize: 12.5, color: C.inkMuted }}>{sup.department}</p>
          </div>

          <div className="rounded-3xl p-5 flex flex-col items-center" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
            <p style={{ fontSize: 12, color: C.inkMuted, alignSelf: 'flex-start' }}>مؤشرك لهذا الشهر</p>
            <GaugePulse pct={overall} count={rs.length} />
          </div>

          {rs.length > 0 && (
            <div className="rounded-2xl p-3" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
              <p style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 10, fontFamily: 'Cairo' }}>مؤشرك حسب بند الاستبيان</p>
              <div dir="ltr">
              <ResponsiveContainer width="100%" height={190}>
                <BarChart data={criteriaAverages} layout="vertical" margin={{ left: 0, right: 20 }}>
                  <CartesianGrid horizontal={false} stroke={C.border} />
                  <XAxis type="number" domain={[0, 100]} hide />
                  <YAxis type="category" dataKey="short" width={100} tick={{ fontSize: 11, fill: C.ink }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomBarTooltip />} cursor={{ fill: C.bg }} />
                  <Bar dataKey="pct" radius={[6, 6, 6, 6]} barSize={16}>
                    {criteriaAverages.map((c, i) => <Cell key={i} fill={scoreColor(c.pct)} />)}
                    <LabelList dataKey="pct" position="right" formatter={(v) => `${v}%`} style={{ fontSize: 11, fill: C.inkMuted, fontWeight: 600 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              </div>
            </div>
          )}

          <p style={{ fontSize: 10.5, color: C.inkMuted, textAlign: 'center', opacity: 0.7 }}>
            هذا الرابط خاص بك فقط كمشرف/ه.
          </p>
        </div>
      )}
    </div>
  );
}

// Renders the tiled logo watermark as a canvas-generated pattern, so the
// gap between logos can be set precisely (plain CSS background-repeat
// can't add a controllable gap independent of the image's own size).
function LogoWatermark({ logo, logoSize = 44, gap = 40, opacity = 0.06 }) {
  const [patternUrl, setPatternUrl] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const tile = logoSize + gap;
      const canvas = document.createElement('canvas');
      canvas.width = tile;
      canvas.height = tile;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, (tile - logoSize) / 2, (tile - logoSize) / 2, logoSize, logoSize);
      setPatternUrl(canvas.toDataURL('image/png'));
    };
    img.src = logo;
    return () => { cancelled = true; };
  }, [logo, logoSize, gap]);

  if (!patternUrl) return null;
  const tile = logoSize + gap;

  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 pointer-events-none select-none"
      style={{
        backgroundImage: `url(${patternUrl})`,
        backgroundSize: `${tile}px ${tile}px`,
        backgroundRepeat: 'repeat',
        opacity,
        zIndex: 0,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------
function OverviewTab({ overallPct, positivePct, responses, allResponses, supervisors, criteriaAverages, supervisorStats, trendData, lowPerformer, goEntry }) {
  if (supervisors.length === 0) {
    return <EmptyState message="ابدأ بإضافة المشرفين والأقسام من تبويب الإعدادات." icon={Users} />;
  }
  if (responses.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <EmptyState
          message="لا توجد استبيانات مسجّلة هذا الشهر بعد. سجّل أول استبيان لتبدأ رؤية المؤشرات."
          icon={ClipboardList}
          action={{ label: 'تسجيل استبيان', onClick: goEntry }}
        />
        <MonthlyExportCard responses={allResponses} supervisors={supervisors} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-3xl p-5 flex flex-col items-center" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
        <p style={{ fontSize: 12, color: C.inkMuted, alignSelf: 'flex-start' }}>المؤشر العام للنظافة (هذا الشهر)</p>
        <GaugePulse pct={overallPct} count={responses.length} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatPill icon={CheckCircle2} label="نسبة الرضا الإيجابي" value={`${Math.round(positivePct)}%`} sub="ممتاز + جيد جدا" />
        <StatPill icon={Users} label="عدد المشرفين" value={supervisors.length} sub={`${responses.length} استبيان`} />
      </div>

      {lowPerformer && lowPerformer.pct !== null && lowPerformer.pct < 70 && (
        <div className="rounded-2xl p-3 flex items-center gap-3" style={{ background: C.redSoft, border: `1px solid ${C.red}30` }}>
          <AlertTriangle size={18} color={C.red} />
          <p style={{ fontSize: 12.5, color: C.ink }}>
            <span style={{ fontWeight: 700 }}>{lowPerformer.name}</span> ({lowPerformer.department}) بحاجة لمتابعة — المؤشر {Math.round(lowPerformer.pct)}%
          </p>
        </div>
      )}

      <section>
        <h2 style={{ fontFamily: 'Cairo', fontWeight: 700, fontSize: 14, marginBottom: 8 }}>المؤشر حسب بند الاستبيان</h2>
        <div className="rounded-2xl p-3" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
          <div dir="ltr">
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={criteriaAverages} layout="vertical" margin={{ left: 0, right: 20 }}>
              <CartesianGrid horizontal={false} stroke={C.border} />
              <XAxis type="number" domain={[0, 100]} hide />
              <YAxis type="category" dataKey="short" width={100} tick={{ fontSize: 11, fill: C.ink }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomBarTooltip />} cursor={{ fill: C.bg }} />
              <Bar dataKey="pct" radius={[6, 6, 6, 6]} barSize={16}>
                {criteriaAverages.map((c, i) => <Cell key={i} fill={scoreColor(c.pct)} />)}
                <LabelList dataKey="pct" position="right" formatter={(v) => `${v}%`} style={{ fontSize: 11, fill: C.inkMuted, fontWeight: 600 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          </div>
        </div>
      </section>

      {trendData.length > 1 && (
        <section>
          <h2 style={{ fontFamily: 'Cairo', fontWeight: 700, fontSize: 14, marginBottom: 8 }}>اتجاه المؤشر عبر الوقت</h2>
          <div className="rounded-2xl p-3" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={trendData} margin={{ left: -20, right: 10 }}>
                <CartesianGrid stroke={C.border} vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: C.inkMuted }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: C.inkMuted }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomBarTooltip />} />
                <Line type="monotone" dataKey="score" stroke={C.primary} strokeWidth={2.5} dot={{ r: 3, fill: C.primary }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 style={{ fontFamily: 'Cairo', fontWeight: 700, fontSize: 14 }}>ترتيب المشرفين</h2>
        </div>
        <div className="flex flex-col gap-2">
          {supervisorStats.slice(0, 5).map((s, i) => (
            <SupervisorRow key={s.id} s={s} rank={i + 1} />
          ))}
        </div>
      </section>

      <MonthlyExportCard responses={allResponses} supervisors={supervisors} />
    </div>
  );
}

function MonthlyExportCard({ responses, supervisors }) {
  const [month, setMonth] = useState(() => todayStr().slice(0, 7)); // YYYY-MM
  const [justExported, setJustExported] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const count = responses.filter((r) => r.date.startsWith(month)).length;

  const handleExport = async () => {
    if (count === 0 || isExporting) return;
    setIsExporting(true);
    try {
      await exportMonthlyReport({ responses, supervisors, criteria: CRITERIA, scale: SCALE, month });
      setJustExported(true);
      setTimeout(() => setJustExported(false), 2000);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <section>
      <h2 style={{ fontFamily: 'Cairo', fontWeight: 700, fontSize: 14, marginBottom: 8 }}>تصدير تقرير شهري</h2>
      <div className="rounded-2xl p-4 flex flex-col gap-3" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
        <div>
          <label style={{ fontSize: 12, color: C.inkMuted, fontWeight: 600 }}>اختر الشهر</label>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="w-full mt-1.5 rounded-xl px-3 py-2.5 text-sm"
            style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.ink }}
          />
        </div>
        <p style={{ fontSize: 11.5, color: C.inkMuted }}>
          {count > 0 ? `${count} استبيان مسجّل هذا الشهر — الملف يتضمّن ورقة ملخص برسم بياني وورقة بيانات كاملة` : 'لا توجد استبيانات في هذا الشهر'}
        </p>
        <button
          onClick={handleExport}
          disabled={count === 0 || isExporting}
          className="rounded-xl py-2.5 text-sm font-bold flex items-center justify-center gap-2"
          style={{ background: count > 0 ? C.primary : C.border, color: count > 0 ? '#fff' : C.inkMuted }}
        >
          {isExporting ? (
            'جاري التجهيز...'
          ) : justExported ? (
            <><CheckCircle2 size={16} /> تم التنزيل</>
          ) : (
            <><Download size={16} /> تصدير Excel</>
          )}
        </button>
      </div>
    </section>
  );
}

function SupervisorRow({ s, rank }) {
  const pct = s.pct ?? 0;
  const color = s.pct === null ? C.inkMuted : scoreColor(pct);
  return (
    <div className="rounded-xl px-3 py-2.5 flex items-center gap-3" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
      <span style={{ fontFamily: 'Cairo', fontWeight: 800, fontSize: 13, color: C.inkMuted, width: 18 }}>{rank}</span>
      <div className="flex-1 min-w-0">
        <p style={{ fontSize: 13, fontWeight: 700, color: C.ink }} className="truncate">{s.name}</p>
        <p style={{ fontSize: 11, color: C.inkMuted }} className="truncate">{s.department}</p>
      </div>
      {s.pct === null ? (
        <span style={{ fontSize: 11, color: C.inkMuted }}>لا بيانات</span>
      ) : (
        <span style={{ fontFamily: 'Cairo', fontWeight: 800, fontSize: 15, color }}>{Math.round(pct)}%</span>
      )}
    </div>
  );
}

function EmptyState({ message, icon: Icon, action }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 rounded-3xl" style={{ background: C.surface, border: `1px dashed ${C.border}` }}>
      <div className="rounded-2xl p-3 mb-3" style={{ background: C.primarySoft }}>
        <Icon size={22} color={C.primary} />
      </div>
      <p style={{ fontSize: 13, color: C.inkMuted, maxWidth: 240 }}>{message}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 px-4 py-2 rounded-xl text-sm font-semibold"
          style={{ background: C.primary, color: '#fff' }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Supervisors list + detail
// ---------------------------------------------------------------------------
function SupervisorsTab({ supervisorStats, onSelect, goManage }) {
  if (supervisorStats.length === 0) {
    return <EmptyState message="لم تتم إضافة أي مشرف بعد." icon={Users} action={{ label: 'إضافة مشرف', onClick: goManage }} />;
  }
  return (
    <div className="flex flex-col gap-2">
      {supervisorStats.map(s => {
        const pct = s.pct ?? 0;
        const color = s.pct === null ? C.inkMuted : scoreColor(pct);
        return (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            className="rounded-2xl px-4 py-3 flex items-center gap-3 text-right"
            style={{ background: C.surface, border: `1px solid ${C.border}` }}
          >
            <div className="rounded-xl p-2" style={{ background: C.primarySoft }}>
              <Building2 size={17} color={C.primary} />
            </div>
            <div className="flex-1 min-w-0">
              <p style={{ fontSize: 14, fontWeight: 700 }} className="truncate">{s.name}</p>
              <p style={{ fontSize: 11.5, color: C.inkMuted }} className="truncate">{s.department} · {s.count} استبيان هذا الشهر</p>
            </div>
            {s.pct !== null ? (
              <span style={{ fontFamily: 'Cairo', fontWeight: 800, fontSize: 16, color }}>{Math.round(pct)}%</span>
            ) : (
              <span style={{ fontSize: 11, color: C.inkMuted }}>لا بيانات</span>
            )}
            <ChevronRight size={16} color={C.inkMuted} style={{ transform: 'rotate(180deg)' }} />
          </button>
        );
      })}
    </div>
  );
}

function SupervisorDetail({ supId, supervisors, responses, onBack, onClearResponses }) {
  const sup = supervisors.find(s => s.id === supId);
  // Newest first: reverse (submissions are appended in order, so this puts
  // the latest-submitted one first), then a stable sort by date descending
  // keeps that "latest first" order for entries sharing the same day too.
  const rs = [...responses].filter(r => r.supervisorId === supId).reverse().sort((a, b) => b.date.localeCompare(a.date));
  const [expandedId, setExpandedId] = useState(null);
  const [confirmingClear, setConfirmingClear] = useState(false);

  const criteriaAverages = CRITERIA.map(c => {
    const vals = rs.map(r => r.ratings[c.id]);
    const pct = pctFromValues(vals);
    return { ...c, pct: Math.round(pct) };
  });
  const overall = rs.length
    ? criteriaAverages.reduce((a, b) => a + b.pct, 0) / criteriaAverages.length
    : 0;

  if (!sup) return null;

  const handleClear = async () => {
    await onClearResponses(supId);
    setConfirmingClear(false);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-1 text-sm" style={{ color: C.primary }}>
          <ArrowRight size={15} style={{ transform: 'rotate(180deg)' }} /> رجوع
        </button>
        {rs.length > 0 && !confirmingClear && (
          <button
            onClick={() => setConfirmingClear(true)}
            className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg"
            style={{ background: C.redSoft, color: C.red }}
          >
            <Trash2 size={13} /> حذف كل التقييمات
          </button>
        )}
      </div>

      {confirmingClear && (
        <div className="rounded-2xl p-4 flex flex-col gap-3" style={{ background: C.redSoft, border: `1px solid ${C.red}40` }}>
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} color={C.red} style={{ marginTop: 2, flexShrink: 0 }} />
            <p style={{ fontSize: 12.5, color: C.ink }}>
              بيتم حذف <span style={{ fontWeight: 700 }}>{rs.length}</span> استبيان مسجّل لـ{sup.name} هذا الشهر نهائيًا، وما يرجع بعد الحذف. متأكد؟
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleClear}
              className="flex-1 rounded-xl py-2 text-xs font-bold"
              style={{ background: C.red, color: '#fff' }}
            >
              نعم، احذف الكل
            </button>
            <button
              onClick={() => setConfirmingClear(false)}
              className="flex-1 rounded-xl py-2 text-xs font-semibold"
              style={{ background: C.surface, color: C.inkMuted, border: `1px solid ${C.border}` }}
            >
              إلغاء
            </button>
          </div>
        </div>
      )}

      <div className="rounded-3xl p-5" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
        <p style={{ fontFamily: 'Cairo', fontWeight: 800, fontSize: 18 }}>{sup.name}</p>
        <p style={{ fontSize: 12.5, color: C.inkMuted, marginBottom: 12 }}>{sup.department}</p>
        {rs.length === 0 ? (
          <p style={{ fontSize: 12.5, color: C.inkMuted }}>لا توجد استبيانات لهذا المشرف هذا الشهر بعد.</p>
        ) : (
          <div className="flex items-center gap-4">
            <span style={{ fontFamily: 'Cairo', fontWeight: 900, fontSize: 34, color: scoreColor(overall) }}>{Math.round(overall)}%</span>
            <div>
              <p style={{ fontSize: 12, fontWeight: 700, color: scoreColor(overall) }}>{scoreLabel(overall)}</p>
              <p style={{ fontSize: 11, color: C.inkMuted }}>{rs.length} استبيان مسجّل هذا الشهر</p>
            </div>
          </div>
        )}
      </div>

      {rs.length > 0 && (
        <div className="rounded-2xl p-3" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
          <div dir="ltr">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={criteriaAverages} layout="vertical" margin={{ left: 0, right: 20 }}>
              <CartesianGrid horizontal={false} stroke={C.border} />
              <XAxis type="number" domain={[0, 100]} hide />
              <YAxis type="category" dataKey="short" width={100} tick={{ fontSize: 11, fill: C.ink }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomBarTooltip />} cursor={{ fill: C.bg }} />
              <Bar dataKey="pct" radius={[6, 6, 6, 6]} barSize={16}>
                {criteriaAverages.map((c, i) => <Cell key={i} fill={scoreColor(c.pct)} />)}
                <LabelList dataKey="pct" position="right" formatter={(v) => `${v}%`} style={{ fontSize: 11, fill: C.inkMuted, fontWeight: 600 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          </div>
        </div>
      )}

      <section>
        <h2 style={{ fontFamily: 'Cairo', fontWeight: 700, fontSize: 14, marginBottom: 8 }}>سجل استبيانات هذا الشهر — اضغط أي غرفة لعرض التفاصيل</h2>
        <div className="flex flex-col gap-2">
          {rs.map(r => {
            const vals = CRITERIA.map(c => r.ratings[c.id]);
            const pct = pctFromValues(vals);
            const isOpen = expandedId === r.id;
            return (
              <div key={r.id} className="rounded-xl overflow-hidden" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
                <button
                  onClick={() => setExpandedId(isOpen ? null : r.id)}
                  className="w-full px-3 py-2.5 flex items-center gap-3 text-right"
                >
                  <CalendarDays size={14} color={C.inkMuted} />
                  <div className="flex-1 min-w-0">
                    <p style={{ fontSize: 12.5 }} className="truncate">
                      {r.date} {r.room && `· غرفة ${r.room}`} {r.patientName && `· ${r.patientName}`}
                    </p>
                    {r.comment && <p style={{ fontSize: 11, color: C.inkMuted }} className="truncate">{r.comment}</p>}
                  </div>
                  <span style={{ fontFamily: 'Cairo', fontWeight: 800, fontSize: 13, color: scoreColor(pct) }}>{Math.round(pct)}%</span>
                  <ChevronRight size={15} color={C.inkMuted} style={{ transform: isOpen ? 'rotate(-90deg)' : 'rotate(180deg)', transition: 'transform 0.15s' }} />
                </button>

                {isOpen && (
                  <div className="px-3 pb-3 flex flex-col gap-1.5" style={{ borderTop: `1px solid ${C.border}` }}>
                    {CRITERIA.map(c => {
                      const v = r.ratings[c.id];
                      const scaleItem = SCALE.find(s => s.value === v);
                      const reason = r.reasons && r.reasons[c.id];
                      return (
                        <div key={c.id} className="pt-1.5">
                          <div className="flex items-center justify-between">
                            <span style={{ fontSize: 12, color: C.ink }}>{c.label}</span>
                            <span
                              style={{
                                fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 999,
                                color: '#fff', background: scaleItem ? scaleItem.color : C.inkMuted,
                              }}
                            >
                              {scaleItem ? scaleItem.label : '—'}
                            </span>
                          </div>
                          {reason && (
                            <p style={{ fontSize: 11, color: C.amber, marginTop: 2 }}>السبب: {reason}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Round mode — the supervisor carries this while walking room to room.
// Pick yourself once, then log each patient in a few taps without leaving
// the screen; the room number auto-advances and today's count stays visible.
// ---------------------------------------------------------------------------
function RoundTab({ supervisors, responses, presetSupId, onSubmit, goManage, goOverview }) {
  const [supervisorId, setSupervisorId] = useState(null);
  const [ignorePreset, setIgnorePreset] = useState(false);

  if (supervisors.length === 0) {
    return <EmptyState message="أضف مشرفًا وقسمًا أولًا من الإعدادات قبل بدء الجولة." icon={Users} action={{ label: 'إضافة مشرف', onClick: goManage }} />;
  }

  // Personal link (?s=<id>) opens straight into that supervisor's round —
  // no name list, no PIN. "تبديل" falls back to the full list below.
  const presetSup = !ignorePreset && presetSupId ? supervisors.find(s => s.id === presetSupId) : null;
  const activeSupervisor = presetSup || supervisors.find(s => s.id === supervisorId);

  if (!activeSupervisor) {
    return <WhoAreYou supervisors={supervisors} onPick={setSupervisorId} />;
  }

  return (
    <RoundSession
      supervisor={activeSupervisor}
      responses={responses}
      onSubmit={onSubmit}
      onSwitch={presetSup ? null : () => { setSupervisorId(null); setIgnorePreset(true); }}
      goOverview={goOverview}
    />
  );
}

function WhoAreYou({ supervisors, onPick }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="text-center pt-4 pb-1">
        <p style={{ fontFamily: 'Cairo', fontWeight: 800, fontSize: 18 }}>من أنت؟</p>
        <p style={{ fontSize: 12.5, color: C.inkMuted, marginTop: 4 }}>اختر اسمك لبدء الجولة</p>
      </div>
      <div className="flex flex-col gap-2">
        {supervisors.map(s => (
          <button
            key={s.id}
            onClick={() => onPick(s.id)}
            className="rounded-2xl px-4 py-3.5 flex items-center gap-3 text-right"
            style={{ background: C.surface, border: `1px solid ${C.border}` }}
          >
            <div className="rounded-xl p-2" style={{ background: C.primarySoft }}>
              <Users size={17} color={C.primary} />
            </div>
            <div className="flex-1">
              <p style={{ fontSize: 14.5, fontWeight: 700 }}>{s.name}</p>
              <p style={{ fontSize: 11.5, color: C.inkMuted }}>{s.department}</p>

            </div>
            <ChevronRight size={16} color={C.inkMuted} style={{ transform: 'rotate(180deg)' }} />
          </button>
        ))}
      </div>
    </div>
  );
}

function ManagerGate({ hasPin, managerPin, onCreate, onSuccess, onCancel }) {
  const [stage, setStage] = useState(hasPin ? 'enter' : 'create'); // create | confirm | enter
  const [digits, setDigits] = useState('');
  const [firstPin, setFirstPin] = useState('');
  const [error, setError] = useState('');

  const press = (d) => {
    if (digits.length >= 4) return;
    const next = digits + d;
    setError('');
    setDigits(next);
    if (next.length === 4) {
      setTimeout(async () => {
        if (stage === 'create') {
          setFirstPin(next);
          setDigits('');
          setStage('confirm');
        } else if (stage === 'confirm') {
          if (next === firstPin) {
            const hash = await sha256Hex(next);
            onCreate(hash);
          } else {
            setError('الرمزان غير متطابقين، حاول من جديد');
            setDigits('');
            setFirstPin('');
            setStage('create');
          }
        } else {
          const hash = await sha256Hex(next);
          if (hash === managerPin) {
            onSuccess();
          } else {
            setError('رمز غير صحيح');
            setDigits('');
          }
        }
      }, 120);
    }
  };
  const backspace = () => setDigits(d => d.slice(0, -1));

  const titles = {
    create: 'أنشئ رمز دخول للمدير (٤ أرقام)',
    confirm: 'أعد إدخال الرمز للتأكيد',
    enter: 'أدخل رمز المدير',
  };

  return (
    <div className="fixed inset-0 z-30 flex flex-col items-center justify-center gap-5 px-6" style={{ background: 'rgba(10,29,27,0.55)', backdropFilter: 'blur(2px)' }}>
      <div className="w-full max-w-xs rounded-3xl p-6 flex flex-col items-center gap-5" style={{ background: C.surface }}>
        <div className="rounded-2xl p-3" style={{ background: C.primarySoft }}>
          <ShieldCheck size={22} color={C.primary} />
        </div>
        <div className="text-center">
          <p style={{ fontFamily: 'Cairo', fontWeight: 800, fontSize: 15 }}>{titles[stage]}</p>
          {!hasPin && stage === 'create' && (
            <p style={{ fontSize: 11.5, color: C.inkMuted, marginTop: 4 }}>هذا الرمز يحمي لوحة المدير والمؤشرات من الوصول غير المصرّح</p>
          )}
        </div>

        <div className="flex gap-3">
          {[0, 1, 2, 3].map(i => (
            <div
              key={i}
              className="rounded-full"
              style={{ width: 14, height: 14, background: i < digits.length ? (error ? C.red : C.primary) : C.border, transition: 'background 0.15s' }}
            />
          ))}
        </div>
        {error && <p style={{ fontSize: 12, color: C.red, fontWeight: 600, marginTop: -8 }}>{error}</p>}

        <div className="grid grid-cols-3 gap-3" style={{ width: 210 }}>
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
            <button
              key={d}
              onClick={() => press(d)}
              className="rounded-2xl py-3 text-lg font-bold"
              style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.ink }}
            >
              {d}
            </button>
          ))}
          <div />
          <button onClick={() => press('0')} className="rounded-2xl py-3 text-lg font-bold" style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.ink }}>0</button>
          <button onClick={backspace} className="rounded-2xl py-3 flex items-center justify-center" style={{ background: C.bg, border: `1px solid ${C.border}` }}>
            <X size={16} color={C.inkMuted} />
          </button>
        </div>

        <button onClick={onCancel} className="text-xs font-semibold" style={{ color: C.inkMuted }}>إلغاء</button>
      </div>
    </div>
  );
}

function RoundSession({ supervisor, responses, onSubmit, onSwitch, goOverview }) {
  const [date] = useState(todayStr());
  const [patientName, setPatientName] = useState('');
  const [room, setRoom] = useState('');
  const [ratings, setRatings] = useState({});
  const [reasonChoice, setReasonChoice] = useState({});
  const [reasonOther, setReasonOther] = useState({});
  const [comment, setComment] = useState('');
  const [flash, setFlash] = useState(false);
  const [clientIp, setClientIp] = useState(null);
  const [device] = useState(getDeviceLabel);

  // Look up the public IP once per session (best-effort — stays null if it fails).
  useEffect(() => {
    let cancelled = false;
    getClientIp().then((ip) => { if (!cancelled) setClientIp(ip); });
    return () => { cancelled = true; };
  }, []);

  const todaysCount = responses.filter(r => r.supervisorId === supervisor.id && r.date === date).length;

  const ROOM_DAILY_LIMIT = 3;
  const roomCountToday = room.trim().length > 0
    ? responses.filter(r => r.supervisorId === supervisor.id && r.date === date && r.room.trim() === room.trim()).length
    : 0;
  const roomAtLimit = roomCountToday >= ROOM_DAILY_LIMIT;

  const complete = CRITERIA.every(c => ratings[c.id]) && room.trim().length > 0 && patientName.trim().length > 0;
  const canSubmit = complete && !roomAtLimit;

  const submit = () => {
    if (!canSubmit) return;

    const reasons = {};
    CRITERIA.forEach(c => {
      const val = ratings[c.id];
      if (val === 1 || val === 2) {
        const choice = reasonChoice[c.id];
        if (choice) {
          const text = choice === OTHER_REASON ? (reasonOther[c.id] || '').trim() : choice;
          if (text) reasons[c.id] = text;
        }
      }
    });

    onSubmit({
      id: uid(), supervisorId: supervisor.id, date, room: room.trim(), patientName: patientName.trim(),
      ratings, reasons, comment, device, ip: clientIp,
    });

    // Clear the whole form after saving — nothing carries over to the next entry.
    setRatings({});
    setReasonChoice({});
    setReasonOther({});
    setComment('');
    setPatientName('');
    setRoom('');
    setFlash(true);
    setTimeout(() => setFlash(false), 1200);
  };

  return (
    <div className="flex flex-col gap-4 pb-4">
      {/* Session bar */}
      <div className="rounded-2xl px-4 py-3 flex items-center gap-3" style={{ background: C.primaryDeep }}>
        <div className="rounded-xl p-2" style={{ background: 'rgba(255,255,255,0.14)' }}>
          <Users size={17} color="#fff" />
        </div>
        <div className="flex-1 min-w-0">
          <p style={{ fontSize: 13.5, fontWeight: 700, color: '#fff' }} className="truncate">{supervisor.name}</p>
          <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)' }} className="truncate">{supervisor.department}</p>
        </div>
        <div className="text-center px-2">
          <p style={{ fontFamily: 'Cairo', fontWeight: 800, fontSize: 17, color: '#fff' }}>{todaysCount}</p>
          <p style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.6)' }}>اليوم</p>
        </div>
        {onSwitch && (
          <button onClick={onSwitch} className="text-xs font-semibold px-2 py-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.14)', color: '#fff' }}>
            تبديل
          </button>
        )}
      </div>

      {flash && (
        <div className="rounded-xl px-3 py-2 flex items-center gap-2" style={{ background: C.primarySoft }}>
          <CheckCircle2 size={15} color={C.primary} />
          <span style={{ fontSize: 12.5, color: C.primary, fontWeight: 600 }}>تم الحفظ — جاهز للغرفة التالية</span>
        </div>
      )}

      <div className="rounded-2xl p-4 flex flex-col gap-3" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
        <div>
          <label style={{ fontSize: 12, color: C.inkMuted, fontWeight: 600 }}>اسم المريض <span style={{ color: C.red }}>*</span></label>
          <input
            type="text" value={patientName} onChange={e => setPatientName(e.target.value)} placeholder="اسم المريض"
            className="w-full mt-1.5 rounded-xl px-3 py-2.5 text-sm"
            style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.ink }}
          />
        </div>
        <div>
          <label style={{ fontSize: 12, color: C.inkMuted, fontWeight: 600 }}>رقم الغرفة <span style={{ color: C.red }}>*</span></label>
          <input
            type="text"
            value={room}
            onChange={e => setRoom(e.target.value)}
            placeholder="مثال: 214"
            className="w-full mt-1.5 rounded-xl px-3 py-2.5 text-sm"
            style={{ background: C.bg, border: `1px solid ${roomAtLimit ? C.red : roomCountToday > 0 ? C.amber : C.border}`, color: C.ink }}
          />
          {roomAtLimit ? (
            <p style={{ fontSize: 11.5, color: C.red, marginTop: 5, fontWeight: 600 }}>
              ⚠ هذي الغرفة وصلت الحد الأقصى ({ROOM_DAILY_LIMIT} مرات) اليوم — غيّر رقم الغرفة عشان تقدر تحفظ
            </p>
          ) : roomCountToday > 0 ? (
            <p style={{ fontSize: 11.5, color: C.amber, marginTop: 5, fontWeight: 600 }}>
              هذي الغرفة مسجّلة {roomCountToday} {roomCountToday === 1 ? 'مرة' : 'مرات'} اليوم — متبقّي {ROOM_DAILY_LIMIT - roomCountToday}
            </p>
          ) : null}
        </div>
      </div>

      {CRITERIA.map((c, i) => {
        const val = ratings[c.id];
        const needsReason = val === 1 || val === 2;
        return (
          <div key={c.id} className="rounded-2xl p-4" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
            <div className="flex items-center gap-2 mb-3">
              <span style={{ fontFamily: 'Cairo', fontWeight: 800, fontSize: 12, color: C.primary, background: C.primarySoft, borderRadius: 999, width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
              <p style={{ fontSize: 13.5, fontWeight: 700 }}>{c.label}</p>
            </div>
            <RatingPicker value={val} onChange={(v) => setRatings({ ...ratings, [c.id]: v })} />

            {needsReason && (
              <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${C.border}` }}>
                <p style={{ fontSize: 11.5, color: C.inkMuted, fontWeight: 600, marginBottom: 6 }}>وش السبب؟ (اختياري)</p>
                <div className="flex flex-wrap gap-1.5">
                  {REASONS[c.id].map(r => {
                    const active = reasonChoice[c.id] === r;
                    return (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setReasonChoice({ ...reasonChoice, [c.id]: active ? null : r })}
                        className="rounded-full px-3 py-1.5 text-xs font-semibold"
                        style={{
                          background: active ? C.amber : C.bg,
                          color: active ? '#fff' : C.inkMuted,
                          border: `1px solid ${active ? C.amber : C.border}`,
                        }}
                      >
                        {r}
                      </button>
                    );
                  })}
                </div>
                {reasonChoice[c.id] === OTHER_REASON && (
                  <input
                    type="text"
                    value={reasonOther[c.id] || ''}
                    onChange={e => setReasonOther({ ...reasonOther, [c.id]: e.target.value })}
                    placeholder="اكتب السبب"
                    className="w-full mt-2 rounded-xl px-3 py-2 text-sm"
                    style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.ink }}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}

      <div className="rounded-2xl p-4" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
        <label style={{ fontSize: 12, color: C.inkMuted, fontWeight: 600 }}>ملاحظة تودّ ذكرها (اختياري)</label>
        <textarea
          value={comment} onChange={e => setComment(e.target.value)} rows={2}
          className="w-full mt-1.5 rounded-xl px-3 py-2.5 text-sm resize-none"
          style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.ink }}
        />
      </div>

      <button
        onClick={submit}
        disabled={!canSubmit}
        className="rounded-2xl py-3.5 text-sm font-bold flex items-center justify-center gap-2 sticky bottom-3"
        style={{
          background: canSubmit ? C.primary : C.border,
          color: canSubmit ? '#fff' : C.inkMuted,
          boxShadow: canSubmit ? '0 8px 20px rgba(14,92,85,0.3)' : 'none',
        }}
      >
        <Plus size={16} /> حفظ
      </button>

      <button onClick={goOverview} className="text-xs font-semibold text-center" style={{ color: C.inkMuted }}>
        عرض لوحة المدير والمؤشرات ←
      </button>

    </div>
  );
}

// ---------------------------------------------------------------------------
// Manage supervisors
// ---------------------------------------------------------------------------
function ManageTab({ supervisors, responses, onAdd, onRemove, onUpdate }) {
  const [name, setName] = useState('');
  const [department, setDepartment] = useState('');
  const [copiedId, setCopiedId] = useState(null);
  const [editingId, setEditingId] = useState(null);

  const add = () => {
    if (!name.trim() || !department.trim()) return;
    onAdd({ id: uid(), name: name.trim(), department: department.trim() });
    setName('');
    setDepartment('');
  };

  const [copiedType, setCopiedType] = useState(null);

  const copyLink = async (s) => {
    const url = `${window.location.origin}${window.location.pathname}?s=${s.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(s.id);
      setCopiedType('link');
      setTimeout(() => { setCopiedId(null); setCopiedType(null); }, 1800);
    } catch {
      window.prompt('انسخ هذا الرابط:', url);
    }
  };

  const copyMyScoreLink = async (s) => {
    const url = `${window.location.origin}${window.location.pathname}?mine=${s.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(s.id);
      setCopiedType('score');
      setTimeout(() => { setCopiedId(null); setCopiedType(null); }, 1800);
    } catch {
      window.prompt('انسخ هذا الرابط:', url);
    }
  };

  const [qrOpenId, setQrOpenId] = useState(null);
  const [qrUrls, setQrUrls] = useState({});

  const toggleQr = async (s) => {
    if (qrOpenId === s.id) { setQrOpenId(null); return; }
    setQrOpenId(s.id);
    if (!qrUrls[s.id]) {
      const url = `${window.location.origin}${window.location.pathname}?s=${s.id}`;
      try {
        const dataUrl = await QRCode.toDataURL(url, {
          width: 500,
          margin: 1,
          color: { dark: '#122A3D', light: '#FFFFFF' },
        });
        setQrUrls(prev => ({ ...prev, [s.id]: dataUrl }));
      } catch (e) {
        console.error('QR generation failed', e);
      }
    }
  };

  const copyQrImage = async (s) => {
    const dataUrl = qrUrls[s.id];
    if (!dataUrl) return;
    try {
      const blob = await (await fetch(dataUrl)).blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      setCopiedId(s.id);
      setCopiedType('qr');
      setTimeout(() => { setCopiedId(null); setCopiedType(null); }, 1800);
    } catch {
      // Some browsers don't support copying images — the download button still works.
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl p-4" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
        <p style={{ fontFamily: 'Cairo', fontWeight: 700, fontSize: 14, marginBottom: 10 }}>إضافة مشرف جديد</p>
        <div className="flex flex-col gap-2">
          <input
            value={name} onChange={e => setName(e.target.value)} placeholder="اسم المشرف"
            className="rounded-xl px-3 py-2.5 text-sm" style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.ink }}
          />
          <input
            value={department} onChange={e => setDepartment(e.target.value)} placeholder="القسم المسؤول عنه"
            className="rounded-xl px-3 py-2.5 text-sm" style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.ink }}
          />
          <button
            onClick={add}
            className="rounded-xl py-2.5 text-sm font-bold flex items-center justify-center gap-1.5 mt-1"
            style={{ background: C.primary, color: '#fff' }}
          >
            <Plus size={15} /> إضافة
          </button>
        </div>
      </div>

      <section>
        <p style={{ fontFamily: 'Cairo', fontWeight: 700, fontSize: 14, marginBottom: 8 }}>المشرفون الحاليون ({supervisors.length})</p>
        <div className="flex flex-col gap-2">
          {supervisors.length === 0 && <p style={{ fontSize: 12.5, color: C.inkMuted }}>لا يوجد مشرفون بعد.</p>}
          {supervisors.map(s => {
            const count = responses.filter(r => r.supervisorId === s.id).length;
            const isEditing = editingId === s.id;
            return (
              <div key={s.id} className="rounded-xl px-3 py-2.5 flex flex-col gap-2" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
                {isEditing ? (
                  <SupervisorEditor
                    supervisor={s}
                    onSave={(updates) => { onUpdate(s.id, updates); setEditingId(null); }}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p style={{ fontSize: 13, fontWeight: 700 }} className="truncate">{s.name}</p>
                        <p style={{ fontSize: 11, color: C.inkMuted }} className="truncate">{s.department} · {count} استبيان</p>
                      </div>
                      <button onClick={() => setEditingId(s.id)} className="rounded-lg p-1.5" style={{ background: C.primarySoft }}>
                        <Pencil size={14} color={C.primary} />
                      </button>
                      <button onClick={() => onRemove(s.id)} className="rounded-lg p-1.5" style={{ background: C.redSoft }}>
                        <Trash2 size={14} color={C.red} />
                      </button>
                    </div>

                    <button
                      onClick={() => copyLink(s)}
                      className="flex items-center justify-center gap-1.5 text-xs font-semibold px-2 py-1.5 rounded-lg"
                      style={{ background: copiedId === s.id && copiedType === 'link' ? C.primarySoft : C.bg, color: copiedId === s.id && copiedType === 'link' ? C.primary : C.ink }}
                    >
                      {copiedId === s.id && copiedType === 'link' ? (
                        <><CheckCircle2 size={13} /> تم نسخ الرابط</>
                      ) : (
                        <><LinkIcon size={13} /> نسخ رابط شخصي (لتوليد الـQR)</>
                      )}
                    </button>

                    <button
                      onClick={() => copyMyScoreLink(s)}
                      className="flex items-center justify-center gap-1.5 text-xs font-semibold px-2 py-1.5 rounded-lg"
                      style={{ background: copiedId === s.id && copiedType === 'score' ? C.primarySoft : C.bg, color: copiedId === s.id && copiedType === 'score' ? C.primary : C.ink }}
                    >
                      {copiedId === s.id && copiedType === 'score' ? (
                        <><CheckCircle2 size={13} /> تم نسخ الرابط</>
                      ) : (
                        <><Activity size={13} /> نسخ رابط "نسبتي" (له وحده)</>
                      )}
                    </button>

                    <button
                      onClick={() => toggleQr(s)}
                      className="flex items-center justify-center gap-1.5 text-xs font-semibold px-2 py-1.5 rounded-lg"
                      style={{ background: qrOpenId === s.id ? C.primarySoft : C.bg, color: qrOpenId === s.id ? C.primary : C.ink }}
                    >
                      <QrCode size={13} /> {qrOpenId === s.id ? 'إخفاء رمز QR' : 'عرض / تنزيل رمز QR'}
                    </button>

                    {qrOpenId === s.id && (
                      <div className="flex flex-col items-center gap-2 pt-3" style={{ borderTop: `1px solid ${C.border}` }}>
                        {qrUrls[s.id] ? (
                          <>
                            <img
                              src={qrUrls[s.id]}
                              alt={`QR - ${s.name}`}
                              style={{ width: 160, height: 160, borderRadius: 10, border: `1px solid ${C.border}` }}
                            />
                            <div className="flex gap-2 w-full">
                              <a
                                href={qrUrls[s.id]}
                                download={`qr-${s.name}.png`}
                                className="flex-1 text-center rounded-lg py-2 text-xs font-semibold"
                                style={{ background: C.primary, color: '#fff' }}
                              >
                                تنزيل الصورة
                              </a>
                              <button
                                onClick={() => copyQrImage(s)}
                                className="flex-1 rounded-lg py-2 text-xs font-semibold"
                                style={{
                                  background: copiedId === s.id && copiedType === 'qr' ? C.primarySoft : C.surface,
                                  color: copiedId === s.id && copiedType === 'qr' ? C.primary : C.ink,
                                  border: `1px solid ${C.border}`,
                                }}
                              >
                                {copiedId === s.id && copiedType === 'qr' ? 'تم النسخ' : 'نسخ الصورة'}
                              </button>
                            </div>
                          </>
                        ) : (
                          <p style={{ fontSize: 11.5, color: C.inkMuted }}>...جارِ التوليد</p>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function SupervisorEditor({ supervisor, onSave, onCancel }) {
  const [name, setName] = useState(supervisor.name);
  const [department, setDepartment] = useState(supervisor.department);

  const save = () => {
    if (!name.trim() || !department.trim()) return;
    onSave({ name: name.trim(), department: department.trim() });
  };

  return (
    <div className="flex flex-col gap-2">
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="اسم المشرف"
        autoFocus
        className="rounded-xl px-3 py-2.5 text-sm"
        style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.ink }}
      />
      <input
        value={department}
        onChange={e => setDepartment(e.target.value)}
        placeholder="القسم المسؤول عنه"
        className="rounded-xl px-3 py-2.5 text-sm"
        style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.ink }}
      />
      <div className="flex gap-2">
        <button onClick={save} className="flex-1 rounded-xl py-2 text-xs font-bold" style={{ background: C.primary, color: '#fff' }}>
          حفظ
        </button>
        <button onClick={onCancel} className="flex-1 rounded-xl py-2 text-xs font-semibold" style={{ background: C.bg, color: C.inkMuted, border: `1px solid ${C.border}` }}>
          إلغاء
        </button>
      </div>
    </div>
  );
}
