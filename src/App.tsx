import { useState, useEffect, useRef, useMemo } from "react";
import html2canvas from "html2canvas";

// ─── CONFIG ─────────────────────────────────────────────────────────────────
const TIME_SLOTS = [
  { id: "s1", label: "8:45 AM – 10:00 AM", start: 525, end: 600 },
  { id: "s2", label: "10:10 AM – 11:25 AM", start: 610, end: 685 },
  { id: "s3", label: "11:35 AM – 12:50 PM", start: 695, end: 770 },
  { id: "s4", label: "1:00 PM – 2:15 PM", start: 780, end: 855 },
  { id: "s5", label: "2:25 PM – 3:40 PM", start: 865, end: 940 },
  { id: "s6", label: "3:50 PM – 5:05 PM", start: 950, end: 1025 },
];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu"];
const COURSE_COLORS = [
  "#7F77DD", "#1D9E75", "#D85A30", "#D4537E", "#378ADD",
  "#639922", "#BA7517", "#3C3489", "#0F6E56", "#993C1D",
];

function minutesToLabel(m) {
  const h = Math.floor(m / 60), mm = m % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const hh = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hh}:${mm.toString().padStart(2, "0")} ${ampm}`;
}
function uid() { return Math.random().toString(36).slice(2, 9); }

function newMeeting() { return { day: "", slotId: "" }; }
function newSection(courseId) {
  return { id: uid(), courseId, label: "A", meetings: [newMeeting()] };
}
function newCourse() {
  const id = uid();
  return { id, code: "", sections: [newSection(id)] };
}

// ─── GENERATION LOGIC ────────────────────────────────────────────────────────
function meetingsOverlap(a, b) {
  if (a.day !== b.day) return false;
  const sa = TIME_SLOTS.find(s => s.id === a.slotId);
  const sb = TIME_SLOTS.find(s => s.id === b.slotId);
  if (!sa || !sb) return false;
  return sa.start < sb.end && sb.start < sa.end;
}
function sectionValid(section) {
  const ms = section.meetings;
  for (let i = 0; i < ms.length; i++)
    for (let j = i + 1; j < ms.length; j++)
      if (meetingsOverlap(ms[i], ms[j])) return false;
  return true;
}
function combinationsConflict(chosen, candidate) {
  for (const sec of chosen)
    for (const ma of sec.meetings)
      for (const mb of candidate.meetings)
        if (meetingsOverlap(ma, mb)) return true;
  return false;
}
function generateRoutines(courses) {
  const validSections = courses.map(c =>
    c.sections.filter(s => s.meetings.every(m => m.day && m.slotId) && sectionValid(s))
  );
  if (validSections.some(ss => ss.length === 0)) return [];
  const results = [];
  function backtrack(idx, chosen) {
    if (idx === validSections.length) { results.push([...chosen]); return; }
    for (const sec of validSections[idx]) {
      if (!combinationsConflict(chosen, sec)) {
        chosen.push(sec); backtrack(idx + 1, chosen); chosen.pop();
      }
    }
  }
  backtrack(0, []);
  return results;
}

// ─── SCORING ─────────────────────────────────────────────────────────────────
function scoreRoutine(sections) {
  const byDay = {};
  for (const sec of sections) {
    for (const m of sec.meetings) {
      if (!byDay[m.day]) byDay[m.day] = [];
      const slot = TIME_SLOTS.find(s => s.id === m.slotId);
      if (slot) byDay[m.day].push(slot);
    }
  }
  const days = Object.keys(byDay);
  let totalGap = 0, totalStart = 0, totalEnd = 0;
  for (const d of days) {
    const slots = byDay[d].sort((a, b) => a.start - b.start);
    for (let i = 1; i < slots.length; i++) totalGap += slots[i].start - slots[i - 1].end;
    totalStart += slots[0].start;
    totalEnd += slots[slots.length - 1].end;
  }
  return {
    totalGap,
    avgStart: days.length ? Math.round(totalStart / days.length) : 0,
    avgEnd: days.length ? Math.round(totalEnd / days.length) : 0,
    classDays: days.length,
    earliestStart: days.length ? Math.min(...days.map(d => byDay[d][0].start)) : 0,
    latestEnd: days.length ? Math.max(...days.map(d => byDay[d][byDay[d].length - 1].end)) : 0,
  };
}
function sortRoutines(routines, mode) {
  return [...routines].map(r => ({ sections: r, score: scoreRoutine(r) })).sort((a, b) => {
    let p = 0;
    if (mode === "minGap") p = a.score.totalGap - b.score.totalGap;
    else if (mode === "earlyLeave") p = a.score.avgEnd - b.score.avgEnd;
    else if (mode === "lateStart") p = b.score.avgStart - a.score.avgStart;
    else if (mode === "fewestDays") p = a.score.classDays - b.score.classDays;
    if (p !== 0) return p;
    if (a.score.classDays !== b.score.classDays) return a.score.classDays - b.score.classDays;
    if (a.score.totalGap !== b.score.totalGap) return a.score.totalGap - b.score.totalGap;
    return a.score.avgEnd - b.score.avgEnd;
  });
}
function filterRoutines(routines, filters) {
  return routines.filter(({ score }) => {
    if (filters.maxDays !== "" && score.classDays > Number(filters.maxDays)) return false;
    if (filters.noAfter !== "" && score.latestEnd > Number(filters.noAfter)) return false;
    if (filters.noBefore !== "" && score.earliestStart < Number(filters.noBefore)) return false;
    if (filters.maxGap !== "" && score.totalGap > Number(filters.maxGap)) return false;
    return true;
  });
}

// ─── SEED DATA ────────────────────────────────────────────────────────────────
const SEED_COURSES = [
  {
    id: "c1", code: "PHRM 7701",
    sections: [
      { id: "s1a", courseId: "c1", label: "A", meetings: [{ day: "Sun", slotId: "s1" }, { day: "Tue", slotId: "s1" }] },
      { id: "s1b", courseId: "c1", label: "B", meetings: [{ day: "Mon", slotId: "s3" }, { day: "Wed", slotId: "s3" }] },
    ]
  },
  {
    id: "c2", code: "PHRM 7702",
    sections: [
      { id: "s2a", courseId: "c2", label: "A", meetings: [{ day: "Sun", slotId: "s2" }, { day: "Tue", slotId: "s2" }] },
      { id: "s2b", courseId: "c2", label: "B", meetings: [{ day: "Mon", slotId: "s4" }, { day: "Wed", slotId: "s4" }] },
    ]
  },
  {
    id: "c3", code: "PHRM 7703",
    sections: [
      { id: "s3a", courseId: "c3", label: "A", meetings: [{ day: "Sun", slotId: "s3" }] },
      { id: "s3b", courseId: "c3", label: "B", meetings: [{ day: "Thu", slotId: "s2" }] },
    ]
  },
];

// ─── LOCAL STORAGE ────────────────────────────────────────────────────────────
const LS_KEY = "routine_gen_v3";
function loadState() { try { const d = localStorage.getItem(LS_KEY); return d ? JSON.parse(d) : null; } catch { return null; } }
function saveState(s) { try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { } }

// ─── EXPORT TO IMAGE ──────────────────────────────────────────────────────────
async function downloadRoutineAsImage(element, routineNum) {
  try {
    const canvas = await html2canvas(element, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: "#ffffff",
      logging: false,
    });

    canvas.toBlob((blob) => {
      if (!blob) {
        alert("Failed to create image. Please try again.");
        return;
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `routine-${routineNum}-${new Date().toISOString().split("T")[0]}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, "image/png");
  } catch (error) {
    console.error("Download failed:", error);
    alert("Failed to download routine. Please ensure all content is loaded and try again.");
  }
}



// ─── FULL WEEKLY GRID ────────────────────────────────────────────────────────
function WeeklyGrid({ sections, courseMap, courseColors }) {
  const cells = {};
  sections.forEach(sec => {
    const course = courseMap[sec.courseId];
    sec.meetings.forEach(m => {
      const key = `${m.day}-${m.slotId}`;
      cells[key] = {
        code: course ? course.code : sec.courseId,
        label: sec.label || "",
        color: courseColors[sec.courseId] || "#888",
      };
    });
  });

  return (
    <div style={{ overflowX: "auto", marginTop: 12 }}>
      <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
        <thead>
          <tr>
            <th style={{ width: 42, padding: "4px 6px", fontSize: 11, color: "var(--color-text-secondary)", fontWeight: 400, textAlign: "left", borderBottom: "0.5px solid var(--color-border-tertiary)" }}></th>
            {TIME_SLOTS.map(sl => (
              <th key={sl.id} style={{ padding: "4px 4px", fontSize: 10, color: "var(--color-text-secondary)", fontWeight: 400, textAlign: "center", borderBottom: "0.5px solid var(--color-border-tertiary)", lineHeight: 1.3 }}>
                <div>{sl.label.split(" – ")[0]}</div>
                <div style={{ color: "var(--color-text-tertiary)", fontSize: 9 }}>–{sl.label.split(" – ")[1]}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DAYS.map(d => (
            <tr key={d}>
              <td style={{ padding: "5px 6px", fontSize: 11, fontWeight: 500, color: "var(--color-text-secondary)", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>{d}</td>
              {TIME_SLOTS.map(sl => {
                const cell = cells[`${d}-${sl.id}`];
                return (
                  <td key={sl.id} style={{
                    padding: "4px 3px", textAlign: "center",
                    borderBottom: "0.5px solid var(--color-border-tertiary)",
                    borderRadius: 0,
                  }}>
                    {cell ? (
                      <div style={{
                        background: cell.color + "28",
                        border: `1.5px solid ${cell.color}88`,
                        borderRadius: 5,
                        padding: "4px 2px",
                        color: cell.color,
                        fontWeight: 600,
                        fontSize: 10,
                        lineHeight: 1.3,
                      }}>
                        <div>{cell.code}</div>
                        <div style={{ fontWeight: 400, fontSize: 9, opacity: 0.8 }}>§{cell.label}</div>
                      </div>
                    ) : (
                      <div style={{ height: 34, borderRadius: 5, background: "var(--color-background-secondary)", opacity: 0.4 }} />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── ROUTINE CARD ─────────────────────────────────────────────────────────────
function RoutineCard({ idx, sections, score, courseMap, courseColors }) {
  const cardRef = useRef(null);
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    if (!cardRef.current) return;
    setDownloading(true);
    try {
      await downloadRoutineAsImage(cardRef.current, idx + 1);
    } catch (error) {
      console.error("Download error:", error);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div ref={cardRef} style={{
      background: "var(--color-background-primary)",
      border: "0.5px solid var(--color-border-tertiary)",
      borderRadius: 14,
      padding: "18px 20px",
      marginBottom: 18,
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ fontWeight: 500, fontSize: 16, color: "var(--color-text-primary)" }}>
          Routine #{idx + 1}
        </div>
        <button
          onClick={handleDownload}
          disabled={downloading}
          style={{
            fontSize: 12,
            padding: "6px 14px",
            borderRadius: 6,
            border: "none",
            background: downloading ? "#B8B0E0" : "#6B5FD0",
            color: "#fff",
            fontWeight: 500,
            cursor: downloading ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
            transition: "all 0.2s ease",
            boxShadow: "0 2px 6px rgba(107, 95, 208, 0.3)",
          }}
          onMouseEnter={e => {
            if (!downloading) {
              e.currentTarget.style.background = "#5A4FBF";
              e.currentTarget.style.boxShadow = "0 4px 12px rgba(107, 95, 208, 0.5)";
            }
          }}
          onMouseLeave={e => {
            if (!downloading) {
              e.currentTarget.style.background = "#6B5FD0";
              e.currentTarget.style.boxShadow = "0 2px 6px rgba(107, 95, 208, 0.3)";
            }
          }}
        >
          {downloading ? (
            <>
              <span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>⟳</span>
              Saving...
            </>
          ) : (
            <>
              <span>⬇</span>
              Download Routine
            </>
          )}
        </button>
      </div>

      {/* Course badges */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {sections.map(sec => {
          const course = courseMap[sec.courseId];
          const code = course ? course.code : sec.courseId;
          const color = courseColors[sec.courseId] || "#888";
          return (
            <div key={sec.id} style={{
              display: "flex", alignItems: "center", gap: 6,
              background: color + "18",
              border: `1.5px solid ${color}55`,
              borderRadius: 8, padding: "6px 12px",
            }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color, lineHeight: 1.2 }}>{code}</div>
                <div style={{ fontSize: 11, color: color, opacity: 0.75, lineHeight: 1.2 }}>Section {sec.label || "?"}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 4 }}>
        {[
          ["Gap time", score.totalGap + " min"],
          ["First class", minutesToLabel(score.earliestStart)],
          ["Last class ends", minutesToLabel(score.latestEnd)],
          ["Class days", score.classDays + " day" + (score.classDays !== 1 ? "s" : "")],
        ].map(([label, val]) => (
          <div key={label} style={{ background: "var(--color-background-secondary)", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
            <div style={{ fontSize: 10, color: "var(--color-text-secondary)", marginBottom: 3 }}>{label}</div>
            <div style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-primary)" }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Weekly grid */}
      <WeeklyGrid sections={sections} courseMap={courseMap} courseColors={courseColors} />

      {/* Meeting list */}
      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 4 }}>
        {sections.map(sec => {
          const course = courseMap[sec.courseId];
          const code = course ? course.code : sec.courseId;
          const color = courseColors[sec.courseId] || "#888";
          return sec.meetings.map((m, mi) => {
            const slot = TIME_SLOTS.find(s => s.id === m.slotId);
            return (
              <div key={`${sec.id}-${mi}`} style={{
                display: "flex", alignItems: "center", gap: 8,
                fontSize: 12, color: "var(--color-text-secondary)",
                padding: "3px 0",
                borderBottom: "0.5px solid var(--color-border-tertiary)",
              }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0, display: "inline-block" }} />
                <span style={{ fontWeight: 500, color: "var(--color-text-primary)", minWidth: 70 }}>{code} §{sec.label}</span>
                <span style={{ minWidth: 28 }}>{m.day}</span>
                <span>{slot ? slot.label : "—"}</span>
              </div>
            );
          });
        })}
      </div>
    </div>
  );
}

// ─── SECTION ROW ──────────────────────────────────────────────────────────────
function SectionRow({ section, secIdx, onChange, onRemove, canRemove }) {
  const updateMeeting = (mi, field, val) => {
    const meetings = section.meetings.map((m, i) => i === mi ? { ...m, [field]: val } : m);
    onChange({ ...section, meetings });
  };
  const addMeeting = () => { if (section.meetings.length < 2) onChange({ ...section, meetings: [...section.meetings, newMeeting()] }); };
  const removeMeeting = (mi) => onChange({ ...section, meetings: section.meetings.filter((_, i) => i !== mi) });
  const hasConflict = !sectionValid(section) && section.meetings.every(m => m.day && m.slotId);

  return (
    <div style={{
      background: "var(--color-background-secondary)", borderRadius: 8,
      padding: "10px 12px", marginBottom: 6,
      border: hasConflict ? "1px solid #E24B4A" : "0.5px solid var(--color-border-tertiary)",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12, color: "var(--color-text-secondary)", fontWeight: 500 }}>Section</span>
          <input value={section.label || ""} onChange={e => onChange({ ...section, label: e.target.value })}
            placeholder="A"
            style={{ width: 36, fontSize: 12, padding: "2px 6px", borderRadius: 4, border: "0.5px solid var(--color-border-secondary)", background: "var(--color-background-primary)", color: "var(--color-text-primary)", textAlign: "center" }}
            aria-label="Section label" />
        </div>
        <div style={{ display: "flex", gap: 5 }}>
          {section.meetings.length < 2 && (
            <button onClick={addMeeting} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, border: "0.5px solid var(--color-border-secondary)", background: "transparent", color: "var(--color-text-secondary)", cursor: "pointer" }}>+ Add Days</button>
          )}
          {canRemove && (
            <button onClick={onRemove} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, border: "0.5px solid #F09595", background: "transparent", color: "#A32D2D", cursor: "pointer" }}>remove</button>
          )}
        </div>
      </div>
      {section.meetings.map((m, mi) => (
        <div key={mi} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: mi < section.meetings.length - 1 ? 6 : 0, flexWrap: "wrap" }}>
          <select value={m.day} onChange={e => updateMeeting(mi, "day", e.target.value)}
            style={{ flex: "1 1 80px", fontSize: 12, padding: "4px 6px", borderRadius: 6, border: "0.5px solid var(--color-border-tertiary)", background: "var(--color-background-primary)", color: "var(--color-text-primary)" }}>
            <option value="">Day</option>
            {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <select value={m.slotId} onChange={e => updateMeeting(mi, "slotId", e.target.value)}
            style={{ flex: "2 1 155px", fontSize: 12, padding: "4px 6px", borderRadius: 6, border: "0.5px solid var(--color-border-tertiary)", background: "var(--color-background-primary)", color: "var(--color-text-primary)" }}>
            <option value="">Time slot</option>
            {TIME_SLOTS.map(sl => <option key={sl.id} value={sl.id}>{sl.label}</option>)}
          </select>
          {section.meetings.length > 1 && (
            <button onClick={() => removeMeeting(mi)} style={{ fontSize: 11, padding: "3px 6px", borderRadius: 4, border: "0.5px solid var(--color-border-secondary)", background: "transparent", color: "var(--color-text-secondary)", cursor: "pointer" }}>✕</button>
          )}
        </div>
      ))}
      {hasConflict && <div style={{ color: "#A32D2D", fontSize: 11, marginTop: 4 }}>⚠ Meetings overlap within this section</div>}
    </div>
  );
}

// ─── COURSE ROW ───────────────────────────────────────────────────────────────
function CourseRow({ course, colorIdx, onChange, onRemove, onDuplicate }) {
  const color = COURSE_COLORS[colorIdx % COURSE_COLORS.length];
  const [open, setOpen] = useState(true);
  const addSection = () => onChange({ ...course, sections: [...course.sections, { ...newSection(course.id), label: String.fromCharCode(65 + course.sections.length) }] });
  const removeSection = (sid) => onChange({ ...course, sections: course.sections.filter(s => s.id !== sid) });
  const updateSection = (sec) => onChange({ ...course, sections: course.sections.map(s => s.id === sec.id ? sec : s) });

  return (
    <div style={{ border: `1.5px solid ${color}44`, borderRadius: 10, marginBottom: 12, overflow: "hidden" }}>
      <div style={{ background: color + "18", padding: "10px 12px", display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 12, height: 12, borderRadius: 3, background: color, flexShrink: 0 }} />
        <input value={course.code} onChange={e => onChange({ ...course, code: e.target.value })}
          placeholder="Course code (e.g. CSE 101)"
          style={{ flex: 1, fontSize: 13, fontWeight: 500, border: "none", background: "transparent", color: "var(--color-text-primary)", outline: "none" }}
          aria-label="Course code" />
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={() => setOpen(o => !o)} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, border: "0.5px solid var(--color-border-secondary)", background: "transparent", color: "var(--color-text-secondary)", cursor: "pointer" }}>{open ? "▲" : "▼"}</button>
          <button onClick={onDuplicate} title="Duplicate" style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, border: "0.5px solid var(--color-border-secondary)", background: "transparent", color: "var(--color-text-secondary)", cursor: "pointer" }}>⧉</button>
          <button onClick={onRemove} title="Remove" style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, border: "0.5px solid #F09595", background: "transparent", color: "#A32D2D", cursor: "pointer" }}>✕</button>
        </div>
      </div>
      {open && (
        <div style={{ padding: "10px 12px" }}>
          {course.sections.map((sec, si) => (
            <SectionRow key={sec.id} section={sec} secIdx={si}
              onChange={updateSection}
              onRemove={() => removeSection(sec.id)}
              canRemove={course.sections.length > 1} />
          ))}
          <button onClick={addSection} style={{ fontSize: 12, padding: "4px 12px", borderRadius: 6, border: `0.5px dashed ${color}88`, background: "transparent", color, cursor: "pointer", width: "100%", marginTop: 4 }}>
            + Add section
          </button>
        </div>
      )}
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const saved = loadState();
  const [courses, setCourses] = useState(saved?.courses || SEED_COURSES);
  const [sortMode, setSortMode] = useState(saved?.sortMode || "minGap");
  const [filters, setFilters] = useState(saved?.filters || { maxDays: "", noAfter: "", noBefore: "", maxGap: "" });
  const [results, setResults] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => { saveState({ courses, sortMode, filters }); }, [courses, sortMode, filters]);

  // Build lookup map: courseId → course (always fresh from current courses state)
  const courseMap = useMemo(() => {
    const m = {};
    courses.forEach(c => { m[c.id] = c; });
    return m;
  }, [courses]);

  const courseColors = useMemo(() => {
    const m = {};
    courses.forEach((c, i) => { m[c.id] = COURSE_COLORS[i % COURSE_COLORS.length]; });
    return m;
  }, [courses]);

  function validate() {
    for (const c of courses) {
      if (!c.code.trim()) return "All courses must have a course code.";
      for (const sec of c.sections) {
        if (sec.meetings.some(m => !m.day || !m.slotId)) return `Section "${sec.label}" in "${c.code}" has incomplete meetings.`;
        if (sec.meetings.length === 0) return `Section in "${c.code}" has no meetings.`;
      }
    }
    return "";
  }

  function handleGenerate() {
    const err = validate();
    if (err) { setError(err); return; }
    setError(""); setGenerating(true);
    setTimeout(() => {
      try {
        const raw = generateRoutines(courses);
        const sorted = sortRoutines(raw, sortMode);
        const filtered = filterRoutines(sorted, filters);
        setResults({ all: sorted, filtered });
      } catch (e) { setError("Generation error: " + e.message); }
      setGenerating(false);
    }, 20);
  }

  function handleSortChange(mode) {
    setSortMode(mode);
    if (results) {
      const sorted = sortRoutines(results.all.map(r => r.sections), mode);
      const filtered = filterRoutines(sorted, filters);
      setResults({ all: sorted, filtered });
    }
  }

  function handleFilterChange(key, val) {
    const newF = { ...filters, [key]: val };
    setFilters(newF);
    if (results) setResults({ ...results, filtered: filterRoutines(results.all, newF) });
  }

  const addCourse = () => setCourses(cs => [...cs, newCourse()]);
  const updateCourse = (c) => setCourses(cs => cs.map(x => x.id === c.id ? c : x));
  const removeCourse = (id) => setCourses(cs => cs.filter(c => c.id !== id));
  const duplicateCourse = (c) => {
    const nc = { ...c, id: uid(), sections: c.sections.map(s => ({ ...s, id: uid(), courseId: "" })) };
    nc.sections.forEach(s => { s.courseId = nc.id; });
    setCourses(cs => { const i = cs.findIndex(x => x.id === c.id); const r = [...cs]; r.splice(i + 1, 0, nc); return r; });
  };
  const clearAll = () => { setCourses([newCourse()]); setResults(null); setError(""); };

  const display = results?.filtered || [];

  return (
    <div style={{ fontFamily: "var(--font-sans)", minHeight: "100vh", background: "var(--color-background-tertiary)", color: "var(--color-text-primary)" }}>
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
      <h2 className="sr-only">RoutineLab - Build Smarter Class Routines</h2>

      {/* Header */}
      <div style={{ background: "var(--color-background-primary)", borderBottom: "0.5px solid var(--color-border-tertiary)", padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 500 }}>RoutineLab</div>

          </div>
          <div style={{ background: "#7F77DD", color: "#fff", fontSize: 8, fontWeight: 600, padding: "2px 6px", borderRadius: 3, whiteSpace: "nowrap", lineHeight: 1.1 }}>Bhutuu</div>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", maxWidth: 1300, margin: "0 auto" }}>
        {/* LEFT PANEL */}
        <div style={{ flex: "0 0 340px", minWidth: 280, padding: 16, borderRight: "0.5px solid var(--color-border-tertiary)", maxHeight: "calc(100vh - 70px)", overflowY: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <span style={{ fontWeight: 500, fontSize: 14 }}>Courses ({courses.length})</span>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={addCourse} style={{ fontSize: 12, padding: "4px 12px", borderRadius: 6, border: "0.5px solid var(--color-border-secondary)", background: "transparent", color: "var(--color-text-primary)", cursor: "pointer" }}>+ Course</button>
              <button onClick={clearAll} style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, border: "0.5px solid #F09595", background: "transparent", color: "#A32D2D", cursor: "pointer" }}>Clear</button>
            </div>
          </div>
          {courses.map((c, i) => (
            <CourseRow key={c.id} course={c} colorIdx={i}
              onChange={updateCourse}
              onRemove={() => removeCourse(c.id)}
              onDuplicate={() => duplicateCourse(c)} />
          ))}
          {error && <div style={{ color: "#A32D2D", fontSize: 12, background: "#FCEBEB", borderRadius: 6, padding: "8px 12px", marginBottom: 10, border: "1px solid #F7C1C1" }}>{error}</div>}
          <button onClick={handleGenerate} disabled={generating}
            style={{ width: "100%", padding: 10, borderRadius: 8, border: "none", background: generating ? "#9B92D9" : "#6B5FD0", color: "#fff", fontWeight: 600, fontSize: 14, cursor: generating ? "not-allowed" : "pointer", marginTop: 4, boxShadow: generating ? "0 2px 4px rgba(0,0,0,0.1)" : "0 4px 12px rgba(107, 95, 208, 0.4)", transition: "all 0.2s ease", letterSpacing: "0.3px" }}
            onMouseEnter={e => {
              if (!generating) {
                e.currentTarget.style.background = "#5A4FBF";
                e.currentTarget.style.boxShadow = "0 6px 20px rgba(107, 95, 208, 0.6)";
                e.currentTarget.style.transform = "translateY(-2px)";
              }
            }}
            onMouseLeave={e => {
              if (!generating) {
                e.currentTarget.style.background = "#6B5FD0";
                e.currentTarget.style.boxShadow = "0 4px 12px rgba(107, 95, 208, 0.4)";
                e.currentTarget.style.transform = "translateY(0)";
              }
            }}>
            {generating ? "Generating…" : "Generate Routines"}
          </button>
        </div>

        {/* RIGHT PANEL */}
        <div style={{ flex: "1 1 500px", padding: 16, maxHeight: "calc(100vh - 70px)", overflowY: "auto" }}>
          {/* Controls */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
            <select value={sortMode} onChange={e => handleSortChange(e.target.value)}
              style={{ fontSize: 12, padding: "5px 10px", borderRadius: 6, border: "0.5px solid var(--color-border-secondary)", background: "var(--color-background-primary)", color: "var(--color-text-primary)" }}>
              <option value="minGap">Sort: Minimum gap</option>
              <option value="earlyLeave">Sort: Earliest leave</option>
              <option value="lateStart">Sort: Latest start</option>
              <option value="fewestDays">Sort: Fewest class days</option>
            </select>
            <button onClick={() => setShowFilters(f => !f)}
              style={{ fontSize: 12, padding: "5px 12px", borderRadius: 6, border: "0.5px solid var(--color-border-secondary)", background: showFilters ? "var(--color-background-secondary)" : "transparent", color: "var(--color-text-secondary)", cursor: "pointer" }}>
              {showFilters ? "▲ Filters" : "▼ Filters"}
            </button>
            {results && <span style={{ fontSize: 12, color: "var(--color-text-secondary)", marginLeft: "auto" }}>{display.length} of {results.all.length} routines</span>}
          </div>

          {showFilters && (
            <div style={{ background: "var(--color-background-secondary)", borderRadius: 8, padding: 12, marginBottom: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
              {[["Max class days", "maxDays"], ["Max gap (min)", "maxGap"]].map(([label, key]) => (
                <div key={key} style={{ flex: "1 1 120px" }}>
                  <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginBottom: 3 }}>{label}</div>
                  <input type="number" value={filters[key]} placeholder="—"
                    onChange={e => handleFilterChange(key, e.target.value)}
                    style={{ width: "100%", fontSize: 12, padding: "4px 8px", borderRadius: 5, border: "0.5px solid var(--color-border-secondary)", background: "var(--color-background-primary)", color: "var(--color-text-primary)" }} />
                </div>
              ))}
              {[["No classes before", "noBefore", "start"], ["No classes after", "noAfter", "end"]].map(([label, key, side]) => (
                <div key={key} style={{ flex: "1 1 140px" }}>
                  <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginBottom: 3 }}>{label}</div>
                  <select value={filters[key]} onChange={e => handleFilterChange(key, e.target.value)}
                    style={{ width: "100%", fontSize: 12, padding: "4px 8px", borderRadius: 5, border: "0.5px solid var(--color-border-secondary)", background: "var(--color-background-primary)", color: "var(--color-text-primary)" }}>
                    <option value="">Any</option>
                    {TIME_SLOTS.map(sl => <option key={sl.id} value={sl[side]}>{sl.label.split(" – ")[side === "start" ? 0 : 1]}</option>)}
                  </select>
                </div>
              ))}
            </div>
          )}

          {!results && (
            <div style={{ textAlign: "center", padding: "80px 20px", color: "var(--color-text-secondary)" }}>
              <div style={{ fontSize: 48, marginBottom: 14 }}>📅</div>
              <div style={{ fontWeight: 500, fontSize: 16, marginBottom: 6, color: "var(--color-text-primary)" }}>Ready to generate</div>
              <div style={{ fontSize: 13 }}>Add courses on the left, then click Generate Routines.</div>
              <div style={{ marginTop: 6, fontSize: 12 }}>3 sample courses are pre-loaded — try it now.</div>
            </div>
          )}
          {results && display.length === 0 && (
            <div style={{ textAlign: "center", padding: "40px 20px", background: "var(--color-background-secondary)", borderRadius: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: "#A32D2D", marginBottom: 6 }}>No valid routines found</div>
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                {results.all.length === 0
                  ? "All combinations result in time conflicts. Try different sections or slots."
                  : `${results.all.length} routine(s) exist but are filtered out. Relax your filters.`}
              </div>
            </div>
          )}
          {display.map((r, i) => (
            <RoutineCard key={i} idx={i} sections={r.sections} score={r.score}
              courseMap={courseMap} courseColors={courseColors} />
          ))}
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          borderTop: "1px solid rgba(127,119,221,0.15)",
          background: "rgba(255,255,255,0.75)",
          backdropFilter: "blur(10px)",
          padding: "10px 20px",
          marginTop: "auto"
        }}
      >
        <div
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 11,
              fontWeight: 600,
              color: "#2A2A2A",
              letterSpacing: "0.3px"
            }}
          >
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#7F77DD",
                boxShadow: "0 0 10px rgba(127,119,221,0.5)"
              }}
            />
            RoutineLab by ToufiqBhai • v1.9
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14
            }}
          >
            {[
              {
                label: "GitHub",
                href: "https://github.com/toufiq4531"
              },
              {
                label: "Portfolio",
                href: "https://toufiq4531.github.io/MyPortfolio/"
              },
              {
                label: "LinkedIn",
                href: "https://www.linkedin.com/in/islam-mohammad-tofiqul/"
              }
            ].map(link => (
              <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: 11,
                  color: "#666",
                  textDecoration: "none",
                  fontWeight: 500,
                  transition: "all 0.2s ease",
                  position: "relative"
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.color = "#7F77DD";
                  e.currentTarget.style.transform = "translateY(-1px)";
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.color = "#666";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>


  );
}
