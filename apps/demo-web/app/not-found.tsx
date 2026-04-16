export default function NotFoundPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "32px",
        background: "#f6f4ee",
        color: "#16213e",
        fontFamily: "system-ui, sans-serif"
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "420px",
          borderRadius: "28px",
          padding: "28px",
          background: "rgba(255,255,255,0.88)",
          boxShadow: "0 24px 80px rgba(22, 33, 62, 0.12)"
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: "13px",
            letterSpacing: "0.24em",
            textTransform: "uppercase",
            color: "#5e6d8c",
            fontWeight: 700
          }}
        >
          reeva AI
        </p>
        <h1
          style={{
            margin: "14px 0 10px",
            fontSize: "32px",
            lineHeight: 1.05
          }}
        >
          This page could not be found.
        </h1>
        <p
          style={{
            margin: 0,
            fontSize: "18px",
            lineHeight: 1.6,
            color: "#4a5876"
          }}
        >
          Go back to the demo homepage and try the prompt flow again.
        </p>
      </div>
    </main>
  )
}
