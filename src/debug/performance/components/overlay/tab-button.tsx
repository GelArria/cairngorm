export function TabBtn({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "2px 6px",
        fontSize: 9,
        border: "none",
        cursor: "pointer",
        background: active ? "rgba(163,230,53,0.2)" : "transparent",
        color: active ? "#a3e635" : "#888",
        borderRadius: 3,
      }}
    >
      {label}
    </button>
  );
}
