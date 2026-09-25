import "./storage.js";
import "./index.css";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, info) { console.error("ErrorBoundary", error, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 32, fontFamily: "sans-serif", maxWidth: 640, margin: "0 auto" }}>
          <h2 style={{ color: "#B4442E" }}>Something went wrong</h2>
          <p style={{ color: "#5b6663", fontSize: 14 }}>{String(this.state.error?.message || this.state.error)}</p>
          <button onClick={() => location.reload()} style={{ padding: "8px 14px", borderRadius: 4, border: "1px solid #1B2A28", background: "#1B2A28", color: "#F8F6EF", cursor: "pointer" }}>Reload app</button>
          <button onClick={() => { localStorage.clear(); location.reload(); }} style={{ marginLeft: 8, padding: "8px 14px", borderRadius: 4, border: "1px solid #B4442E", background: "transparent", color: "#B4442E", cursor: "pointer" }}>Clear data & reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
