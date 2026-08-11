export default function GatewayStatusPage() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 720, margin: "64px auto", padding: 24 }}>
      <h1>AitlasQM connector gateway</h1>
      <p>This customer-owned gateway validates QM capabilities before accessing connected tools.</p>
      <p>Health endpoint: <code>/healthz</code></p>
    </main>
  );
}
