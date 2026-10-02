import { useRef, useState, useEffect } from "react";
import { PenLine, Eraser } from "lucide-react";

/**
 * Reusable e-signature field: printed name + draw-on-canvas signature.
 * Props: label, initialName, existing ({name, image, signed_at/signedAt}), onSave({name, image}), onClear, saving
 * Canvas exports a trimmed PNG dataURL (~10-40KB) — safe to store in tenant JSONB + signatures table.
 */
export default function SignaturePad({ label, initialName = "", existing = null, onSave, onClear, saving = false }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const hasInk = useRef(false);
  const [name, setName] = useState(initialName || existing?.name || "");
  const [drawn, setDrawn] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setName(initialName || existing?.name || "");
  }, [initialName, existing?.name]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 320;
    const h = 130;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1B2A28";
  }, []);

  const pos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    if (e.touches?.[0]) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e) => {
    e.preventDefault();
    drawing.current = true;
    const ctx = canvasRef.current.getContext("2d");
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };
  const move = (e) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext("2d");
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    hasInk.current = true;
    setDrawn(true);
  };
  const stop = () => { drawing.current = false; };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasInk.current = false;
    setDrawn(false);
  };

  const save = () => {
    setError("");
    if (!name.trim()) { setError("Type the printed name first."); return; }
    const image = hasInk.current ? canvasRef.current.toDataURL("image/png") : "";
    onSave?.({ name: name.trim(), image });
  };

  const fmtDate = (d) => {
    if (!d) return "";
    try {
      return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    } catch { return ""; }
  };
  const existingDate = existing?.signed_at || existing?.signedAt || existing?.date || null;

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12, background: "white" }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
        <PenLine size={14} /> {label}
      </div>

      {existing && (existing.image || existing.name) ? (
        <div style={{ background: "#F4F1E7", borderRadius: 6, padding: 10, marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: "#1a7f37", fontWeight: 700, marginBottom: 6 }}>
            ✓ Signed{existingDate ? ` on ${fmtDate(existingDate)}` : ""}
          </div>
          {existing.image && (
            <img src={existing.image} alt={`${label} signature`} style={{ maxWidth: 220, width: "100%", background: "white", borderRadius: 4, border: "1px solid var(--line)" }} />
          )}
          <div style={{ fontSize: 13, marginTop: 4 }}>Printed name: <strong>{existing.name}</strong></div>
          {onClear && (
            <button type="button" className="rlm-btn rlm-btn-ghost" style={{ padding: "4px 10px", fontSize: 12, marginTop: 8 }} onClick={onClear}>
              <Eraser size={13} /> Re-sign
            </button>
          )}
        </div>
      ) : null}

      <label style={{ fontSize: 12, color: "#5b6663", display: "block", marginBottom: 8 }}>
        Printed name
        <input
          className="rlm-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Type full name as signature"
          style={{ marginTop: 4 }}
        />
      </label>

      <div style={{ fontSize: 12, color: "#5b6663", marginBottom: 4 }}>Draw signature below (finger / mouse)</div>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: 130, border: "1px dashed #C9C3B0", borderRadius: 6, background: "#FFFEFB", touchAction: "none", cursor: "crosshair" }}
        onMouseDown={start}
        onMouseMove={move}
        onMouseUp={stop}
        onMouseLeave={stop}
        onTouchStart={start}
        onTouchMove={move}
        onTouchEnd={stop}
      />
      {error && <div style={{ fontSize: 12, color: "var(--rust)", marginTop: 6 }}>{error}</div>}
      <div className="no-print" style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button type="button" className="rlm-btn rlm-btn-primary" style={{ padding: "6px 14px" }} disabled={saving} onClick={save}>
          {saving ? "Saving…" : existing ? "Update signature" : "Sign"}
        </button>
        <button type="button" className="rlm-btn rlm-btn-ghost" style={{ padding: "6px 10px" }} onClick={clearCanvas}>
          <Eraser size={13} /> Clear drawing
        </button>
        {!drawn && <span style={{ fontSize: 11, color: "#999", alignSelf: "center" }}>Typed name alone also counts if drawing isn't possible.</span>}
      </div>
    </div>
  );
}
