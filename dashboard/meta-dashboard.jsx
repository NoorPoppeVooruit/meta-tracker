import { useState, useEffect, useCallback } from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area, ScatterChart, Scatter } from "recharts";

// ── SAMPLE DATA (vervang met CSV upload of echte data) ─────────────────────
function generateSampleData() {
  const pages = [
    { label: "Hans Bonte", color: "#e85d4a", platform: "facebook" },
    { label: "Caroline Gennez", color: "#4a9ede", platform: "facebook" },
    { label: "Frank Vandenbroucke", color: "#5cb85c", platform: "facebook" },
  ];

  const snapshots = [];
  const posts = [];
  const followerSnaps = [];

  pages.forEach((page, pi) => {
    const baseReach = [3200, 5800, 4100][pi];
    const postFreq = [1.2, 0.6, 0.9][pi]; // posts per dag
    const followers = [28000, 52000, 38000][pi];

    // 10 posts over 14 dagen
    for (let p = 0; p < 10; p++) {
      const daysAgo = Math.floor(Math.random() * 14);
      const postId = `${page.label.replace(/ /g, "_")}_post_${p}`;
      const createdTime = new Date(Date.now() - daysAgo * 86400000).toISOString();

      posts.push({
        post_id: postId,
        page_label: page.label,
        platform: page.platform,
        created_time: createdTime,
        message: `Sample post ${p + 1} van ${page.label}`,
        permalink: "#",
      });

      // 72 snapshots per post (elk uur)
      for (let h = 0; h < Math.min(72, daysAgo * 24 + 12); h++) {
        const growth = 1 - Math.exp(-h / 18);
        const noise = 0.85 + Math.random() * 0.3;
        const reach = Math.round(baseReach * growth * noise * (0.7 + Math.random() * 0.6));
        snapshots.push({
          post_id: postId,
          page_label: page.label,
          platform: page.platform,
          measured_at: new Date(new Date(createdTime).getTime() + h * 3600000).toISOString(),
          uur_na_plaatsing: h,
          reach,
          impressions: Math.round(reach * 1.4),
          engaged_users: Math.round(reach * 0.08),
          likes: Math.round(reach * 0.05 * noise),
          comments: Math.round(reach * 0.008 * noise),
          shares: Math.round(reach * 0.006 * noise),
          reactions: Math.round(reach * 0.055 * noise),
        });
      }
    }

    // Follower snapshots over 14 dagen
    for (let d = 13; d >= 0; d--) {
      followerSnaps.push({
        page_label: page.label,
        platform: page.platform,
        measured_at: new Date(Date.now() - d * 86400000).toISOString(),
        followers: followers + Math.round((13 - d) * postFreq * 12 + Math.random() * 20 - 10),
        fans: Math.round(followers * 0.7),
      });
    }
  });

  return { snapshots, posts, followerSnaps };
}

// ── CSV PARSER ──────────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split("\n");
  const headers = lines[0].split(",").map(h => h.trim().replace(/"/g, ""));
  return lines.slice(1).map(line => {
    const vals = line.split(",").map(v => v.trim().replace(/"/g, ""));
    const obj = {};
    headers.forEach((h, i) => { obj[h] = isNaN(vals[i]) ? vals[i] : (vals[i] === "" ? null : Number(vals[i])); });
    return obj;
  });
}

// ── KLEUREN PER PAGINA ───────────────────────────────────────────────────────
const PAGE_COLORS = {
  "Hans Bonte": "#e85d4a",
  "Caroline Gennez": "#4a9ede",
  "Frank Vandenbroucke": "#5cb85c",
};
const getColor = (label) => PAGE_COLORS[label] || "#888";

// ── CUSTOM TOOLTIP ──────────────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#1a1a2e", border: "1px solid #333", borderRadius: 8, padding: "10px 14px", fontSize: 12 }}>
      <p style={{ color: "#aaa", marginBottom: 6 }}>{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color, margin: "2px 0" }}>
          {p.name}: <strong>{typeof p.value === "number" ? p.value.toLocaleString("nl-NL") : p.value}</strong>
        </p>
      ))}
    </div>
  );
};

// ── MAIN DASHBOARD ──────────────────────────────────────────────────────────
export default function MetaDashboard() {
  const [data, setData] = useState(null);
  const [activeTab, setActiveTab] = useState("overzicht");
  const [selectedPage, setSelectedPage] = useState("alle");
  const [selectedMetric, setSelectedMetric] = useState("reach");
  const [isDemoMode, setIsDemoMode] = useState(true);
  const [lastUpdate] = useState(new Date().toLocaleTimeString("nl-NL"));

  useEffect(() => {
    setData(generateSampleData());
  }, []);

  const handleCSVUpload = useCallback((e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const rows = parseCSV(ev.target.result);
        // Detecteer type CSV op basis van kolommen
        if (rows[0]?.post_id && rows[0]?.measured_at) {
          setData(prev => ({ ...prev, snapshots: rows }));
          setIsDemoMode(false);
        } else if (rows[0]?.followers) {
          setData(prev => ({ ...prev, followerSnaps: rows }));
          setIsDemoMode(false);
        }
      } catch (err) {
        alert("CSV kon niet worden geladen: " + err.message);
      }
    };
    reader.readAsText(file);
  }, []);

  if (!data) return <div style={{ background: "#0d0d1a", color: "#fff", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>Laden...</div>;

  const { snapshots, posts, followerSnaps } = data;
  const pages = [...new Set(snapshots.map(s => s.page_label))];

  // ── BEREKENINGEN ─────────────────────────────────────────────────────────
  // Gemiddelde metrics per pagina (laatste snapshot per post)
  const summaryByPage = pages.map(label => {
    const pageSnaps = snapshots.filter(s => s.page_label === label);
    const byPost = {};
    pageSnaps.forEach(s => {
      if (!byPost[s.post_id] || s.measured_at > byPost[s.post_id].measured_at) byPost[s.post_id] = s;
    });
    const latest = Object.values(byPost);
    const avg = (key) => latest.length ? Math.round(latest.reduce((a, s) => a + (s[key] || 0), 0) / latest.length) : 0;
    const pagePosts = posts.filter(p => p.page_label === label);
    const daysSpan = 14;
    const postFreq = (pagePosts.length / daysSpan).toFixed(2);
    return {
      label,
      posts: latest.length,
      postFreq,
      avgReach: avg("reach"),
      avgLikes: avg("likes"),
      avgComments: avg("comments"),
      avgShares: avg("shares"),
      avgEngaged: avg("engaged_users"),
      maxReach: Math.max(...latest.map(s => s.reach || 0)),
      color: getColor(label),
    };
  });

  // Reach groei over tijd (gemiddeld per uur na plaatsing)
  const reachByHour = {};
  snapshots.forEach(s => {
    const h = Math.round(s.uur_na_plaatsing || 0);
    if (h > 72) return;
    if (!reachByHour[h]) reachByHour[h] = {};
    if (!reachByHour[h][s.page_label]) reachByHour[h][s.page_label] = { total: 0, count: 0 };
    reachByHour[h][s.page_label].total += s.reach || 0;
    reachByHour[h][s.page_label].count += 1;
  });
  const hourlyData = Object.entries(reachByHour)
    .filter(([h]) => Number(h) % 3 === 0)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([h, pageData]) => {
      const obj = { uur: `${h}u` };
      pages.forEach(label => {
        obj[label] = pageData[label] ? Math.round(pageData[label].total / pageData[label].count) : null;
      });
      return obj;
    });

  // Follower groei per dag
  const followerByDay = {};
  followerSnaps.forEach(f => {
    const day = f.measured_at?.slice(0, 10);
    if (!followerByDay[day]) followerByDay[day] = {};
    followerByDay[day][f.page_label] = f.followers;
  });
  const followerData = Object.entries(followerByDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, vals]) => ({
      dag: new Date(day).toLocaleDateString("nl-NL", { day: "numeric", month: "short" }),
      ...vals,
    }));

  // Post frequentie vs gem. reach scatter data
  const scatterData = summaryByPage.map(p => ({
    name: p.label,
    x: Number(p.postFreq),
    y: p.avgReach,
    color: p.color,
  }));

  // Metric vergelijking bar chart
  const metricData = summaryByPage.map(p => ({
    name: p.label.split(" ")[0],
    fullName: p.label,
    reach: p.avgReach,
    likes: p.avgLikes,
    comments: p.avgComments,
    shares: p.avgShares,
    engaged: p.avgEngaged,
    color: p.color,
  }));

  const tabs = [
    { id: "overzicht", label: "📊 Overzicht" },
    { id: "reach", label: "📈 Reach groei" },
    { id: "volgers", label: "👥 Volgers" },
    { id: "vergelijking", label: "⚖️ Vergelijking" },
  ];

  const styles = {
    app: { background: "#0a0a14", minHeight: "100vh", color: "#e0e0f0", fontFamily: "'DM Sans', system-ui, sans-serif" },
    header: { background: "linear-gradient(135deg, #0d0d20 0%, #141428 100%)", borderBottom: "1px solid #1e1e3a", padding: "20px 32px", display: "flex", justifyContent: "space-between", alignItems: "center" },
    logo: { display: "flex", alignItems: "center", gap: 12 },
    logoIcon: { width: 36, height: 36, background: "linear-gradient(135deg, #4267B2, #e1306c)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 },
    title: { fontSize: 20, fontWeight: 700, color: "#fff", margin: 0 },
    subtitle: { fontSize: 12, color: "#666", margin: 0 },
    demoBadge: { background: isDemoMode ? "#c4811520" : "#1a5c2820", border: `1px solid ${isDemoMode ? "#c48115" : "#2e7d32"}`, color: isDemoMode ? "#f0a832" : "#5cb85c", borderRadius: 20, padding: "4px 12px", fontSize: 11, fontWeight: 600 },
    nav: { background: "#0d0d1e", borderBottom: "1px solid #1a1a30", padding: "0 32px", display: "flex", gap: 4 },
    tab: (active) => ({ padding: "14px 20px", cursor: "pointer", fontSize: 13, fontWeight: 500, color: active ? "#8ab4f8" : "#666", borderBottom: `2px solid ${active ? "#8ab4f8" : "transparent"}`, transition: "all 0.2s", background: "none", border: "none", borderBottom: `2px solid ${active ? "#8ab4f8" : "transparent"}` }),
    content: { padding: "28px 32px", maxWidth: 1400, margin: "0 auto" },
    grid: { display: "grid", gap: 16 },
    card: { background: "#0d0d1e", border: "1px solid #1a1a30", borderRadius: 14, padding: "20px 24px" },
    cardTitle: { fontSize: 13, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 16, margin: "0 0 16px 0" },
    statCard: (color) => ({ background: `linear-gradient(135deg, ${color}12, ${color}06)`, border: `1px solid ${color}25`, borderRadius: 14, padding: "20px 24px", position: "relative", overflow: "hidden" }),
    statValue: { fontSize: 32, fontWeight: 800, margin: "8px 0 4px", letterSpacing: "-0.02em" },
    statLabel: { fontSize: 12, color: "#888", fontWeight: 500 },
    uploadBtn: { background: "#1a1a30", border: "1px dashed #333", borderRadius: 10, padding: "10px 20px", cursor: "pointer", color: "#888", fontSize: 12, display: "flex", alignItems: "center", gap: 8 },
  };

  return (
    <div style={styles.app}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.logo}>
          <div style={styles.logoIcon}>📱</div>
          <div>
            <p style={styles.title}>Meta Tracker Dashboard</p>
            <p style={styles.subtitle}>Reach & engagement analyse • Bijgewerkt: {lastUpdate}</p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span style={styles.demoBadge}>{isDemoMode ? "⚠ Demo data" : "✓ Echte data"}</span>
          <label style={styles.uploadBtn}>
            📂 CSV laden
            <input type="file" accept=".csv" style={{ display: "none" }} onChange={handleCSVUpload} />
          </label>
        </div>
      </div>

      {/* Navigation */}
      <div style={styles.nav}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={styles.tab(activeTab === t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={styles.content}>
        {/* ── OVERZICHT ─────────────────────────────────────────────── */}
        {activeTab === "overzicht" && (
          <div style={{ ...styles.grid, gridTemplateColumns: "1fr" }}>
            {/* Stat cards per pagina */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
              {summaryByPage.map(p => (
                <div key={p.label} style={styles.statCard(p.color)}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <p style={{ ...styles.statLabel, color: p.color, fontWeight: 700, fontSize: 13 }}>{p.label}</p>
                      <p style={{ ...styles.statValue, color: "#fff" }}>{p.avgReach.toLocaleString("nl-NL")}</p>
                      <p style={styles.statLabel}>Gem. reach per post</p>
                    </div>
                    <div style={{ background: `${p.color}20`, borderRadius: 8, padding: "8px 12px", textAlign: "center" }}>
                      <p style={{ color: p.color, fontSize: 20, fontWeight: 800, margin: 0 }}>{p.postFreq}</p>
                      <p style={{ color: "#666", fontSize: 10, margin: 0 }}>posts/dag</p>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 16 }}>
                    {[["❤️", "Likes", p.avgLikes], ["💬", "Comments", p.avgComments], ["🔗", "Shares", p.avgShares]].map(([icon, name, val]) => (
                      <div key={name} style={{ background: "#ffffff08", borderRadius: 8, padding: "8px", textAlign: "center" }}>
                        <p style={{ margin: 0, fontSize: 11, color: "#888" }}>{icon} {name}</p>
                        <p style={{ margin: "4px 0 0", fontWeight: 700, fontSize: 14, color: "#ddd" }}>{(val || 0).toLocaleString("nl-NL")}</p>
                      </div>
                    ))}
                  </div>
                  <div style={{ position: "absolute", top: -20, right: -20, width: 80, height: 80, borderRadius: "50%", background: `${p.color}08` }} />
                </div>
              ))}
            </div>

            {/* Metric bar vergelijking */}
            <div style={styles.card}>
              <p style={styles.cardTitle}>Gem. Reach per post — vergelijking</p>
              <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                {["reach", "likes", "comments", "shares", "engaged"].map(m => (
                  <button key={m} onClick={() => setSelectedMetric(m)} style={{
                    padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer",
                    background: selectedMetric === m ? "#8ab4f8" : "#1a1a30",
                    color: selectedMetric === m ? "#0a0a14" : "#888",
                    border: "none"
                  }}>
                    {m.charAt(0).toUpperCase() + m.slice(1)}
                  </button>
                ))}
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={metricData} barSize={50}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1a1a30" />
                  <XAxis dataKey="name" tick={{ fill: "#888", fontSize: 12 }} />
                  <YAxis tick={{ fill: "#888", fontSize: 11 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey={selectedMetric} radius={[6, 6, 0, 0]} fill="#8ab4f8"
                    label={{ position: "top", fill: "#666", fontSize: 11, formatter: v => v?.toLocaleString("nl-NL") }}
                  >
                    {metricData.map((entry, i) => (
                      <rect key={i} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Top posts tabel */}
            <div style={styles.card}>
              <p style={styles.cardTitle}>Top posts op basis van reach</p>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #1a1a30" }}>
                    {["Pagina", "Post (preview)", "Reach", "Likes", "Comments", "Uur gemeten"].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "8px 12px", color: "#666", fontWeight: 600, fontSize: 11, textTransform: "uppercase" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const byPost = {};
                    snapshots.forEach(s => {
                      if (!byPost[s.post_id] || s.reach > (byPost[s.post_id].reach || 0)) byPost[s.post_id] = s;
                    });
                    return Object.values(byPost)
                      .sort((a, b) => (b.reach || 0) - (a.reach || 0))
                      .slice(0, 10)
                      .map((s, i) => {
                        const post = posts.find(p => p.post_id === s.post_id);
                        return (
                          <tr key={i} style={{ borderBottom: "1px solid #111", transition: "background 0.1s" }}
                            onMouseEnter={e => e.currentTarget.style.background = "#ffffff05"}
                            onMouseLeave={e => e.currentTarget.style.background = ""}>
                            <td style={{ padding: "10px 12px" }}>
                              <span style={{ color: getColor(s.page_label), fontWeight: 700, fontSize: 12 }}>{s.page_label}</span>
                            </td>
                            <td style={{ padding: "10px 12px", color: "#aaa", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {post?.message?.slice(0, 60) || s.post_id.slice(-12)}...
                            </td>
                            <td style={{ padding: "10px 12px", fontWeight: 700, color: "#fff" }}>{(s.reach || 0).toLocaleString("nl-NL")}</td>
                            <td style={{ padding: "10px 12px", color: "#aaa" }}>{(s.likes || 0).toLocaleString("nl-NL")}</td>
                            <td style={{ padding: "10px 12px", color: "#aaa" }}>{(s.comments || 0).toLocaleString("nl-NL")}</td>
                            <td style={{ padding: "10px 12px", color: "#666", fontSize: 11 }}>{Math.round(s.uur_na_plaatsing || 0)}u</td>
                          </tr>
                        );
                      });
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── REACH GROEI ────────────────────────────────────────────── */}
        {activeTab === "reach" && (
          <div style={{ ...styles.grid, gap: 16 }}>
            <div style={styles.card}>
              <p style={styles.cardTitle}>Gemiddelde reach per uur na plaatsing (eerste 72 uur)</p>
              <ResponsiveContainer width="100%" height={340}>
                <AreaChart data={hourlyData}>
                  <defs>
                    {pages.map(label => (
                      <linearGradient key={label} id={`grad_${label.replace(/ /g,"_")}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={getColor(label)} stopOpacity={0.25} />
                        <stop offset="95%" stopColor={getColor(label)} stopOpacity={0} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1a1a30" />
                  <XAxis dataKey="uur" tick={{ fill: "#666", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#666", fontSize: 11 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12, color: "#888" }} />
                  {pages.map(label => (
                    <Area key={label} type="monotone" dataKey={label} stroke={getColor(label)} strokeWidth={2}
                      fill={`url(#grad_${label.replace(/ /g,"_")})`} dot={false} connectNulls />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Per pagina detail */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
              {summaryByPage.map(p => (
                <div key={p.label} style={styles.card}>
                  <p style={{ ...styles.cardTitle, color: p.color }}>{p.label}</p>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    {[
                      ["Max reach", p.maxReach.toLocaleString("nl-NL")],
                      ["Gem. reach", p.avgReach.toLocaleString("nl-NL")],
                      ["Posts gevolgd", p.posts],
                      ["Posts/dag", p.postFreq],
                    ].map(([name, val]) => (
                      <div key={name} style={{ background: `${p.color}10`, borderRadius: 10, padding: "12px" }}>
                        <p style={{ color: "#666", fontSize: 11, margin: 0 }}>{name}</p>
                        <p style={{ color: "#fff", fontSize: 20, fontWeight: 800, margin: "4px 0 0" }}>{val}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Reach vs engagement scatter */}
            <div style={styles.card}>
              <p style={styles.cardTitle}>Post frequentie vs gemiddelde reach</p>
              <div style={{ display: "flex", gap: 24, alignItems: "center", height: 260 }}>
                <ResponsiveContainer width="70%" height="100%">
                  <ScatterChart>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a1a30" />
                    <XAxis dataKey="x" name="Posts/dag" type="number" domain={[0, 2]} tick={{ fill: "#666", fontSize: 11 }} label={{ value: "Posts per dag", position: "bottom", fill: "#666", fontSize: 11 }} />
                    <YAxis dataKey="y" name="Gem. reach" tick={{ fill: "#666", fontSize: 11 }} label={{ value: "Gem. reach", angle: -90, position: "insideLeft", fill: "#666", fontSize: 11 }} />
                    <Tooltip cursor={{ strokeDasharray: "3 3" }} content={({ payload }) => {
                      if (!payload?.length) return null;
                      const d = payload[0].payload;
                      return <div style={{ background: "#1a1a2e", border: "1px solid #333", borderRadius: 8, padding: "8px 12px", fontSize: 12 }}>
                        <p style={{ color: getColor(d.name), fontWeight: 700, margin: 0 }}>{d.name}</p>
                        <p style={{ color: "#aaa", margin: "4px 0 0" }}>Posts/dag: <b style={{ color: "#fff" }}>{d.x}</b></p>
                        <p style={{ color: "#aaa", margin: "2px 0 0" }}>Gem. reach: <b style={{ color: "#fff" }}>{d.y?.toLocaleString("nl-NL")}</b></p>
                      </div>;
                    }} />
                    {scatterData.map(d => (
                      <Scatter key={d.name} data={[d]} fill={d.color} r={14} />
                    ))}
                  </ScatterChart>
                </ResponsiveContainer>
                <div style={{ flex: 1 }}>
                  <p style={{ color: "#888", fontSize: 12, lineHeight: 1.6 }}>
                    Deze grafiek toont of er een verband is tussen <strong style={{ color: "#ddd" }}>postfrequentie</strong> en <strong style={{ color: "#ddd" }}>gemiddelde reach</strong> per post.
                  </p>
                  <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                    {summaryByPage.map(p => (
                      <div key={p.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 10, height: 10, borderRadius: "50%", background: p.color }} />
                        <span style={{ fontSize: 12, color: "#888" }}>{p.label}: <b style={{ color: "#ddd" }}>{p.postFreq} posts/dag</b></span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── VOLGERS ─────────────────────────────────────────────────── */}
        {activeTab === "volgers" && (
          <div style={{ ...styles.grid, gap: 16 }}>
            <div style={styles.card}>
              <p style={styles.cardTitle}>Follower groei over tijd</p>
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={followerData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1a1a30" />
                  <XAxis dataKey="dag" tick={{ fill: "#666", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#666", fontSize: 11 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {pages.map(label => (
                    <Line key={label} type="monotone" dataKey={label} stroke={getColor(label)} strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
              {pages.map(label => {
                const pageFollowers = followerSnaps.filter(f => f.page_label === label).sort((a, b) => a.measured_at?.localeCompare(b.measured_at));
                const latest = pageFollowers[pageFollowers.length - 1];
                const oldest = pageFollowers[0];
                const growth = latest && oldest ? latest.followers - oldest.followers : 0;
                return (
                  <div key={label} style={styles.statCard(getColor(label))}>
                    <p style={{ ...styles.statLabel, color: getColor(label), fontWeight: 700, fontSize: 13, margin: "0 0 8px" }}>{label}</p>
                    <p style={{ ...styles.statValue, color: "#fff", margin: "0 0 4px" }}>{(latest?.followers || 0).toLocaleString("nl-NL")}</p>
                    <p style={styles.statLabel}>Volgers</p>
                    <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                      <div style={{ background: growth > 0 ? "#2e7d3220" : "#c62828", borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: 700, color: growth > 0 ? "#5cb85c" : "#e57373" }}>
                        {growth > 0 ? "+" : ""}{growth.toLocaleString("nl-NL")} in 14 dagen
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── VERGELIJKING ─────────────────────────────────────────────── */}
        {activeTab === "vergelijking" && (
          <div style={{ ...styles.grid, gap: 16 }}>
            {/* Radar / multi-metric vergelijking */}
            <div style={styles.card}>
              <p style={styles.cardTitle}>Engagement vergelijking — alle metrics</p>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={[
                  { metric: "Reach", ...Object.fromEntries(summaryByPage.map(p => [p.label, p.avgReach])) },
                  { metric: "Likes", ...Object.fromEntries(summaryByPage.map(p => [p.label, p.avgLikes])) },
                  { metric: "Comments", ...Object.fromEntries(summaryByPage.map(p => [p.label, p.avgComments])) },
                  { metric: "Shares", ...Object.fromEntries(summaryByPage.map(p => [p.label, p.avgShares])) },
                  { metric: "Engaged", ...Object.fromEntries(summaryByPage.map(p => [p.label, p.avgEngaged])) },
                ]}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1a1a30" />
                  <XAxis dataKey="metric" tick={{ fill: "#888", fontSize: 12 }} />
                  <YAxis tick={{ fill: "#666", fontSize: 11 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {summaryByPage.map(p => (
                    <Bar key={p.label} dataKey={p.label} fill={p.color} radius={[4, 4, 0, 0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Score tabel */}
            <div style={styles.card}>
              <p style={styles.cardTitle}>Volledig overzicht per pagina</p>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #1a1a30" }}>
                    {["Pagina", "Posts", "Posts/dag", "Gem. Reach", "Gem. Likes", "Gem. Comments", "Gem. Shares", "Max. Reach"].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "10px 12px", color: "#666", fontWeight: 600, fontSize: 11, textTransform: "uppercase" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {summaryByPage.sort((a, b) => b.avgReach - a.avgReach).map((p, i) => (
                    <tr key={p.label} style={{ borderBottom: "1px solid #111" }}>
                      <td style={{ padding: "12px", display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: p.color }} />
                        <span style={{ color: p.color, fontWeight: 700 }}>{p.label}</span>
                        {i === 0 && <span style={{ background: "#f0a83220", color: "#f0a832", borderRadius: 4, padding: "2px 8px", fontSize: 10, fontWeight: 700 }}>🥇 Beste reach</span>}
                      </td>
                      <td style={{ padding: "12px", color: "#aaa" }}>{p.posts}</td>
                      <td style={{ padding: "12px", color: "#aaa" }}>{p.postFreq}/dag</td>
                      <td style={{ padding: "12px", fontWeight: 700, color: "#fff" }}>{p.avgReach.toLocaleString("nl-NL")}</td>
                      <td style={{ padding: "12px", color: "#aaa" }}>{p.avgLikes.toLocaleString("nl-NL")}</td>
                      <td style={{ padding: "12px", color: "#aaa" }}>{p.avgComments.toLocaleString("nl-NL")}</td>
                      <td style={{ padding: "12px", color: "#aaa" }}>{p.avgShares.toLocaleString("nl-NL")}</td>
                      <td style={{ padding: "12px", color: "#aaa" }}>{p.maxReach.toLocaleString("nl-NL")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Conclusie box */}
            <div style={{ ...styles.card, background: "linear-gradient(135deg, #0d1a0d, #0a140a)", border: "1px solid #1a3020" }}>
              <p style={{ ...styles.cardTitle, color: "#5cb85c" }}>📋 Analyse-samenvatting</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                {[
                  { title: "Hoogste gem. reach", value: summaryByPage.sort((a,b) => b.avgReach - a.avgReach)[0]?.label, color: "#f0a832" },
                  { title: "Meeste posts", value: summaryByPage.sort((a,b) => Number(b.postFreq) - Number(a.postFreq))[0]?.label, color: "#8ab4f8" },
                  { title: "Beste engagement rate", value: summaryByPage.sort((a,b) => (b.avgLikes/b.avgReach) - (a.avgLikes/a.avgReach))[0]?.label, color: "#e1306c" },
                  { title: "Meeste comments", value: summaryByPage.sort((a,b) => b.avgComments - a.avgComments)[0]?.label, color: "#5cb85c" },
                ].map(({ title, value, color }) => (
                  <div key={title} style={{ background: "#ffffff06", borderRadius: 10, padding: 16 }}>
                    <p style={{ color: "#666", fontSize: 11, margin: 0, textTransform: "uppercase", fontWeight: 600 }}>{title}</p>
                    <p style={{ color, fontSize: 18, fontWeight: 800, margin: "8px 0 0" }}>{value}</p>
                  </div>
                ))}
              </div>
              {isDemoMode && (
                <p style={{ color: "#f0a832", fontSize: 12, marginTop: 16, padding: "10px 14px", background: "#f0a83210", borderRadius: 8, border: "1px solid #f0a83230" }}>
                  ⚠️ Dit zijn demo-gegevens. Upload je echte CSV-export vanuit Google Sheets of SQLite om echte inzichten te zien.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
